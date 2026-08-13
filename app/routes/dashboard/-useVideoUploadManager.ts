import { useAction, useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import type { UploadStatus } from "@/components/upload/UploadProgress";
import { stitchImageSequence } from "@/lib/stitchImageSequence";
import { probeLocalMedia, type LocalMediaMeta } from "@/lib/localMediaMeta";

const MULTIPART_THRESHOLD_BYTES = 32 * 1024 * 1024;
const MAX_BATCH_CONCURRENCY = 3;
const PROGRESS_RENDER_INTERVAL_MS = 100;

export interface ManagedUploadItem {
  id: string;
  projectId: Id<"projects">;
  folderId?: Id<"folders">;
  file: File;
  videoId?: Id<"videos">;
  progress: number;
  bytesUploaded: number;
  status: UploadStatus;
  error?: string;
  bytesPerSecond?: number;
  estimatedSecondsRemaining?: number | null;
  resumable: boolean;
  /**
   * Duration, dimensions and a poster read off the local File. Undefined
   * while the probe is in flight; a probe that fails leaves the fields null
   * rather than blocking the upload, which never waits on this.
   */
  meta?: LocalMediaMeta;
}

interface MultipartState {
  uploadId: string;
  partSize: number;
  nextPart: number;
  completedBytes: number;
}

interface UploadRuntime {
  id: string;
  projectId: Id<"projects">;
  folderId?: Id<"folders">;
  file: File;
  videoId?: Id<"videos">;
  controller: AbortController;
  intent: "pause" | "cancel" | null;
  multipart?: MultipartState;
  running: boolean;
  lastUiAt: number;
  lastSampleAt: number;
  lastSampleBytes: number;
  speedSamples: number[];
}

function currentIntent(runtime: UploadRuntime) {
  return runtime.intent;
}

function createUploadId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

const SEQUENCE_FILENAME_RE = /^(.+?)[._](\d{3,6})\.([a-z0-9]+)$/i;
const SEQUENCE_FRAME_EXTS = new Set([
  "png", "jpg", "jpeg", "tif", "tiff", "exr", "dpx", "tga", "webp", "bmp",
]);

interface FrameMatch {
  stem: string;
  index: number;
  ext: string;
  file: File;
}

function detectFrame(file: File): FrameMatch | null {
  const match = SEQUENCE_FILENAME_RE.exec(file.name);
  if (!match) return null;
  const [, stem, indexText, ext] = match;
  if (!SEQUENCE_FRAME_EXTS.has(ext.toLowerCase())) return null;
  const index = Number(indexText);
  return Number.isFinite(index)
    ? { stem, index, ext: ext.toLowerCase(), file }
    : null;
}

function groupSequenceFrames(files: File[]): Map<string, FrameMatch[]> {
  const groups = new Map<string, FrameMatch[]>();
  for (const file of files) {
    const frame = detectFrame(file);
    if (!frame) continue;
    const key = `${frame.stem}.${frame.ext}`;
    const group = groups.get(key) ?? [];
    group.push(frame);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    if (group.length < 3) groups.delete(key);
    else group.sort((a, b) => a.index - b.index);
  }
  return groups;
}

function uploadBlob(
  url: string,
  blob: Blob,
  contentType: string,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (signal.aborted) {
      reject(new DOMException("Transfer interrupted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    });
    xhr.addEventListener("load", () => {
      signal.removeEventListener("abort", abort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
    });
    xhr.addEventListener("error", () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Upload failed: network error"));
    });
    xhr.addEventListener("abort", () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Transfer interrupted", "AbortError"));
    });
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.send(blob);
  });
}

export function useVideoUploadManager() {
  const createVideo = useMutation(api.videos.create);
  const getUploadUrl = useAction(api.videoActions.getUploadUrl);
  const startMultipartUpload = useAction(api.videoActions.startMultipartUpload);
  const getMultipartPartUrl = useAction(api.videoActions.getMultipartPartUrl);
  const completeMultipartUpload = useAction(api.videoActions.completeMultipartUpload);
  const cancelUploadObject = useAction(api.videoActions.cancelUploadObject);
  const markUploadComplete = useAction(api.videoActions.markUploadComplete);
  const [uploads, setUploads] = useState<ManagedUploadItem[]>([]);
  const runtimesRef = useRef(new Map<string, UploadRuntime>());

  const patchUpload = useCallback(
    (id: string, patch: Partial<ManagedUploadItem>) => {
      setUploads((current) =>
        current.map((upload) =>
          upload.id === id ? { ...upload, ...patch } : upload,
        ),
      );
    },
    [],
  );

  const removeUpload = useCallback((id: string) => {
    runtimesRef.current.delete(id);
    setUploads((current) => current.filter((upload) => upload.id !== id));
  }, []);

  const updateProgress = useCallback(
    (runtime: UploadRuntime, absoluteBytes: number, force = false) => {
      const now = performance.now();
      const elapsed = (now - runtime.lastSampleAt) / 1000;
      if (elapsed >= 0.12) {
        const speed = Math.max(0, absoluteBytes - runtime.lastSampleBytes) / elapsed;
        runtime.speedSamples.push(speed);
        if (runtime.speedSamples.length > 6) runtime.speedSamples.shift();
        runtime.lastSampleAt = now;
        runtime.lastSampleBytes = absoluteBytes;
      }
      if (!force && now - runtime.lastUiAt < PROGRESS_RENDER_INTERVAL_MS) return;
      runtime.lastUiAt = now;
      const speed = runtime.speedSamples.length
        ? runtime.speedSamples.reduce((sum, value) => sum + value, 0) /
          runtime.speedSamples.length
        : 0;
      const remaining = Math.max(0, runtime.file.size - absoluteBytes);
      patchUpload(runtime.id, {
        bytesUploaded: absoluteBytes,
        progress:
          runtime.file.size === 0
            ? 100
            : Math.min(100, Math.round((absoluteBytes / runtime.file.size) * 100)),
        bytesPerSecond: speed,
        estimatedSecondsRemaining: speed > 0 ? Math.ceil(remaining / speed) : null,
      });
    },
    [patchUpload],
  );

  const cleanupCancelledRuntime = useCallback(
    async (runtime: UploadRuntime) => {
      if (runtime.videoId) {
        await cancelUploadObject({
          videoId: runtime.videoId,
          multipartUploadId: runtime.multipart?.uploadId,
        }).catch((error) => console.error("upload cancellation cleanup failed", error));
      }
      removeUpload(runtime.id);
    },
    [cancelUploadObject, removeUpload],
  );

  const runUpload = useCallback(
    async (runtime: UploadRuntime) => {
      if (runtime.running) return;
      if (runtime.intent === "cancel") {
        await cleanupCancelledRuntime(runtime);
        return;
      }
      runtime.running = true;
      runtime.controller = new AbortController();
      patchUpload(runtime.id, { status: "uploading", error: undefined });

      const contentType = runtime.file.type.trim() || "application/octet-stream";
      const title = runtime.file.name.replace(/\.[^/.]+$/, "");
      try {
        if (!runtime.videoId) {
          runtime.videoId = await createVideo({
            projectId: runtime.projectId,
            title,
            fileSize: runtime.file.size,
            contentType,
            folderId: runtime.folderId,
          });
          patchUpload(runtime.id, { videoId: runtime.videoId });
        }
        if (currentIntent(runtime) === "cancel") {
          await cleanupCancelledRuntime(runtime);
          return;
        }

        if (runtime.file.size >= MULTIPART_THRESHOLD_BYTES) {
          if (!runtime.multipart) {
            const started = await startMultipartUpload({
              videoId: runtime.videoId,
              filename: runtime.file.name,
              fileSize: runtime.file.size,
              contentType,
            });
            runtime.multipart = {
              uploadId: started.uploadId,
              partSize: started.partSize,
              nextPart: 1,
              completedBytes: 0,
            };
          }
          const multipart = runtime.multipart;
          const expectedParts = Math.ceil(runtime.file.size / multipart.partSize);
          while (multipart.nextPart <= expectedParts) {
            if (runtime.intent) throw new DOMException("Transfer interrupted", "AbortError");
            const start = (multipart.nextPart - 1) * multipart.partSize;
            const end = Math.min(runtime.file.size, start + multipart.partSize);
            const { url } = await getMultipartPartUrl({
              videoId: runtime.videoId,
              uploadId: multipart.uploadId,
              partNumber: multipart.nextPart,
            });
            await uploadBlob(
              url,
              runtime.file.slice(start, end),
              contentType,
              runtime.controller.signal,
              (loaded) => updateProgress(runtime, start + loaded),
            );
            multipart.completedBytes = end;
            multipart.nextPart += 1;
            updateProgress(runtime, end, true);
          }
          await completeMultipartUpload({
            videoId: runtime.videoId,
            uploadId: multipart.uploadId,
            expectedParts,
          });
        } else {
          const { url } = await getUploadUrl({
            videoId: runtime.videoId,
            filename: runtime.file.name,
            fileSize: runtime.file.size,
            contentType,
          });
          await uploadBlob(
            url,
            runtime.file,
            contentType,
            runtime.controller.signal,
            (loaded) => updateProgress(runtime, loaded),
          );
          updateProgress(runtime, runtime.file.size, true);
        }

        if (currentIntent(runtime) === "cancel") {
          throw new DOMException("Transfer interrupted", "AbortError");
        }

        patchUpload(runtime.id, {
          status: "processing",
          progress: 100,
          bytesUploaded: runtime.file.size,
          estimatedSecondsRemaining: null,
        });
        await markUploadComplete({ videoId: runtime.videoId });
        patchUpload(runtime.id, { status: "complete" });
        window.setTimeout(() => removeUpload(runtime.id), 4000);
      } catch (error) {
        if (currentIntent(runtime) === "cancel") {
          await cleanupCancelledRuntime(runtime);
        } else if (currentIntent(runtime) === "pause") {
          patchUpload(runtime.id, {
            status: "paused",
            estimatedSecondsRemaining: null,
          });
        } else {
          patchUpload(runtime.id, {
            status: "error",
            error: error instanceof Error ? error.message : "Upload failed",
            estimatedSecondsRemaining: null,
          });
        }
      } finally {
        runtime.running = false;
      }
    },
    [
      cleanupCancelledRuntime,
      completeMultipartUpload,
      createVideo,
      getMultipartPartUrl,
      getUploadUrl,
      markUploadComplete,
      patchUpload,
      removeUpload,
      startMultipartUpload,
      updateProgress,
    ],
  );

  const uploadFilesToProject = useCallback(
    async (
      projectId: Id<"projects">,
      files: File[],
      folderId?: Id<"folders">,
    ) => {
      const sequenceGroups = groupSequenceFrames(files);
      const framesInSequences = new Set<File>();
      for (const frames of sequenceGroups.values()) {
        for (const frame of frames) framesInSequences.add(frame.file);
      }
      const standalone = files.filter((file) => !framesInSequences.has(file));
      const stitchedClips: File[] = [];

      for (const frames of sequenceGroups.values()) {
        const stitchId = createUploadId();
        const { stem } = frames[0];
        setUploads((current) => [
          ...current,
          {
            id: stitchId,
            projectId,
            folderId,
            file: frames[0].file,
            progress: 0,
            bytesUploaded: 0,
            status: "processing",
            resumable: false,
          },
        ]);
        try {
          stitchedClips.push(
            await stitchImageSequence(
              frames.map((frame) => frame.file),
              stem,
              {
                fps: 24,
                onProgress: ({ ratio }) =>
                  patchUpload(stitchId, { progress: Math.round(ratio * 100) }),
              },
            ),
          );
        } catch (error) {
          console.error("stitchImageSequence failed", error);
          for (const frame of frames) standalone.push(frame.file);
        } finally {
          setUploads((current) => current.filter((upload) => upload.id !== stitchId));
        }
      }

      const queued = [...standalone, ...stitchedClips].map((file) => {
        const id = createUploadId();
        const runtime: UploadRuntime = {
          id,
          projectId,
          folderId,
          file,
          controller: new AbortController(),
          intent: null,
          running: false,
          lastUiAt: 0,
          lastSampleAt: performance.now(),
          lastSampleBytes: 0,
          speedSamples: [],
        };
        runtimesRef.current.set(id, runtime);
        return runtime;
      });
      setUploads((current) => [
        ...current,
        ...queued.map((runtime) => ({
          id: runtime.id,
          projectId,
          folderId,
          file: runtime.file,
          progress: 0,
          bytesUploaded: 0,
          status: "pending" as const,
          resumable: runtime.file.size >= MULTIPART_THRESHOLD_BYTES,
        })),
      ]);

      // Probe in the background and patch rows as results land. Deliberately
      // not awaited: reading a poster frame off a 4 GB ProRes file must never
      // delay the first byte going out.
      for (const runtime of queued) {
        void probeLocalMedia(runtime.file).then((meta) => {
          setUploads((current) =>
            current.map((item) =>
              item.id === runtime.id ? { ...item, meta } : item,
            ),
          );
        });
      }

      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < queued.length) {
          const runtime = queued[nextIndex++];
          await runUpload(runtime);
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(MAX_BATCH_CONCURRENCY, queued.length) },
          worker,
        ),
      );
    },
    [patchUpload, runUpload],
  );

  const cancelUpload = useCallback(
    (uploadId: string) => {
      const runtime = runtimesRef.current.get(uploadId);
      if (!runtime) {
        removeUpload(uploadId);
        return;
      }
      runtime.intent = "cancel";
      runtime.controller.abort();
      patchUpload(uploadId, { status: "cancelling", error: undefined });
      if (!runtime.running) void cleanupCancelledRuntime(runtime);
    },
    [cleanupCancelledRuntime, patchUpload, removeUpload],
  );

  const pauseUpload = useCallback(
    (uploadId: string) => {
      const runtime = runtimesRef.current.get(uploadId);
      if (!runtime || !runtime.running || runtime.file.size < MULTIPART_THRESHOLD_BYTES) return;
      runtime.intent = "pause";
      runtime.controller.abort();
    },
    [],
  );

  const resumeUpload = useCallback(
    (uploadId: string) => {
      const runtime = runtimesRef.current.get(uploadId);
      if (!runtime || runtime.running) return;
      runtime.intent = null;
      runtime.lastSampleAt = performance.now();
      runtime.lastSampleBytes = runtime.multipart?.completedBytes ?? 0;
      runtime.speedSamples = [];
      void runUpload(runtime);
    },
    [runUpload],
  );

  const retryUpload = resumeUpload;

  const dismissUpload = useCallback(
    (uploadId: string) => {
      const runtime = runtimesRef.current.get(uploadId);
      if (runtime) {
        runtime.intent = "cancel";
        if (!runtime.running) void cleanupCancelledRuntime(runtime);
        else runtime.controller.abort();
      } else {
        removeUpload(uploadId);
      }
    },
    [cleanupCancelledRuntime, removeUpload],
  );

  return {
    uploads,
    uploadFilesToProject,
    cancelUpload,
    pauseUpload,
    resumeUpload,
    retryUpload,
    dismissUpload,
  };
}
