/**
 * Project file browser — the desktop analogue of the web project page.
 * Mirrors the web data model exactly: workspaces → projects → folders →
 * items, all from Convex. Upload and download go through the same pipeline
 * the web app uses (presigned S3 PUT + Convex item records), so desktop and
 * web stay in sync. Videos route through Mux just like the web.
 */

import { useEffect, useMemo, useRef, useState } from "react";
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
  name: string;
  pct: number;
  status: "uploading" | "processing" | "done" | "error";
  error?: string;
}

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
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset to root when switching projects.
  useEffect(() => {
    setPath([]);
    setUploads([]);
    setError(null);
  }, [projectId]);

  const uploadFiles = async (files: FileList | File[]) => {
    if (!client) return;
    const list = Array.from(files).filter((f) => f.size > 0);
    for (const file of list) {
      const taskId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const title = file.name.replace(/\.[^/.]+$/, "");
      const contentType =
        file.type && file.type.trim().length > 0
          ? file.type
          : "application/octet-stream";
      setUploads((u) => [...u, { id: taskId, name: file.name, pct: 0, status: "uploading" }]);
      let videoId: string | undefined;
      try {
        videoId = await callMutation<string>(client, "videos:create", {
          projectId,
          title,
          fileSize: file.size,
          contentType,
          folderId: currentFolderId ?? undefined,
        });
        const { url } = await callAction<{ url: string; uploadId: string }>(
          client,
          "videoActions:getUploadUrl",
          { videoId, filename: file.name, fileSize: file.size, contentType },
        );
        await putWithProgress(url, file, contentType, (pct) =>
          setUploads((u) => u.map((t) => (t.id === taskId ? { ...t, pct } : t))),
        );
        setUploads((u) =>
          u.map((t) => (t.id === taskId ? { ...t, pct: 100, status: "processing" } : t)),
        );
        await callAction(client, "videoActions:markUploadComplete", { videoId });
        setUploads((u) => u.map((t) => (t.id === taskId ? { ...t, status: "done" } : t)));
        // Drop the finished task after a moment.
        setTimeout(
          () => setUploads((u) => u.filter((t) => t.id !== taskId)),
          2500,
        );
      } catch (e) {
        if (videoId) {
          await callAction(client, "videoActions:markUploadFailed", { videoId }).catch(() => {});
        }
        setUploads((u) =>
          u.map((t) =>
            t.id === taskId
              ? { ...t, status: "error", error: e instanceof Error ? e.message : "Upload failed" }
              : t,
          ),
        );
      }
    }
  };

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
          <header style={hdr}>UPLOADS</header>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {uploads.map((t) => (
              <li
                key={t.id}
                style={{
                  padding: "8px 12px",
                  borderBottom: `1px solid ${C.borderSubtle}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.name}
                </span>
                {t.status === "error" ? (
                  <span style={{ fontSize: 11, color: C.danger }}>{t.error}</span>
                ) : t.status === "done" ? (
                  <Pill tone="ok">done</Pill>
                ) : t.status === "processing" ? (
                  <Pill tone="accent">processing</Pill>
                ) : (
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>{t.pct}%</span>
                )}
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
              <li key={f._id}>
                <button
                  onClick={() => setPath([...path, { id: f._id, name: f.name }])}
                  style={rowBtn}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                    <Glyph name="folder" size={16} />
                    <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </span>
                  </span>
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                    {f.itemCount} item{f.itemCount === 1 ? "" : "s"}
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
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed: network error")));
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
