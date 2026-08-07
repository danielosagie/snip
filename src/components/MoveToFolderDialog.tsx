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
import { cn } from "@/lib/utils";
import { softButton, softButtonPrimary } from "@/components/soft";

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
      <DialogContent className="surface-soft max-h-[80vh] max-w-md gap-4 overflow-y-auto rounded-[14px] border border-[#E8E8EC] bg-white text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold normal-case tracking-[-0.01em] text-[#131315]">
            Move {count} item{count === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>

        {/* Path: Project root > A > B — click a crumb to jump back up. */}
        <div className="flex flex-wrap items-center gap-1 text-[13px] font-medium">
          <button
            type="button"
            onClick={() => setStack([])}
            className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[#131315] hover:bg-[#F1F1F3]"
          >
            <Home className="h-3.5 w-3.5" />
            Project root
          </button>
          {stack.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3 w-3 flex-shrink-0 text-[#A0A0A5]" />
              <button
                type="button"
                onClick={() => setStack((s) => s.slice(0, i + 1))}
                className="max-w-[14ch] truncate rounded-[8px] px-2 py-1 text-[#131315] hover:bg-[#F1F1F3]"
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        {/* Subfolders at this level. Clicking drills in. */}
        <div className="max-h-[40vh] divide-y divide-[#F1F1F3] overflow-y-auto rounded-[11px] border border-[#E8E8EC] bg-white">
          {children === undefined ? (
            <div className="px-3 py-3 text-[13px] text-[#6E6E73]">Loading…</div>
          ) : children.length === 0 ? (
            <div className="px-3 py-3 text-[13px] text-[#6E6E73]">
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
                  className="flex w-full items-center gap-2 bg-white px-3 py-2.5 text-left hover:bg-[#F1F1F3] disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    disabled
                      ? "Items are already in this folder"
                      : `Open ${f.name}`
                  }
                >
                  <Folder className="h-4 w-4 flex-shrink-0 text-[#6E6E73]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#131315]">
                    {f.name}
                  </span>
                  <span className="font-['Geist_Mono',system-ui,sans-serif] text-[11px] text-[#A0A0A5]">
                    {f.itemCount} item{f.itemCount === 1 ? "" : "s"}
                  </span>
                  {!disabled ? (
                    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[#A0A0A5]" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        {error ? (
          <div className="rounded-[10px] bg-[#FFF5F5] px-3 py-2 text-[13px] text-[#D8434F]">
            {error}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            onClick={() => void handleMove()}
            disabled={isMoving || isSameAsCurrent}
            className={cn(softButtonPrimary, "flex-1")}
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
                : `Move to ${here ? here.name : "Project root"}`}
          </Button>
          <Button
            variant="outline"
            className={softButton}
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
