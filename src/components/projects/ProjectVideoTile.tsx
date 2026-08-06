"use client";

import { memo, useCallback, useState } from "react";
import {
  Check,
  Download,
  Eye,
  FolderPlus,
  Link as LinkIcon,
  MessageSquare,
  MoreVertical,
  Play,
  Trash2,
} from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { cn, formatDuration, formatRelativeTime } from "@/lib/utils";
import { ContextMenu } from "@/components/ui/context-menu";
import { MediaHoverPreview } from "@/components/media/MediaHoverPreview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  VideoWorkflowStatusButton,
  VideoWorkflowStatusControl,
} from "@/components/videos/VideoWorkflowStatusControl";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";
import {
  SNIP_VIDEO_DRAG_TYPE,
  setDraggedVideoData,
} from "@/lib/projectDrag";
import {
  useDeferredMenus,
  type ProjectTileActions,
  type ProjectVideoItem,
} from "./projectTileShared";

const SOFT_MENU_CONTENT =
  "rounded-[12px] border border-[#E8E8EC] bg-white p-1 text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]";
const SOFT_MENU_ITEM =
  "rounded-[8px] px-2.5 py-1.5 text-[13px] font-medium text-[#131315] hover:bg-[#F1F1F3] focus:bg-[#F1F1F3] focus:text-[#131315]";
const ACTIONS_BUTTON =
  "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] border border-[#E8E8EC] bg-white text-[#6E6E73] shadow-sm hover:bg-[#F1F1F3] hover:text-[#131315]";

export type ProjectVideoTileProps = {
  video: ProjectVideoItem;
  actions: ProjectTileActions;
  /** Primitives only — a `Set` prop would change identity on every click and
   *  defeat the memo for every tile in the grid. */
  selected: boolean;
  selectionMode: boolean;
  canEdit: boolean;
  canDownload: boolean;
  watchingCount: number;
};

function ProjectVideoTileImpl({
  video,
  actions,
  selected,
  selectionMode,
  canEdit,
  canDownload,
  watchingCount,
}: ProjectVideoTileProps) {
  const videoId = video._id;
  const [combineActive, setCombineActive] = useState(false);
  const { rootRef, armed, arm, armFromFocus } =
    useDeferredMenus<HTMLDivElement>();
  const [statusOpen, setStatusOpen] = useState(false);

  const prewarmIntentHandlers = useRoutePrewarmIntent(() =>
    actions.prewarm(videoId, video.muxPlaybackId),
  );

  const buildMenu = useCallback(
    () => actions.buildMenu(video, canDownload),
    [actions, video, canDownload],
  );

  const thumbnailSrc = video.thumbnailUrl?.startsWith("http")
    ? video.thumbnailUrl
    : undefined;

  return (
    <ContextMenu items={buildMenu}>
      <div
        ref={rootRef}
        data-grid-cell=""
        onPointerEnter={arm}
        onFocusCapture={armFromFocus}
        className={cn(
          "group relative flex cursor-pointer flex-col overflow-hidden rounded-[12px] border border-[#E8E8EC] bg-white transition-[border-color,box-shadow] hover:border-[#D8D8DE] hover:shadow-sm",
          selected &&
            "after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-[12px] after:shadow-[inset_0_0_0_1.5px_#FF6600]",
          combineActive && "ring-[1.5px] ring-inset ring-[#FF6600]",
        )}
        onDragOver={
          canEdit
            ? (e) => {
                // Only react to a dragged video; ignore folder drags and
                // arbitrary desktop files. A self-drop can't be detected here
                // (the payload isn't readable during dragover) so we let it
                // highlight, then no-op on drop.
                if (!e.dataTransfer.types.includes(SNIP_VIDEO_DRAG_TYPE)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
                if (!combineActive) setCombineActive(true);
              }
            : undefined
        }
        onDragLeave={canEdit ? () => setCombineActive(false) : undefined}
        onDrop={
          canEdit
            ? (e) => {
                if (!e.dataTransfer.types.includes(SNIP_VIDEO_DRAG_TYPE)) return;
                e.preventDefault();
                e.stopPropagation();
                setCombineActive(false);
                const draggedId = e.dataTransfer.getData(SNIP_VIDEO_DRAG_TYPE);
                if (draggedId && draggedId !== videoId) {
                  actions.combine(videoId, draggedId as Id<"videos">);
                }
              }
            : undefined
        }
        onClick={(e) => {
          // In selection mode a plain click toggles. Otherwise Cmd/Ctrl+click
          // toggles a single item, Shift+click extends the range, and a plain
          // click falls through to open.
          if (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            actions.selectToggle(videoId, {
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
            });
            return;
          }
          actions.open(videoId);
        }}
        draggable={canEdit}
        onDragStart={(e) => {
          if (!canEdit) return;
          if (selectionMode && !selected) actions.dragSelectOnly(videoId);
          const selection = actions.currentSelectionIds();
          const draggedIds =
            selected && selection.length > 1 ? selection : [videoId];
          setDraggedVideoData(e.dataTransfer, videoId, draggedIds);
        }}
        {...prewarmIntentHandlers}
      >
        {combineActive ? (
          <div className="pointer-events-none absolute left-2 top-2 z-30 inline-flex items-center gap-1 rounded-[6px] bg-[#FFF0E6] px-2 py-0.5 font-['Geist_Mono',system-ui,sans-serif] text-[10px] font-medium uppercase tracking-widest text-[#D14E00]">
            <FolderPlus className="h-3 w-3" />
            New folder
          </div>
        ) : null}
        {selectionMode || selected ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-2 top-2 z-40 flex h-5 w-5 items-center justify-center rounded-full",
              selected
                ? "bg-[#FF6600] text-white"
                : "border border-[#D8D8DE] bg-white text-transparent",
            )}
          >
            {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
          </span>
        ) : null}

        <div className="relative aspect-video overflow-hidden bg-[#F1F1F3]">
          {thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt={video.title}
              loading="lazy"
              className="object-cover w-full h-full"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Play className="h-10 w-10 text-[#A0A0A5]" />
            </div>
          )}
          {armed && video.status === "ready" ? (
            <MediaHoverPreview
              videoId={videoId}
              title={video.title}
              posterUrl={thumbnailSrc}
              duration={video.duration}
            />
          ) : null}
          {video.status === "ready" && video.duration && (
            <div className="absolute bottom-2 right-2 rounded-[6px] bg-[#131315]/80 px-1.5 py-0.5 font-['Geist_Mono',system-ui,sans-serif] text-[11px] text-white">
              {formatDuration(video.duration)}
            </div>
          )}
          {video.status !== "ready" && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <span className="text-[13px] font-medium text-white">
                {video.renditionEvictedAt ? (
                  video.status === "processing" ? (
                    "Rebuilding…"
                  ) : (
                    "Archived"
                  )
                ) : (
                  <>
                    {video.status === "uploading" && "Uploading..."}
                    {video.status === "processing" && "Processing..."}
                    {video.status === "failed" && "Failed"}
                  </>
                )}
              </span>
            </div>
          )}

          {/* Hover menu — the Radix root only exists once the tile is armed. */}
          <div className="absolute top-2 right-2 z-40 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {armed ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  asChild
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    data-defer-focus="actions"
                    className={ACTIONS_BUTTON}
                    aria-label="Video actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={SOFT_MENU_CONTENT}>
                  {canDownload && (
                    <DropdownMenuItem
                      className={SOFT_MENU_ITEM}
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.download(videoId, video.title);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className={SOFT_MENU_ITEM}
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.share(video);
                    }}
                  >
                    <LinkIcon className="mr-2 h-4 w-4" />
                    Share
                  </DropdownMenuItem>
                  {canEdit && (
                    <DropdownMenuItem
                      className={cn(
                        SOFT_MENU_ITEM,
                        "text-[#D8434F] hover:bg-[#FFF5F5] focus:bg-[#FFF5F5] focus:text-[#D8434F]",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.remove(videoId);
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                type="button"
                data-defer-focus="actions"
                className={ACTIONS_BUTTON}
                aria-label="Video actions"
                onClick={(e) => {
                  e.stopPropagation();
                  arm();
                }}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="px-3 pb-3 pt-2.5">
          <p className="truncate text-sm font-semibold leading-5 text-[#131315]">
            {video.title}
          </p>
          <div className="mt-1.5 flex items-center gap-3">
            {armed ? (
              <VideoWorkflowStatusControl
                status={video.workflowStatus}
                soft
                stopPropagation
                disabled={!canEdit}
                defaultOpen={statusOpen}
                triggerProps={{ "data-defer-focus": "status" }}
                onChange={(workflowStatus) =>
                  actions.setWorkflowStatus(videoId, workflowStatus)
                }
              />
            ) : (
              <VideoWorkflowStatusButton
                status={video.workflowStatus}
                soft
                disabled={!canEdit}
                data-defer-focus="status"
                onClick={(e) => {
                  e.stopPropagation();
                  setStatusOpen(true);
                  arm();
                }}
              />
            )}
            {video.commentCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[#A0A0A5]">
                <MessageSquare className="h-3 w-3" />
                {video.commentCount}
              </span>
            )}
            {watchingCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[#6E6E73]">
                <Eye className="h-3 w-3" />
                {watchingCount}
              </span>
            )}
            <span className="ml-auto font-['Geist_Mono',system-ui,sans-serif] text-[11px] text-[#A0A0A5]">
              {formatRelativeTime(video._creationTime)}
            </span>
          </div>
        </div>
      </div>
    </ContextMenu>
  );
}

export const ProjectVideoTile = memo(ProjectVideoTileImpl);
