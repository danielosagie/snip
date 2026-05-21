import { useAction, useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import type { UploadStatus } from "@/components/upload/UploadProgress";
import { stitchImageSequence } from "@/lib/stitchImageSequence";

export interface ManagedUploadItem {
  id: string;
  projectId: Id<"projects">;
  file: File;
  videoId?: Id<"videos">;
  progress: number;
  status: UploadStatus;
  error?: string;
  bytesPerSecond?: number;
  estimatedSecondsRemaining?: number | null;
  abortController?: AbortController;
}

function createUploadId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

// Matches sequence filenames like `shot.0001.png` or `shot_0001.exr`.
// The integer must be 3-6 digits; anything shorter is too ambiguous and
// would false-positive on dates / version numbers.
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
  const m = SEQUENCE_FILENAME_RE.exec(file.name);
  if (!m) return null;
  const [, stem, idxStr, ext] = m;
  if (!SEQUENCE_FRAME_EXTS.has(ext.toLowerCase())) return null;
  const index = Number(idxStr);
  if (!Number.isFinite(index)) return null;
  return { stem, index, ext: ext.toLowerCase(), file };
}

/**
 * Group an upload batch by (stem, ext) when ≥3 files share both. Returns
 * a map from groupKey → ordered frames. Files that don't match the
 * sequence pattern are excluded.
 */
function groupSequenceFrames(files: File[]): Map<string, FrameMatch[]> {
  const groups = new Map<string, FrameMatch[]>();
  for (const file of files) {
    const match = detectFrame(file);
    if (!match) continue;
    const key = `${match.stem}.${match.ext}`;
    const arr = groups.get(key) ?? [];
    arr.push(match);
    groups.set(key, arr);
  }
  for (const [key, arr] of groups) {
    if (arr.length < 3) {
      groups.delete(key);
      continue;
    }
    arr.sort((a, b) => a.index - b.index);
  }
  return groups;
}

export function useVideoUploadManager() {
  const createVideo = useMutation(api.videos.create);
  const getUploadUrl = useAction(api.videoActions.getUploadUrl);
  const markUploadComplete = useAction(api.videoActions.markUploadComplete);
  const markUploadFailed = useAction(api.videoActions.markUploadFailed);
  const [uploads, setUploads] = useState<ManagedUploadItem[]>([]);

  const uploadFilesToProject = useCallback(
    async (
      projectId: Id<"projects">,
      files: File[],
      folderId?: Id<"folders">,
    ) => {
      // Detect image-sequence groups up-front and stitch each into a
      // single MP4 in the browser (ffmpeg.wasm) BEFORE uploading. The
      // frames are already here, so there's no server round-trip. The
      // resulting MP4 then flows through the normal video upload path
      // and Mux ingest — it plays like any other video. Frames that
      // belong to a stitched sequence are NOT uploaded individually.
      const sequenceGroups = groupSequenceFrames(files);
      const framesInSequences = new Set<File>();
      for (const [, frames] of sequenceGroups) {
        for (const fr of frames) framesInSequences.add(fr.file);
      }

      const standalone = files.filter((f) => !framesInSequences.has(f));
      const stitchedClips: File[] = [];
      for (const [, frames] of sequenceGroups) {
        const stitchId = createUploadId();
        const { stem } = frames[0];
        setUploads((prev) => [
          ...prev,
          {
            id: stitchId,
            projectId,
            file: frames[0].file,
            progress: 0,
            status: "processing",
            abortController: new AbortController(),
          },
        ]);
        try {
          const mp4 = await stitchImageSequence(
            frames.map((f) => f.file),
            stem,
            {
              fps: 24,
              onProgress: ({ ratio }) =>
                setUploads((prev) =>
                  prev.map((u) =>
                    u.id === stitchId
                      ? { ...u, progress: Math.round(ratio * 100) }
                      : u,
                  ),
                ),
            },
          );
          stitchedClips.push(mp4);
        } catch (err) {
          console.error("stitchImageSequence failed", err);
          setUploads((prev) =>
            prev.map((u) =>
              u.id === stitchId
                ? {
                    ...u,
                    status: "error",
                    error:
                      err instanceof Error
                        ? `Couldn't stitch sequence: ${err.message}`
                        : "Couldn't stitch sequence.",
                  }
                : u,
            ),
          );
          // Fall back: upload this group's frames as individual files so
          // nothing is lost when stitching fails (e.g. CDN blocked).
          for (const fr of frames) standalone.push(fr.file);
        } finally {
          setUploads((prev) => prev.filter((u) => u.id !== stitchId));
        }
      }

      const filesToUpload = [...standalone, ...stitchedClips];

      for (const file of filesToUpload) {
        const uploadId = createUploadId();
        const title = file.name.replace(/\.[^/.]+$/, "");
        const abortController = new AbortController();
        // Pick the best content-type guess the browser gave us. If it
        // couldn't determine one (common for .prproj, .blend, .fcpxml,
        // etc.) fall back to a neutral binary type so the backend
        // routes the upload through the generic-file path instead of
        // trying to feed it to Mux as "video/mp4".
        const inferredContentType =
          file.type && file.type.trim().length > 0
            ? file.type
            : "application/octet-stream";

        setUploads((prev) => [
          ...prev,
          {
            id: uploadId,
            projectId,
            file,
            progress: 0,
            status: "pending",
            abortController,
          },
        ]);

        let createdVideoId: Id<"videos"> | undefined;

        try {
          createdVideoId = await createVideo({
            projectId,
            title,
            fileSize: file.size,
            contentType: inferredContentType,
            folderId,
          });

          setUploads((prev) =>
            prev.map((upload) =>
              upload.id === uploadId
                ? { ...upload, videoId: createdVideoId, status: "uploading" }
                : upload,
            ),
          );

          const { url } = await getUploadUrl({
            videoId: createdVideoId,
            filename: file.name,
            fileSize: file.size,
            contentType: inferredContentType,
          });

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            let lastTime = Date.now();
            let lastLoaded = 0;
            const recentSpeeds: number[] = [];

            xhr.upload.addEventListener("progress", (event) => {
              if (!event.lengthComputable) return;

              const percentage = Math.round((event.loaded / event.total) * 100);
              const now = Date.now();
              const timeDelta = (now - lastTime) / 1000;
              const bytesDelta = event.loaded - lastLoaded;

              if (timeDelta > 0.1) {
                const speed = bytesDelta / timeDelta;
                recentSpeeds.push(speed);
                if (recentSpeeds.length > 5) recentSpeeds.shift();
                lastTime = now;
                lastLoaded = event.loaded;
              }

              const avgSpeed =
                recentSpeeds.length > 0
                  ? recentSpeeds.reduce((sum, speed) => sum + speed, 0) /
                    recentSpeeds.length
                  : 0;
              const remaining = event.total - event.loaded;
              const eta = avgSpeed > 0 ? Math.ceil(remaining / avgSpeed) : null;

              setUploads((prev) =>
                prev.map((upload) =>
                  upload.id === uploadId
                    ? {
                        ...upload,
                        progress: percentage,
                        bytesPerSecond: avgSpeed,
                        estimatedSecondsRemaining: eta,
                      }
                    : upload,
                ),
              );
            });

            xhr.addEventListener("load", () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
                return;
              }
              reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
            });

            xhr.addEventListener("error", () => {
              reject(new Error("Upload failed: Network error"));
            });

            xhr.addEventListener("abort", () => {
              reject(new Error("Upload cancelled"));
            });

            abortController.signal.addEventListener("abort", () => {
              xhr.abort();
            });

            xhr.open("PUT", url);
            xhr.setRequestHeader("Content-Type", inferredContentType);
            xhr.send(file);
          });

          await markUploadComplete({ videoId: createdVideoId });

          setUploads((prev) =>
            prev.map((upload) =>
              upload.id === uploadId
                ? { ...upload, status: "complete", progress: 100 }
                : upload,
            ),
          );

          setTimeout(() => {
            setUploads((prev) => prev.filter((upload) => upload.id !== uploadId));
          }, 3000);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Upload failed";

          setUploads((prev) =>
            prev.map((upload) =>
              upload.id === uploadId
                ? { ...upload, status: "error", error: errorMessage }
                : upload,
            ),
          );

          if (createdVideoId) {
            markUploadFailed({ videoId: createdVideoId }).catch(console.error);
          }
        }
      }
    },
    [
      createVideo,
      getUploadUrl,
      markUploadComplete,
      markUploadFailed,
    ],
  );

  const cancelUpload = useCallback(
    (uploadId: string) => {
      const upload = uploads.find((item) => item.id === uploadId);
      if (upload?.abortController) {
        upload.abortController.abort();
      }
      if (upload?.videoId) {
        markUploadFailed({ videoId: upload.videoId }).catch(console.error);
      }
      setUploads((prev) => prev.filter((item) => item.id !== uploadId));
    },
    [uploads, markUploadFailed],
  );

  return {
    uploads,
    uploadFilesToProject,
    cancelUpload,
  };
}
