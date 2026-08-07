"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import {
  ChevronDown,
  History,
  Plus,
  Check,
  Star,
  Upload as UploadIcon,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { videoPath } from "@/lib/routes";
import { useToast } from "@/components/ui/toast";

/**
 * Google-Docs-style version picker that lives in the video page's top
 * bar. Wraps the lineage backend: lists every upload in this video's
 * stack, lets the user switch to a different version (navigates to its
 * videoId), mark a different version as the current one, or upload a
 * brand-new version off this one.
 */

interface Props {
  teamSlug: string;
  projectId: Id<"projects">;
  videoId: Id<"videos">;
  canEdit: boolean;
}

export function VideoVersionDropdown({
  teamSlug,
  projectId,
  videoId,
  canEdit,
}: Props) {
  const navigate = useNavigate();
  const versions = useQuery(api.videos.listVersions, { videoId });
  const setCurrent = useMutation(api.videos.setCurrentVersion);
  const createNextVersion = useMutation(api.videos.createNextVersion);
  const getUploadUrl = useAction(api.videoActions.getUploadUrl);
  const markUploadComplete = useAction(api.videoActions.markUploadComplete);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "current" | "upload">(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  if (!versions || versions.length === 0) return null;
  const current = versions.find((v) => v.isCurrentVersion) ?? versions[0];
  const me = versions.find((v) => v._id === videoId);
  const onCurrent = me?._id === current._id;

  const handleSwitch = (targetId: Id<"videos">) => {
    setOpen(false);
    if (targetId === videoId) return;
    navigate({ to: videoPath(teamSlug, projectId, targetId) });
  };

  const handleMarkCurrent = async () => {
    setBusy("current");
    try {
      await setCurrent({ videoId });
    } finally {
      setBusy(null);
    }
  };

  const handleNewVersionFile = async (file: File) => {
    setBusy("upload");
    setUploadProgress(0);
    try {
      const newId = await createNextVersion({
        parentVideoId: videoId,
        fileSize: file.size,
        contentType: file.type || "video/mp4",
      });
      const { url } = await getUploadUrl({
        videoId: newId,
        filename: file.name,
        fileSize: file.size,
        contentType: file.type || "video/mp4",
      });
      // Direct PUT to the presigned S3 URL with progress.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setUploadProgress(e.loaded / e.total);
          }
        });
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.send(file);
      });
      await markUploadComplete({ videoId: newId });
      navigate({ to: videoPath(teamSlug, projectId, newId) });
      setOpen(false);
    } catch (e) {
      console.error("Upload-new-version failed", e);
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
      setUploadProgress(null);
    }
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleNewVersionFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
          open
            ? "border-[#D8D8DE] bg-[#FFF0E6] text-[#D14E00]"
            : "border-[#D8D8DE] bg-white text-[#131315] hover:bg-[#F1F1F3]",
        )}
        title="Switch between versions of this video"
      >
        <History className="h-3.5 w-3.5" />
        <span>
          v{me?.versionNumber ?? 1}
        </span>
        {onCurrent ? (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              open ? "bg-white text-[#D14E00]" : "bg-[#FFF0E6] text-[#D14E00]",
            )}
          >
            Current
          </span>
        ) : null}
        <span className="text-[#A0A0A5]">·</span>
        <span className="text-[11px] text-[#6E6E73]">
          {versions.length} version{versions.length === 1 ? "" : "s"}
        </span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 min-w-[360px] max-w-[460px] overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white">
          <header className="flex items-center justify-between border-b border-[#E8E8EC] px-3 py-2.5 text-[#131315]">
            <div className="text-[13px] font-semibold">
              Versions
            </div>
            <div className="font-mono text-[11px] text-[#A0A0A5]">
              {versions.length} total
            </div>
          </header>

          <ul className="max-h-[60vh] overflow-y-auto">
            {versions.map((v) => {
              const isMe = v._id === videoId;
              const isCurrent = v.isCurrentVersion;
              return (
                <li
                  key={v._id}
                  className={cn(
                    "cursor-pointer border-b border-[#F1F1F3] px-3 py-2.5 last:border-b-0 hover:bg-[#FAFAFA]",
                    isMe ? "bg-[#FFF0E6]" : "",
                  )}
                  onClick={() => handleSwitch(v._id as Id<"videos">)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#131315]">
                      v{v.versionNumber}
                    </span>
                    {isCurrent ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF0E6] px-1.5 py-0.5 text-[10px] font-medium text-[#D14E00]">
                        <Star className="h-2.5 w-2.5 fill-current" />
                        Current
                      </span>
                    ) : null}
                    {isMe ? (
                      <span className="rounded-full bg-[#F1F1F3] px-1.5 py-0.5 text-[10px] font-medium text-[#6E6E73]">
                        Viewing
                      </span>
                    ) : null}
                    {v.status !== "ready" ? (
                      <span className="rounded-full bg-[#FFF9EC] px-1.5 py-0.5 text-[10px] font-medium capitalize text-[#74521D]">
                        {v.status}
                      </span>
                    ) : null}
                    <span className="ml-auto font-mono text-[11px] text-[#A0A0A5]">
                      {formatRelativeTime(v._creationTime)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-[#131315]">
                    {v.versionLabel || v.title}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-[#6E6E73]">
                    by {v.uploaderName}
                  </div>
                </li>
              );
            })}
          </ul>

          {canEdit ? (
            <footer className="flex flex-col gap-1.5 border-t border-[#E8E8EC] bg-[#FAFAFA] px-3 py-2.5">
              {!onCurrent ? (
                <button
                  type="button"
                  onClick={() => void handleMarkCurrent()}
                  disabled={busy !== null}
                  className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#131315] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Check className="h-3 w-3" />
                  {busy === "current"
                    ? "Marking…"
                    : `Make v${me?.versionNumber} current`}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy !== null}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white px-3 py-2 text-xs font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3] disabled:opacity-50"
              >
                {busy === "upload" ? (
                  <>
                    <UploadIcon className="h-3 w-3" />
                    Uploading {Math.round((uploadProgress ?? 0) * 100)}%…
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3" />
                    New version
                  </>
                )}
              </button>
            </footer>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
