"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronRight, Folder, Home, CornerDownRight } from "lucide-react";

/**
 * Navigable folder-tree picker. Drills down one level at a time via
 * api.folders.list(parentFolderId) — no recursive tree fetch — so it
 * scales to deep/large projects. "Move here" targets whatever level is
 * currently open (Project root when the crumb stack is empty).
 *
 * Generic over what's being moved: the parent passes `onConfirm` with the
 * chosen destination (null = project root) and owns the actual mutation
 * loop (so this works for one or many videos without bundle plumbing).
 */

interface Crumb {
  id: Id<"folders">;
  name: string;
}

interface MoveToFolderDialogProps {
  projectId: Id<"projects">;
  count: number;
  /** Where the items are now — that folder is shown disabled (moving into
   *  the folder you're already in is a no-op). */
  currentFolderId: Id<"folders"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (destinationFolderId: Id<"folders"> | null) => Promise<void>;
}

export function MoveToFolderDialog({
  projectId,
  count,
  currentFolderId,
  open,
  onOpenChange,
  onConfirm,
}: MoveToFolderDialogProps) {
  // Crumb stack the user has drilled into. Empty = project root.
  const [stack, setStack] = useState<Crumb[]>([]);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const here = stack.length > 0 ? stack[stack.length - 1] : null;
  const destinationId = here?.id ?? null;

  const children = useQuery(
    api.folders.list,
    open
      ? { projectId, parentFolderId: here?.id ?? undefined }
      : "skip",
  );

  const reset = () => {
    setStack([]);
    setError(null);
    setIsMoving(false);
  };

  const isSameAsCurrent = destinationId === currentFolderId;

  const handleMove = async () => {
    if (isSameAsCurrent) return;
    setError(null);
    setIsMoving(true);
    try {
      await onConfirm(destinationId);
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Move failed.");
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>
            Move {count} item{count === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>

        {/* Path: Project root > A > B — click a crumb to jump back up. */}
        <div className="flex items-center gap-1 flex-wrap text-xs font-bold">
          <button
            type="button"
            onClick={() => setStack([])}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[#1a1a1a] hover:bg-[#e8e8e0]"
          >
            <Home className="h-3.5 w-3.5" />
            Project root
          </button>
          {stack.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3 w-3 text-[#888] flex-shrink-0" />
              <button
                type="button"
                onClick={() => setStack((s) => s.slice(0, i + 1))}
                className="px-1.5 py-0.5 truncate max-w-[14ch] text-[#1a1a1a] hover:bg-[#e8e8e0]"
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        {/* Subfolders at this level. Clicking drills in. */}
        <div className="border-2 border-[#1a1a1a] divide-y-2 divide-[#1a1a1a] max-h-[40vh] overflow-y-auto">
          {children === undefined ? (
            <div className="px-3 py-3 text-xs text-[#888]">Loading…</div>
          ) : children.length === 0 ? (
            <div className="px-3 py-3 text-xs text-[#888]">
              No subfolders here.
            </div>
          ) : (
            children.map((f) => {
              const disabled = f._id === currentFolderId;
              return (
                <button
                  key={f._id}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setStack((s) => [...s, { id: f._id, name: f.name }])
                  }
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-[#f0f0e8] text-left hover:bg-[#e8e8e0] disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    disabled
                      ? "Items are already in this folder"
                      : `Open ${f.name}`
                  }
                >
                  <Folder className="h-4 w-4 flex-shrink-0 text-[#1a1a1a]" />
                  <span className="flex-1 min-w-0 truncate text-sm font-bold">
                    {f.name}
                  </span>
                  <span className="text-[10px] font-mono text-[#888]">
                    {f.itemCount} item{f.itemCount === 1 ? "" : "s"}
                  </span>
                  {!disabled ? (
                    <ChevronRight className="h-3.5 w-3.5 text-[#888] flex-shrink-0" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        {error ? (
          <div className="text-xs text-[#dc2626] border-l-2 border-[#dc2626] pl-2">
            {error}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            onClick={() => void handleMove()}
            disabled={isMoving || isSameAsCurrent}
            className="flex-1"
            title={
              isSameAsCurrent
                ? "Items are already here"
                : undefined
            }
          >
            <CornerDownRight className="mr-2 h-4 w-4" />
            {isMoving
              ? "Moving…"
              : isSameAsCurrent
                ? "Already here"
                : `Move here → ${here ? here.name : "Project root"}`}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
