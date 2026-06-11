"use client";

import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { Folder, MoreVertical, Pencil, Trash2 } from "lucide-react";
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
  onDropVideo?: (videoId: Id<"videos">, targetFolderId: Id<"folders">) => void;
  onDropFolder?: (
    droppedFolderId: Id<"folders">,
    targetFolderId: Id<"folders">,
  ) => void;
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
  onDropVideo,
  onDropFolder,
  autoRename,
  onAutoRenameConsumed,
}: Props) {
  const navigate = useNavigate();
  const renameFolder = useMutation(api.folders.rename);
  const removeFolder = useMutation(api.folders.remove);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [dropActive, setDropActive] = useState(false);

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
    if (!confirm(`Delete folder "${name}"? It must be empty.`)) return;
    try {
      await removeFolder({ folderId });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  return (
    <article
      onClick={open}
      onContextMenu={(e) => e.stopPropagation()}
      draggable={canEdit && !editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-snip-folder", folderId);
      }}
      onDragOver={(e) => {
        if (!canEdit) return;
        // Only react to snip payloads — ignore arbitrary HTML5 drag
        // events (e.g. images from the desktop).
        const types = e.dataTransfer.types;
        if (
          types.includes("application/x-snip-video") ||
          types.includes("application/x-snip-folder")
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!dropActive) setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropActive(false);
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
        "group flex items-center gap-2 px-3 py-2 border-2 border-[#1a1a1a] cursor-pointer transition-colors w-full min-w-0",
        dropActive
          ? "bg-[#FF6600] text-[#f0f0e8]"
          : "bg-[#f0f0e8] hover:bg-[#e8e8e0]",
      )}
    >
      <Folder className="h-5 w-5 flex-shrink-0 text-[#888]" strokeWidth={1.75} />
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
            <div className="text-sm font-bold text-[#1a1a1a] truncate">
              {name}
            </div>
            <div className="text-[10px] font-mono text-[#888]">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </div>
          </>
        )}
      </div>
      {canEdit ? (
        <div
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-1 hover:bg-[#1a1a1a] hover:text-[#f0f0e8]"
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
