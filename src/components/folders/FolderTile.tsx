"use client";

import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { Check, Folder, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { projectPath } from "@/lib/routes";
import { friendlyError } from "@/lib/friendlyError";
import {
  SNIP_VIDEOS_DRAG_TYPE,
  SNIP_VIDEO_DRAG_TYPE,
  readDraggedVideoIds,
} from "@/lib/projectDrag";

const SOFT_MENU_CONTENT =
  "rounded-[12px] border border-[#E8E8EC] bg-white p-1 text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]";
const SOFT_MENU_ITEM =
  "rounded-[8px] px-2.5 py-1.5 text-[13px] font-medium text-[#131315] hover:bg-[#F1F1F3] focus:bg-[#F1F1F3] focus:text-[#131315]";

/**
 * Single folder card. Small, dense — meant to live in a horizontal row at
 * the top of a project view (Google-Drive "Suggested folders" pattern).
 * Clicking navigates into the folder (adds `?folder=<id>` to the URL).
 */

interface Props {
  teamSlug: string;
  projectId: Id<"projects">;
  folderId: Id<"folders">;
  name: string;
  itemCount: number;
  canEdit: boolean;
  selected?: boolean;
  selectionMode?: boolean;
  onSelectToggle?: (event: {
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
  }) => void;
  onDragSelectOnly?: () => void;
  onDropVideo?: (videoId: Id<"videos">, targetFolderId: Id<"folders">) => void;
  onDropVideos?: (
    videoIds: Id<"videos">[],
    targetFolderId: Id<"folders">,
  ) => void;
  onDropFolder?: (
    droppedFolderId: Id<"folders">,
    targetFolderId: Id<"folders">,
  ) => void;
  onDropFiles?: (files: File[], targetFolderId: Id<"folders">) => void;
  /** When true, this tile opens directly into inline rename on mount —
   *  used right after a fresh folder is created so the user names it. */
  autoRename?: boolean;
  onAutoRenameConsumed?: () => void;
}

export function FolderTile({
  teamSlug,
  projectId,
  folderId,
  name,
  itemCount,
  canEdit,
  selected,
  selectionMode,
  onSelectToggle,
  onDragSelectOnly,
  onDropVideo,
  onDropVideos,
  onDropFolder,
  onDropFiles,
  autoRename,
  onAutoRenameConsumed,
}: Props) {
  const navigate = useNavigate();
  const renameFolder = useMutation(api.folders.rename);
  const removeFolder = useMutation(api.folders.remove);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [dropKind, setDropKind] = useState<"files" | "items" | null>(null);

  // Enter inline rename when the parent flags this freshly-created folder.
  // Select-all so the placeholder name ("New Folder") is replaced as the
  // user types — the input is autoFocus, so we only need to set state here.
  useEffect(() => {
    // Only react to the autoRename signal flipping on. The other reads
    // (name/editing/callback) are intentionally not deps so a later render
    // can't re-trigger rename; this project's ESLint doesn't run the
    // react-hooks deps rule, so no disable directive is needed.
    if (autoRename && canEdit && !editing) {
      setDraftName(name);
      setEditing(true);
      onAutoRenameConsumed?.();
    }
  }, [autoRename, canEdit]);

  const open = () => {
    // TanStack's typed navigate doesn't know about this route's search
    // schema from a runtime-built `to`, so we cast through unknown to
    // pass the folder query param. Validation still happens in the
    // route's validateSearch on the receiving side.
    (navigate as unknown as (opts: {
      to: string;
      search?: Record<string, string>;
    }) => void)({
      to: projectPath(teamSlug, projectId),
      search: { folder: folderId },
    });
  };

  const handleRename = async () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    try {
      await renameFolder({ folderId, name: trimmed });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rename failed.");
    } finally {
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        `Delete folder "${name}" and all nested folders? Contained files will remain recoverable in Recently deleted.`,
      )
    )
      return;
    try {
      await removeFolder({ folderId });
    } catch (e) {
      alert(friendlyError(e, "Delete failed."));
    }
  };

  return (
    <article
      data-snip-folder-drop-target="true"
      onClick={(e) => {
        if (
          onSelectToggle &&
          (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey)
        ) {
          e.preventDefault();
          onSelectToggle({
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
          });
          return;
        }
        open();
      }}
      onContextMenu={(e) => e.stopPropagation()}
      draggable={canEdit && !editing}
      onDragStart={(e) => {
        if (selectionMode && !selected) onDragSelectOnly?.();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-snip-folder", folderId);
      }}
      onDragOver={(e) => {
        if (!canEdit) return;
        const types = e.dataTransfer.types;
        const hasFiles = types.includes("Files");
        const hasSnipItems =
          types.includes(SNIP_VIDEO_DRAG_TYPE) ||
          types.includes(SNIP_VIDEOS_DRAG_TYPE) ||
          types.includes("application/x-snip-folder");
        if (hasFiles || hasSnipItems) {
          e.preventDefault();
          e.dataTransfer.dropEffect = hasFiles ? "copy" : "move";
          const nextKind = hasFiles ? "files" : "items";
          if (dropKind !== nextKind) setDropKind(nextKind);
        }
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setDropKind(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropKind(null);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length > 0) {
          onDropFiles?.(files, folderId);
          return;
        }
        e.stopPropagation();
        const videoIds = readDraggedVideoIds(e.dataTransfer);
        if (videoIds.length > 0) {
          if (videoIds.length > 1 && onDropVideos) {
            onDropVideos(videoIds, folderId);
          } else {
            for (const videoId of videoIds) {
              onDropVideo?.(videoId, folderId);
            }
          }
          return;
        }
        const draggedFolderId = e.dataTransfer.getData(
          "application/x-snip-folder",
        );
        if (draggedFolderId && draggedFolderId !== folderId) {
          onDropFolder?.(draggedFolderId as Id<"folders">, folderId);
        }
      }}
      className={cn(
        "group relative flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[12px] border border-[#E8E8EC] bg-white px-3 py-2 text-[#131315] transition-[background-color,border-color,box-shadow] hover:border-[#D8D8DE] hover:shadow-sm",
        dropKind
          ? "border-[#FF6600] bg-[#FFF0E6] text-[#D14E00] shadow-[inset_0_0_0_0.5px_#FF6600]"
          : "hover:bg-[#FAFAFA]",
        selected && !dropKind &&
          "bg-white shadow-[inset_0_0_0_1.5px_#FF6600]",
        (selectionMode || selected) && "pl-10",
      )}
    >
      {selectionMode || selected ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-2 top-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            selected
              ? "bg-[#FF6600] text-white"
              : "border border-[#D8D8DE] bg-white text-transparent",
          )}
        >
          {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
        </span>
      ) : null}
      <Folder
        className={cn("h-5 w-5 flex-shrink-0", dropKind ? "text-[#D14E00]" : "text-[#6E6E73]")}
        strokeWidth={1.75}
      />
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRename();
              if (e.key === "Escape") {
                setDraftName(name);
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => void handleRename()}
            onFocus={(e) => e.currentTarget.select()}
            autoFocus
            className="w-full rounded-[8px] border border-[#E8E8EC] bg-white px-2 py-1 text-sm font-medium text-[#131315] outline-none focus:border-[#FF6600]"
          />
        ) : (
          <>
            <div className={cn("truncate text-sm font-semibold", dropKind ? "text-[#D14E00]" : "text-[#131315]")}>
              {dropKind === "files" ? `Upload into ${name}` : name}
            </div>
            <div className={cn("font-['Geist_Mono',system-ui,sans-serif] text-[11px]", dropKind ? "text-[#D14E00]/80" : "text-[#A0A0A5]")}>
              {dropKind === "files"
                ? "Release to choose this folder"
                : `${itemCount} ${itemCount === 1 ? "item" : "items"}`}
            </div>
          </>
        )}
      </div>
      {canEdit ? (
        <div
          className={cn(
            "transition-opacity",
            selectionMode ? "hidden" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]"
                aria-label="Folder actions"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={SOFT_MENU_CONTENT}>
              <DropdownMenuItem
                className={SOFT_MENU_ITEM}
                onClick={() => {
                  setDraftName(name);
                  setEditing(true);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleDelete()}
                className={cn(
                  SOFT_MENU_ITEM,
                  "text-[#D8434F] hover:bg-[#FFF5F5] focus:bg-[#FFF5F5] focus:text-[#D8434F]",
                )}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </article>
  );
}
