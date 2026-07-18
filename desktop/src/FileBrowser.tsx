/**
 * Project file browser — the desktop analogue of the web project page.
 * Mirrors the web data model exactly: workspaces → projects → folders →
 * items, all from Convex. Upload and download go through the same pipeline
 * the web app uses (presigned S3 PUT + Convex item records), so desktop and
 * web stay in sync. Videos route through Mux just like the web.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConvexClient } from "convex/browser";
import { useConvexQuery, callMutation, callAction } from "./useConvex";
import { api } from "./api";
import { C, mono, Eyebrow, Glyph, Pill } from "./ui";

interface ProjectDoc {
  _id: string;
  name: string;
  description?: string;
  role?: string;
}
interface FolderRow {
  _id: string;
  name: string;
  parentFolderId: string | null;
  createdByName?: string;
  itemCount: number;
}
interface ItemDoc {
  _id: string;
  title: string;
  status: "uploading" | "processing" | "ready" | "failed" | string;
  contentType?: string;
  fileSize?: number;
  kind?: string;
  commentCount?: number;
}

interface Crumb {
  id: string;
  name: string;
}

interface UploadTask {
  id: string;
  file: File;
  name: string;
  folderId: string | null;
  pct: number;
  bytesUploaded: number;
  bytesPerSecond: number;
  eta: number | null;
  resumable: boolean;
  status: "pending" | "uploading" | "paused" | "cancelling" | "processing" | "done" | "error";
  error?: string;
}

interface DesktopUploadRuntime {
  taskId: string;
  projectId: string;
  file: File;
  folderId: string | null;
  videoId?: string;
  controller: AbortController;
  intent: "pause" | "cancel" | null;
  running: boolean;
  multipart?: { uploadId: string; partSize: number; nextPart: number; completedBytes: number };
  lastTime: number;
  lastBytes: number;
  speeds: number[];
}

function desktopUploadIntent(runtime: DesktopUploadRuntime) {
  return runtime.intent;
}

const DESKTOP_MULTIPART_THRESHOLD = 32 * 1024 * 1024;
const DESKTOP_UPLOAD_CONCURRENCY = 3;

export function FileBrowser({
  client,
  projectId,
}: {
  client: ConvexClient | null;
  projectId: string;
}) {
  const project = useConvexQuery<ProjectDoc | null>(client, "projects:get", { projectId });
  // Navigation stack of folders. Empty = project root.
  const [path, setPath] = useState<Crumb[]>([]);
  const currentFolderId = path.length ? path[path.length - 1].id : null;

  const folders = useConvexQuery<FolderRow[]>(client, "folders:list", {
    projectId,
    parentFolderId: currentFolderId ?? undefined,
  });
  const items = useConvexQuery<ItemDoc[]>(client, "videos:list", {
    projectId,
    folderId: currentFolderId,
  });

  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [folderDropId, setFolderDropId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRuntimesRef = useRef(new Map<string, DesktopUploadRuntime>());

  // Reset to root when switching projects.
  useEffect(() => {
    setPath([]);
    setError(null);
  }, [projectId]);

  const patchUpload = useCallback((taskId: string, patch: Partial<UploadTask>) => {
    setUploads((current) => current.map((task) => task.id === taskId ? { ...task, ...patch } : task));
  }, []);

  const removeUpload = useCallback((taskId: string) => {
    uploadRuntimesRef.current.delete(taskId);
    setUploads((current) => current.filter((task) => task.id !== taskId));
  }, []);

  const cleanupCancelledUpload = useCallback(async (runtime: DesktopUploadRuntime) => {
    if (client && runtime.videoId) {
      await callAction(client, "videoActions:cancelUploadObject", {
        videoId: runtime.videoId,
        multipartUploadId: runtime.multipart?.uploadId,
      }).catch(() => {});
    }
    removeUpload(runtime.taskId);
  }, [client, removeUpload]);

  const updateUploadProgress = useCallback((runtime: DesktopUploadRuntime, loaded: number) => {
    const now = performance.now();
    const elapsed = (now - runtime.lastTime) / 1000;
    if (elapsed >= 0.12) {
      runtime.speeds.push(Math.max(0, loaded - runtime.lastBytes) / elapsed);
      if (runtime.speeds.length > 6) runtime.speeds.shift();
      runtime.lastTime = now;
      runtime.lastBytes = loaded;
    }
    const speed = runtime.speeds.length
      ? runtime.speeds.reduce((sum, value) => sum + value, 0) / runtime.speeds.length
      : 0;
    const remaining = Math.max(0, runtime.file.size - loaded);
    patchUpload(runtime.taskId, {
      pct: runtime.file.size === 0 ? 100 : Math.min(100, Math.round((loaded / runtime.file.size) * 100)),
      bytesUploaded: loaded,
      bytesPerSecond: speed,
      eta: speed > 0 ? Math.ceil(remaining / speed) : null,
    });
  }, [patchUpload]);

  const runUpload = useCallback(async (runtime: DesktopUploadRuntime) => {
    if (!client || runtime.running) return;
    if (runtime.intent === "cancel") {
      await cleanupCancelledUpload(runtime);
      return;
    }
    runtime.running = true;
    runtime.controller = new AbortController();
    patchUpload(runtime.taskId, { status: "uploading", error: undefined });
    const contentType = runtime.file.type.trim() || "application/octet-stream";
    try {
      if (!runtime.videoId) {
        runtime.videoId = await callMutation<string>(client, "videos:create", {
          projectId: runtime.projectId,
          title: runtime.file.name.replace(/\.[^/.]+$/, ""),
          fileSize: runtime.file.size,
          contentType,
          folderId: runtime.folderId ?? undefined,
        });
      }
      if (desktopUploadIntent(runtime) === "cancel") {
        await cleanupCancelledUpload(runtime);
        return;
      }

      if (runtime.file.size >= DESKTOP_MULTIPART_THRESHOLD) {
        if (!runtime.multipart) {
          const started = await callAction<{ uploadId: string; key: string; partSize: number }>(
            client,
            "videoActions:startMultipartUpload",
            {
              videoId: runtime.videoId,
              filename: runtime.file.name,
              fileSize: runtime.file.size,
              contentType,
            },
          );
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
          const { url } = await callAction<{ url: string }>(client, "videoActions:getMultipartPartUrl", {
            videoId: runtime.videoId,
            uploadId: multipart.uploadId,
            partNumber: multipart.nextPart,
          });
          await putWithProgress(
            url,
            runtime.file.slice(start, end),
            contentType,
            runtime.controller.signal,
            (partBytes) => updateUploadProgress(runtime, start + partBytes),
          );
          multipart.completedBytes = end;
          multipart.nextPart += 1;
          updateUploadProgress(runtime, end);
        }
        await callAction(client, "videoActions:completeMultipartUpload", {
          videoId: runtime.videoId,
          uploadId: multipart.uploadId,
          expectedParts,
        });
      } else {
        const { url } = await callAction<{ url: string; uploadId: string }>(
          client,
          "videoActions:getUploadUrl",
          {
            videoId: runtime.videoId,
            filename: runtime.file.name,
            fileSize: runtime.file.size,
            contentType,
          },
        );
        await putWithProgress(
          url,
          runtime.file,
          contentType,
          runtime.controller.signal,
          (bytes) => updateUploadProgress(runtime, bytes),
        );
      }
      if (desktopUploadIntent(runtime) === "cancel") {
        throw new DOMException("Transfer interrupted", "AbortError");
      }
      patchUpload(runtime.taskId, {
        pct: 100,
        bytesUploaded: runtime.file.size,
        eta: null,
        status: "processing",
      });
      await callAction(client, "videoActions:markUploadComplete", { videoId: runtime.videoId });
      patchUpload(runtime.taskId, { status: "done" });
      window.setTimeout(() => removeUpload(runtime.taskId), 4000);
    } catch (uploadError) {
      if (desktopUploadIntent(runtime) === "cancel") {
        await cleanupCancelledUpload(runtime);
      } else if (desktopUploadIntent(runtime) === "pause") {
        patchUpload(runtime.taskId, { status: "paused", eta: null });
      } else {
        patchUpload(runtime.taskId, {
          status: "error",
          eta: null,
          error: uploadError instanceof Error ? uploadError.message : "Upload failed",
        });
      }
    } finally {
      runtime.running = false;
    }
  }, [cleanupCancelledUpload, client, patchUpload, removeUpload, updateUploadProgress]);

  const uploadFiles = useCallback(async (
    files: FileList | File[],
    targetFolderId: string | null = currentFolderId,
  ) => {
    if (!client) return;
    const runtimes = Array.from(files).map((file) => {
      const taskId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const runtime: DesktopUploadRuntime = {
        taskId,
        projectId,
        file,
        folderId: targetFolderId,
        controller: new AbortController(),
        intent: null,
        running: false,
        lastTime: performance.now(),
        lastBytes: 0,
        speeds: [],
      };
      uploadRuntimesRef.current.set(taskId, runtime);
      return runtime;
    });
    setUploads((current) => [
      ...current,
      ...runtimes.map((runtime) => ({
        id: runtime.taskId,
        file: runtime.file,
        name: runtime.file.name,
        folderId: runtime.folderId,
        pct: 0,
        bytesUploaded: 0,
        bytesPerSecond: 0,
        eta: null,
        resumable: runtime.file.size >= DESKTOP_MULTIPART_THRESHOLD,
        status: "pending" as const,
      })),
    ]);
    let next = 0;
    const worker = async () => {
      while (next < runtimes.length) await runUpload(runtimes[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(DESKTOP_UPLOAD_CONCURRENCY, runtimes.length) }, worker));
  }, [client, currentFolderId, runUpload]);

  const cancelUpload = useCallback((taskId: string) => {
    const runtime = uploadRuntimesRef.current.get(taskId);
    if (!runtime) return removeUpload(taskId);
    runtime.intent = "cancel";
    runtime.controller.abort();
    patchUpload(taskId, { status: "cancelling", error: undefined });
    if (!runtime.running) void cleanupCancelledUpload(runtime);
  }, [cleanupCancelledUpload, patchUpload, removeUpload]);

  const pauseUpload = useCallback((taskId: string) => {
    const runtime = uploadRuntimesRef.current.get(taskId);
    if (!runtime?.running || runtime.file.size < DESKTOP_MULTIPART_THRESHOLD) return;
    runtime.intent = "pause";
    runtime.controller.abort();
  }, []);

  const resumeUpload = useCallback((taskId: string) => {
    const runtime = uploadRuntimesRef.current.get(taskId);
    if (!runtime || runtime.running) return;
    runtime.intent = null;
    runtime.lastTime = performance.now();
    runtime.lastBytes = runtime.multipart?.completedBytes ?? 0;
    runtime.speeds = [];
    void runUpload(runtime);
  }, [runUpload]);

  const handleDownload = async (item: ItemDoc) => {
    if (!client) return;
    setError(null);
    try {
      const { url, filename } = await callAction<{ url: string; filename: string }>(
        client,
        "videoActions:getDownloadUrl",
        { videoId: item._id },
      );
      await api.files.download({ url, filename });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    }
  };

  const handleCreateFolder = async (name: string) => {
    if (!client) return;
    setError(null);
    try {
      await callMutation(client, "folders:create", {
        projectId,
        name,
        parentFolderId: currentFolderId ?? undefined,
      });
      setCreatingFolder(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create folder.");
    }
  };

  const transferSummary = uploads.reduce(
    (summary, task) => {
      summary.total += task.file.size;
      summary.loaded += Math.min(task.bytesUploaded, task.file.size);
      summary.speed += task.bytesPerSecond;
      if (["pending", "uploading", "paused", "processing", "cancelling"].includes(task.status)) {
        summary.active += 1;
      }
      return summary;
    },
    { total: 0, loaded: 0, speed: 0, active: 0 },
  );
  const transferEta = transferSummary.speed > 0
    ? Math.ceil(Math.max(0, transferSummary.total - transferSummary.loaded) / transferSummary.speed)
    : null;

  if (project === undefined) {
    return <div style={{ color: C.muted, padding: 24 }}>Loading project…</div>;
  }
  if (project === null) {
    return <div style={{ color: C.muted, padding: 24 }}>Project not found.</div>;
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
      }}
      style={{ position: "relative", padding: 24, maxWidth: 980, margin: "0 auto" }}
    >
      {/* Breadcrumbs */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Eyebrow>Project</Eyebrow>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <Crumblet onClick={() => setPath([])} active={path.length === 0}>
          {project.name}
        </Crumblet>
        {path.map((c, i) => (
          <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.muted }}>/</span>
            <Crumblet
              onClick={() => setPath(path.slice(0, i + 1))}
              active={i === path.length - 1}
            >
              {c.name}
            </Crumblet>
          </span>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, margin: "16px 0", alignItems: "center" }}>
        <button className="primary" onClick={() => fileInputRef.current?.click()}>
          Upload files
        </button>
        <button onClick={() => setCreatingFolder(true)}>New folder</button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
          drag &amp; drop files anywhere
        </span>
      </div>

      {creatingFolder ? (
        <div style={{ marginBottom: 14 }}>
          <NameForm
            placeholder="Folder name"
            onCancel={() => setCreatingFolder(false)}
            onSubmit={(n) => void handleCreateFolder(n)}
          />
        </div>
      ) : null}

      {error ? (
        <div style={{ marginBottom: 14, color: C.danger, fontSize: 13 }}>{error}</div>
      ) : null}

      {/* Upload progress */}
      {uploads.length ? (
        <section style={{ border: `2px solid ${C.border}`, marginBottom: 14 }}>
          <header style={{ ...hdr, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span>{transferSummary.active ? `TRANSFERRING ${transferSummary.active}` : "TRANSFERS"}</span>
            <span style={{ fontFamily: mono, fontWeight: 500, opacity: 0.75, letterSpacing: 0, textTransform: "none" }}>
              {transferSummary.speed > 0 ? `${humanSize(transferSummary.speed)}/s` : ""}
              {transferEta ? ` · ${humanDuration(transferEta)} left` : ""}
            </span>
          </header>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {uploads.map((t) => (
              <li
                key={t.id}
                style={{
                  padding: "10px 12px",
                  borderBottom: `1px solid ${C.borderSubtle}`,
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  alignItems: "start",
                  gap: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.name}
                  </div>
                  <div style={{ marginTop: 3, fontSize: 10, color: t.status === "error" ? C.danger : C.muted, fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>
                    {t.status === "error"
                      ? t.error
                      : t.status === "processing"
                        ? "Upload finished · preparing file"
                        : t.status === "paused"
                          ? `${humanSize(t.bytesUploaded)} uploaded · paused`
                          : t.status === "done"
                            ? `${humanSize(t.file.size)} · complete`
                            : `${humanSize(t.bytesUploaded)} of ${humanSize(t.file.size)}${t.bytesPerSecond > 0 ? ` · ${humanSize(t.bytesPerSecond)}/s` : ""}${t.eta ? ` · ${humanDuration(t.eta)} left` : ""}`}
                  </div>
                  {["pending", "uploading", "paused"].includes(t.status) ? (
                    <div style={{ height: 4, marginTop: 7, background: C.cell, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${t.pct}%`, background: t.status === "paused" ? "#b45309" : C.accent, transition: "width 120ms cubic-bezier(0.2, 0, 0, 1)" }} />
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {t.status === "done" ? <Pill tone="ok">done</Pill> : null}
                  {t.status === "processing" ? <Pill tone="accent">preparing</Pill> : null}
                  {t.status === "uploading" && t.resumable ? (
                    <TransferAction label="Pause this upload" onClick={() => pauseUpload(t.id)}>Ⅱ</TransferAction>
                  ) : null}
                  {t.status === "paused" ? (
                    <TransferAction label="Resume this upload" onClick={() => resumeUpload(t.id)}>▶</TransferAction>
                  ) : null}
                  {t.status === "error" ? (
                    <TransferAction label="Retry this upload" onClick={() => resumeUpload(t.id)}>↻</TransferAction>
                  ) : null}
                  {["pending", "uploading", "paused"].includes(t.status) ? (
                    <TransferAction label="Cancel only this upload" onClick={() => cancelUpload(t.id)}>×</TransferAction>
                  ) : null}
                  {["done", "error"].includes(t.status) ? (
                    <TransferAction label="Dismiss transfer" onClick={() => t.status === "error" ? cancelUpload(t.id) : removeUpload(t.id)}>×</TransferAction>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Folders */}
      <section style={{ border: `2px solid ${C.border}`, marginBottom: 14 }}>
        <header style={hdr}>FOLDERS</header>
        {folders === undefined ? (
          <Empty>Loading…</Empty>
        ) : folders.length === 0 ? (
          <Empty>No folders here.</Empty>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {folders.map((f) => (
              <li
                key={f._id}
                onDragOver={(e) => {
                  if (!Array.from(e.dataTransfer.types).includes("Files")) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "copy";
                  setDragOver(false);
                  setFolderDropId(f._id);
                }}
                onDragLeave={(e) => {
                  if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
                  if (folderDropId === f._id) setFolderDropId(null);
                }}
                onDrop={(e) => {
                  if (!e.dataTransfer.files?.length) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setFolderDropId(null);
                  void uploadFiles(e.dataTransfer.files, f._id);
                }}
              >
                <button
                  onClick={() => setPath([...path, { id: f._id, name: f.name }])}
                  style={{
                    ...rowBtn,
                    background: folderDropId === f._id ? C.accent : "transparent",
                    color: folderDropId === f._id ? C.bg : C.fg,
                    transition: "background-color 140ms cubic-bezier(0.2, 0, 0, 1), color 140ms cubic-bezier(0.2, 0, 0, 1)",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                    <Glyph name="folder" size={16} />
                    <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {folderDropId === f._id ? `Upload into ${f.name}` : f.name}
                    </span>
                  </span>
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                    {folderDropId === f._id ? "release here" : `${f.itemCount} item${f.itemCount === 1 ? "" : "s"}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Files */}
      <section style={{ border: `2px solid ${C.border}` }}>
        <header style={hdr}>FILES</header>
        {items === undefined ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>No files here yet — upload or drag some in.</Empty>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {items.map((it) => (
              <ItemRow key={it._id} client={client} item={it} onDownload={() => void handleDownload(it)} />
            ))}
          </ul>
        )}
      </section>

      {dragOver ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(194,65,12,0.10)",
            border: `3px dashed ${C.accent}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            pointerEvents: "none",
            fontWeight: 900,
            fontSize: 18,
            color: C.accent,
          }}
        >
          Drop to upload to {path.length ? path[path.length - 1].name : project.name}
        </div>
      ) : null}
    </div>
  );
}

function putWithProgress(
  url: string,
  file: Blob,
  contentType: string,
  signal: AbortSignal,
  onProgress: (bytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (signal.aborted) {
      reject(new DOMException("Transfer interrupted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    });
    xhr.addEventListener("load", () => {
      signal.removeEventListener("abort", abort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
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
    xhr.send(file);
  });
}

function ItemRow({
  client,
  item,
  onDownload,
}: {
  client: ConvexClient | null;
  item: ItemDoc;
  onDownload: () => void;
}) {
  const isImage = (item.contentType ?? "").startsWith("image/");
  const isReady = item.status === "ready";
  const [thumb, setThumb] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  // Fetch a signed URL for image/gif items so we can preview them. Best-effort.
  useEffect(() => {
    if (!client || !isImage || !isReady) return;
    let cancelled = false;
    callAction<{ url: string; contentType: string }>(client, "videoActions:getOriginalPlaybackUrl", {
      videoId: item._id,
    })
      .then(({ url }) => {
        if (!cancelled) setThumb(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, isImage, isReady, item._id]);

  return (
    <li
      style={{
        padding: "10px 12px",
        borderBottom: `1px solid ${C.borderSubtle}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        onMouseEnter={(e) => thumb && setHover({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => thumb && hover && setHover({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          border: `2px solid ${C.border}`,
          background: C.cell,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          cursor: thumb ? "zoom-in" : "default",
        }}
      >
        {thumb ? (
          <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: C.muted }}>
            {extLabel(item.contentType, item.title)}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.title}
        </div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: mono, marginTop: 2 }}>
          {item.contentType ?? "file"}
          {typeof item.fileSize === "number" ? ` · ${humanSize(item.fileSize)}` : ""}
        </div>
      </div>
      <StatusPill status={item.status} />
      <button
        onClick={onDownload}
        disabled={!isReady}
        title={isReady ? "Download to disk" : "Available once ready"}
      >
        Download
      </button>

      {/* Hover-enlarge preview (image / gif). Fixed so it escapes the row. */}
      {hover && thumb ? (
        <div
          style={{
            position: "fixed",
            left: Math.min(hover.x + 18, window.innerWidth - 340),
            top: Math.min(hover.y + 18, window.innerHeight - 340),
            zIndex: 70,
            pointerEvents: "none",
            border: `2px solid ${C.border}`,
            background: C.bg,
            boxShadow: `6px 6px 0 0 ${C.border}`,
            padding: 4,
          }}
        >
          <img
            src={thumb}
            alt={item.title}
            style={{ display: "block", maxWidth: 320, maxHeight: 320, objectFit: "contain" }}
          />
        </div>
      ) : null}
    </li>
  );
}

function extLabel(contentType?: string, title?: string): string {
  if (contentType && contentType.includes("/")) {
    const sub = contentType.split("/")[1];
    if (sub) return sub.slice(0, 4).toUpperCase();
  }
  const m = (title ?? "").match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toUpperCase() : "FILE";
}

function humanDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function TransferAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 40,
        height: 40,
        padding: 0,
        display: "grid",
        placeItems: "center",
        fontFamily: mono,
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "ready") return <Pill tone="ok">ready</Pill>;
  if (status === "failed") return <Pill tone="danger">failed</Pill>;
  if (status === "processing") return <Pill tone="accent">processing</Pill>;
  if (status === "uploading") return <Pill tone="warn">uploading</Pill>;
  return <Pill tone="neutral">{status}</Pill>;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function Crumblet({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontWeight: active ? 900 : 700,
        fontSize: active ? 22 : 16,
        letterSpacing: "-0.02em",
        color: active ? C.fg : C.muted,
      }}
    >
      {children}
    </button>
  );
}

function NameForm({
  placeholder,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = name.trim();
        if (v) onSubmit(v);
      }}
      style={{ display: "flex", gap: 6, maxWidth: 360 }}
    >
      <input
        autoFocus
        value={name}
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        style={{ flex: 1 }}
      />
      <button type="submit">Create</button>
      <button type="button" className="ghost" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 14, color: C.muted, fontSize: 13 }}>{children}</div>;
}

const hdr: React.CSSProperties = {
  background: C.fg,
  color: C.bg,
  padding: "6px 12px",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.08em",
};

const rowBtn: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  borderBottom: `1px solid ${C.borderSubtle}`,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};
