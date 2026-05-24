"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, RotateCcw, Trash2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

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

  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSnapshot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await snapshot({ projectId, label: label.trim() || undefined });
      setLabel("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Snapshot failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (
    versionId: Id<"contractVersions">,
    name: string,
  ) => {
    if (
      !confirm(
        `Restore ${name}? Your current contract will be overwritten (and lost unless you snapshot first).`,
      )
    )
      return;
    setBusy(true);
    try {
      await restore({ versionId });
      // Rebuild the live editor from the restored body — without this the
      // Y.Doc keeps the pre-restore content and the restore looks like a no-op.
      onRestored?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
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

      <div className="border-t-2 border-[#1a1a1a] pt-3 space-y-2">
        {versions === undefined ? (
          <div className="text-xs text-[#888]">Loading…</div>
        ) : versions.length === 0 ? (
          <div className="text-xs text-[#888] italic">
            No saved versions yet. Save one before risky edits.
          </div>
        ) : (
          versions.map((v) => (
            <div
              key={v._id}
              className="border-2 border-[#1a1a1a] p-2.5 bg-[#f0f0e8]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-bold text-xs uppercase tracking-wider">
                  v{v.versionNumber}
                </div>
                <span className="text-[10px] font-mono text-[#888]">
                  {formatRelativeTime(v._creationTime)}
                </span>
              </div>
              {v.label ? (
                <div className="mt-1 text-sm text-[#1a1a1a] truncate">
                  {v.label}
                </div>
              ) : null}
              <div className="mt-1 text-[10px] font-mono text-[#888] truncate">
                by {v.createdByName}
              </div>
              {!readOnly ? (
                <div className="flex items-center gap-1 mt-2">
                  <button
                    type="button"
                    onClick={() =>
                      void handleRestore(
                        v._id,
                        `v${v.versionNumber}${v.label ? ` — ${v.label}` : ""}`,
                      )
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 border-2 border-[#1a1a1a] text-[10px] font-bold uppercase tracking-wider hover:bg-[#1a1a1a] hover:text-[#f0f0e8] transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(`Delete v${v.versionNumber}?`)) return;
                      void remove({ versionId: v._id });
                    }}
                    className="inline-flex items-center justify-center w-7 h-7 border-2 border-[#1a1a1a] text-[#dc2626] hover:bg-[#dc2626] hover:text-[#f0f0e8] transition-colors"
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
