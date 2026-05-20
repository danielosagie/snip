import { useAction, useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import type { UploadStatus } from "@/components/upload/UploadProgress";

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
  const coalesceIntoSequence = useMutation(api.videos.coalesceIntoSequence);
  const [uploads, setUploads] = useState<ManagedUploadItem[]>([]);

  const uploadFilesToProject = useCallback(
    async (
      projectId: Id<"projects">,
      files: File[],
      folderId?: Id<"folders">,
    ) => {
      // Detect image-sequence groups up-front so we can coalesce after
      // the per-file uploads complete. Tracks each frame's videoId in
      // creation order so the coalesce mutation can collapse them.
      const sequenceGroups = groupSequenceFrames(files);
      const sequenceVideoIdsByFile = new Map<File, Id<"videos">>();

      for (const file of files) {
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

          // Stash the frame's videoId for the post-loop coalesce pass.
          if (createdVideoId) {
            sequenceVideoIdsByFile.set(file, createdVideoId);
          }

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

      // Coalesce detected sequences. Each group's frames are uploaded
      // independently above; here we collapse them into one
      // image_sequence row and schedule the optional stitch action.
      // Best-effort — a coalesce failure leaves the per-frame videos in
      // place so nothing is lost.
      for (const [, frames] of sequenceGroups) {
        const frameVideoIds = frames
          .map((f) => sequenceVideoIdsByFile.get(f.file))
          .filter((id): id is Id<"videos"> => !!id);
        if (frameVideoIds.length < 3) continue;
        const { stem, ext } = frames[0];
        try {
          await coalesceIntoSequence({
            frameVideoIds,
            stem,
            ext,
            fps: 24,
          });
        } catch (err) {
          console.error("coalesceIntoSequence failed", err);
        }
      }
    },
    [
      createVideo,
      getUploadUrl,
      markUploadComplete,
      markUploadFailed,
      coalesceIntoSequence,
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
