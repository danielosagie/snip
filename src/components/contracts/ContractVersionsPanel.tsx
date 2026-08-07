"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, RotateCcw, Trash2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

/**
 * Side-panel UI for contract version snapshots. Top row spins a new
 * snapshot of the current state (optionally labeled). Below, the
 * version history lists every snapshot with restore / delete.
 *
 * Restore overwrites the live contract HTML + answers; the panel
 * confirms before firing.
 */
export function ContractVersionsPanel({
  projectId,
  readOnly,
  onRestored,
}: {
  projectId: Id<"projects">;
  readOnly: boolean;
  /** Fired after a successful restore so the parent can rebuild the live
   *  collab doc — restore only patches contract.contentHtml, which the Yjs
   *  editor would otherwise ignore (it shows the in-memory Y.Doc). */
  onRestored?: () => void;
}) {
  const versions = useQuery(api.contractVersions.list, { projectId });
  const snapshot = useMutation(api.contractVersions.snapshot);
  const restore = useMutation(api.contractVersions.restore);
  const remove = useMutation(api.contractVersions.remove);
  const confirmDialog = useConfirmDialog();
  const toast = useToast();

  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSnapshot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await snapshot({ projectId, label: label.trim() || undefined });
      setLabel("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Snapshot failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (
    versionId: Id<"contractVersions">,
    name: string,
  ) => {
    await confirmDialog({
      title: "Restore version",
      description: `Restore ${name} and overwrite current changes?`,
      confirmLabel: "Restore",
      action: async () => {
        setBusy(true);
        try {
          await restore({ versionId });
          // Rebuild the live editor from the restored body so the Y.Doc
          // does not retain the pre-restore content.
          onRestored?.();
        } finally {
          setBusy(false);
        }
      },
      errorMessage: (error) =>
        error instanceof Error ? error.message : "Restore failed.",
    });
  };

  return (
    <div className="space-y-3">
      {!readOnly ? (
        <div className="space-y-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            disabled={busy}
          />
          <Button
            onClick={() => void handleSnapshot()}
            disabled={busy}
            className="w-full"
            size="sm"
          >
            <Camera className="h-3.5 w-3.5 mr-1.5" />
            {busy ? "Saving…" : "Save version"}
          </Button>
        </div>
      ) : null}

      <div className="space-y-2 border-t border-[#F1F1F3] pt-3">
        {versions === undefined ? (
          <div className="text-xs text-[#6E6E73]">Loading…</div>
        ) : versions.length === 0 ? (
          <div className="text-xs italic text-[#6E6E73]">
            No saved versions yet. Save one before risky edits.
          </div>
        ) : (
          versions.map((v) => (
            <div
              key={v._id}
              className="rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-xs font-semibold text-[#131315]">
                  v{v.versionNumber}
                </div>
                <span className="text-[10px] text-[#6E6E73]">
                  {formatRelativeTime(v._creationTime)}
                </span>
              </div>
              {v.label ? (
                <div className="mt-1 truncate text-sm text-[#131315]">
                  {v.label}
                </div>
              ) : null}
              <div className="mt-1 truncate text-[10px] text-[#6E6E73]">
                by {v.createdByName}
              </div>
              {!readOnly ? (
                <div className="flex items-center gap-1 mt-2">
                  <button
                    type="button"
                    onClick={() =>
                      void handleRestore(
                        v._id,
                        `v${v.versionNumber}${v.label ? `, ${v.label}` : ""}`,
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-[#D8D8DE] bg-white px-2.5 py-1 text-[11px] font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3]"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void confirmDialog({
                        title: "Delete version",
                        description: `Version ${v.versionNumber} will be removed.`,
                        confirmLabel: "Delete",
                        variant: "destructive",
                        action: () => remove({ versionId: v._id }),
                        errorMessage: (error) =>
                          error instanceof Error
                            ? error.message
                            : "Couldn't delete version.",
                      });
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#D8D8DE] bg-white text-[#D8434F] transition-colors hover:bg-[#FFF5F5]"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
