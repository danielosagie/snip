"use client";

import { useCallback, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import {
  MoreVertical,
  Download,
  Trash2,
  ExternalLink,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatRelativeTime } from "@/lib/utils";
import { triggerDownload } from "@/lib/download";
import { fileTypeFromContent, formatBytes } from "@/lib/fileTypes";

/**
 * Google-Drive-style tile for non-video files in the project grid.
 * Renders the file-type icon big and centered, filename below, meta on
 * one line at the bottom. Click downloads — there's no inline viewer
 * yet for PDFs/images, that comes later. Lawn's brutalist 2px-border +
 * hard-shadow treatment kept so it doesn't feel like a Drive clone.
 *
 * For VIDEOS the existing VideoIntentTarget tile in -project.tsx is
 * still used — videos have a thumbnail + play affordance that's
 * different from a generic file. This component is the non-video path.
 */

interface FileTileProps {
  videoId: Id<"videos">;
  title: string;
  contentType?: string | null;
  fileSize?: number | null;
  uploaderName: string;
  createdAt: number;
  status: string;
  canDelete?: boolean;
  draggable?: boolean;
  onDelete?: () => void;
  /** When set, clicking the tile body opens the focused view instead of
   *  downloading (used for image/gif/pdf, which have a real detail view).
   *  The explicit hover download button still downloads. */
  onOpen?: () => void;
}

export function FileTile({
  videoId,
  title,
  contentType,
  fileSize,
  uploaderName,
  createdAt,
  status,
  canDelete,
  draggable,
  onDelete,
  onOpen,
}: FileTileProps) {
  const getDownloadUrl = useAction(api.videoActions.getDownloadUrl);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = fileTypeFromContent(contentType, title);
  const { Icon } = meta;
  const isReady = status === "ready";

  const handleDownload = useCallback(async () => {
    if (!isReady || downloading) return;
    setError(null);
    setDownloading(true);
    try {
      const result = await getDownloadUrl({ videoId });
      triggerDownload(result.url, result.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }, [downloading, getDownloadUrl, isReady, videoId]);

  return (
    <article
      onClick={() => (onOpen ? onOpen() : void handleDownload())}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-snip-video", videoId);
      }}
      className={cn(
        "group flex flex-col cursor-pointer",
        !isReady && "opacity-70",
      )}
    >
      <div
        className="relative aspect-video overflow-hidden border-2 border-[#1a1a1a] shadow-[4px_4px_0px_0px_var(--shadow-color)] group-hover:translate-y-[2px] group-hover:translate-x-[2px] group-hover:shadow-[2px_2px_0px_0px_var(--shadow-color)] transition-all flex items-center justify-center"
        style={{ background: meta.tileBg }}
      >
        <Icon className="h-20 w-20" style={{ color: meta.iconColor }} strokeWidth={1.5} />

        {/* Top-left file-type chip — mirrors Drive's red "PDF" badge */}
        <div
          className="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-[#1a1a1a] text-[#f0f0e8]"
        >
          {meta.label}
        </div>

        {/* Status chip when not ready */}
        {!isReady ? (
          <div className="absolute bottom-2 left-2 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-[#b45309] text-[#f0f0e8]">
            {status}
          </div>
        ) : null}

        {/* Download / more menu, top-right (visible on hover) */}
        <div
          className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={!isReady || downloading}
            className="p-1 bg-[#f0f0e8] border-2 border-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] disabled:opacity-40"
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-1 bg-[#f0f0e8] border-2 border-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8]"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleDownload()}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <ExternalLink className="mr-2 h-4 w-4" />
                Preview (coming soon)
              </DropdownMenuItem>
              {canDelete && onDelete ? (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="text-[#dc2626] focus:text-[#dc2626]"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-3 px-0.5">
        <h3 className="font-bold text-sm text-[#1a1a1a] truncate group-hover:underline">
          {title}
        </h3>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-[#888] font-mono">
          <span className="truncate">{uploaderName}</span>
          <span>·</span>
          <span className="flex-shrink-0">{formatRelativeTime(createdAt)}</span>
          {fileSize != null ? (
            <>
              <span>·</span>
              <span className="flex-shrink-0">{formatBytes(fileSize)}</span>
            </>
          ) : null}
        </div>
        {error ? (
          <div className="text-[11px] text-[#dc2626] mt-1">{error}</div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Single-row list variant that matches snip's existing list view but for
 * non-video files. Tiny icon on the left, name, meta, action chevrons on
 * the right.
 */
export function FileListRow({
  videoId,
  title,
  contentType,
  fileSize,
  uploaderName,
  createdAt,
  status,
  canDelete,
  draggable,
  onDelete,
  onOpen,
}: FileTileProps) {
  const getDownloadUrl = useAction(api.videoActions.getDownloadUrl);
  const [downloading, setDownloading] = useState(false);

  const meta = fileTypeFromContent(contentType, title);
  const { Icon } = meta;
  const isReady = status === "ready";

  const handleDownload = async () => {
    if (!isReady || downloading) return;
    setDownloading(true);
    try {
      const result = await getDownloadUrl({ videoId });
      triggerDownload(result.url, result.filename);
    } catch {
      // swallow — the FileTile error UI handles the loud case
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      onClick={() => (onOpen ? onOpen() : void handleDownload())}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-snip-video", videoId);
      }}
      className="group flex items-center gap-3 px-3 py-2 border-b border-[#ccc] hover:bg-[#e8e8e0] cursor-pointer"
    >
      <div
        className="flex-shrink-0 w-9 h-9 flex items-center justify-center border-2 border-[#1a1a1a]"
        style={{ background: meta.tileBg }}
      >
        <Icon className="h-5 w-5" style={{ color: meta.iconColor }} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm text-[#1a1a1a] truncate">{title}</div>
        <div className="text-[11px] text-[#888] font-mono">
          {meta.label} · {uploaderName} · {formatRelativeTime(createdAt)}
          {fileSize != null ? ` · ${formatBytes(fileSize)}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleDownload();
          }}
          disabled={!isReady || downloading}
          className="p-1.5 border-2 border-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] disabled:opacity-40 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        {canDelete && onDelete ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 border-2 border-[#1a1a1a] text-[#dc2626] hover:bg-[#dc2626] hover:text-[#f0f0e8] opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
