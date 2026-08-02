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
  onDropVideo?: (videoId: Id<"videos">, targetFolderId: Id<"folders">) => void;
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
  onDropVideo,
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
      draggable={canEdit && !editing && !selectionMode}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-snip-folder", folderId);
      }}
      onDragOver={(e) => {
        if (!canEdit) return;
        const types = e.dataTransfer.types;
        const hasFiles = types.includes("Files");
        const hasSnipItems =
          types.includes("application/x-snip-video") ||
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
        const videoId = e.dataTransfer.getData("application/x-snip-video");
        if (videoId) {
          onDropVideo?.(videoId as Id<"videos">, folderId);
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
        "group relative flex min-h-12 items-center gap-2 px-3 py-2 border-2 border-[#1a1a1a] cursor-pointer transition-[background-color,box-shadow] w-full min-w-0",
        dropKind
          ? "bg-[#FF6600] text-[#f0f0e8]"
          : "bg-[#f0f0e8] hover:bg-[#e8e8e0]",
        selected && !dropKind && "bg-[#fff1e8] shadow-[inset_0_0_0_2px_#FF6600]",
      )}
    >
      {selectionMode ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center border-2 border-[#1a1a1a]",
            selected ? "bg-[#FF6600] text-white" : "bg-[#f0f0e8]",
          )}
        >
          {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
        </span>
      ) : null}
      <Folder
        className={cn("h-5 w-5 flex-shrink-0", dropKind ? "text-[#f0f0e8]" : "text-[#888]")}
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
            className="w-full px-1 py-0.5 text-sm font-bold border border-[#1a1a1a] bg-[#f0f0e8]"
          />
        ) : (
          <>
            <div className={cn("text-sm font-bold truncate", dropKind ? "text-[#f0f0e8]" : "text-[#1a1a1a]")}>
              {dropKind === "files" ? `Upload into ${name}` : name}
            </div>
            <div className={cn("text-[10px] font-mono", dropKind ? "text-[#f0f0e8]/80" : "text-[#888]")}>
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
                className="inline-flex h-10 w-10 items-center justify-center hover:bg-[#1a1a1a] hover:text-[#f0f0e8]"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
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
                className="text-[#dc2626] focus:text-[#dc2626]"
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
