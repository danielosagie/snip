"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { contractPath } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn, formatRelativeTime } from "@/lib/utils";
import { FileSignature, Plus } from "lucide-react";

interface ContractListSectionProps {
  projectId: Id<"projects">;
  teamSlug: string;
  canEdit: boolean;
}

const KIND_LABELS: Record<string, string> = {
  master: "Master agreement",
  sow: "Statement of work",
  nda: "NDA",
  release: "Release form",
  custom: "Custom",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "border-[#888] text-[#888]",
  pending: "border-[#C2410C] text-[#C2410C] bg-[#FFEDD5]",
  completed: "border-[#16a34a] text-[#16a34a]",
  declined: "border-[#dc2626] text-[#dc2626]",
  voided: "border-[#888] text-[#888] line-through",
  expired: "border-[#888] text-[#888]",
};

/**
 * Multi-contract list — replaces the single ContractTile when the
 * project has any contracts in the new table. Auto-hides when empty
 * AND there's no embedded contract (caller handles back-compat).
 */
export function ContractListSection({
  projectId,
  teamSlug,
  canEdit,
}: ContractListSectionProps) {
  const contracts = useQuery(api.contractsTable.list, { projectId });
  const [createOpen, setCreateOpen] = useState(false);

  if (contracts === undefined) {
    return null;
  }
  if (contracts.length === 0 && !canEdit) {
    return null;
  }

  return (
    <div className="px-6 pt-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <FileSignature className="h-4 w-4 text-[#1a1a1a]" />
          <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#1a1a1a]">
            Contracts
          </h3>
          {contracts.length > 0 && (
            <span className="text-[11px] font-mono font-bold text-[#C2410C]">
              {contracts.length}
            </span>
          )}
        </div>
        {canEdit && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-bold uppercase tracking-wider border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] shadow-[2px_2px_0px_0px_#1a1a1a] hover:bg-[#FFEDD5] active:translate-y-[1px] active:translate-x-[1px] active:shadow-[1px_1px_0px_0px_#1a1a1a] transition-all"
              >
                <Plus className="h-3.5 w-3.5" />
                New contract
              </button>
            </DialogTrigger>
            <NewContractDialogContent
              projectId={projectId}
              onCreated={() => setCreateOpen(false)}
            />
          </Dialog>
        )}
      </div>

      {contracts.length === 0 ? (
        <div className="border-2 border-dashed border-[#1a1a1a]/30 bg-[#f0f0e8] p-6 text-center text-sm text-[#888]">
          No contracts yet. Click <span className="font-bold">New contract</span> to draft one.
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {contracts.map((c) => (
            <Link
              key={c._id}
              to={contractPath(teamSlug, projectId, c._id)}
              className="block border-2 border-[#1a1a1a] bg-[#f0f0e8] p-4 shadow-[4px_4px_0px_0px_#1a1a1a] hover:bg-[#FFEDD5] hover:-translate-y-[1px] hover:-translate-x-[1px] hover:shadow-[5px_5px_0px_0px_#1a1a1a] transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-0.5">
                    {KIND_LABELS[c.kind] ?? c.kind}
                  </div>
                  <div className="text-sm font-black tracking-tight text-[#1a1a1a] truncate">
                    {c.title}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 inline-flex items-center px-2 py-0.5 border-2 text-[10px] font-bold uppercase tracking-wider bg-[#f0f0e8]",
                    STATUS_STYLES[c.status] ?? STATUS_STYLES.draft,
                  )}
                >
                  {c.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-[#888]">
                <span>
                  {c.recipientCount > 0
                    ? `${c.signedCount}/${c.recipientCount} signed`
                    : "No recipients yet"}
                </span>
                <span>{formatRelativeTime(c.lastSavedAt ?? c._creationTime)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewContractDialogContent({
  projectId,
  onCreated,
}: {
  projectId: Id<"projects">;
  onCreated: () => void;
}) {
  const create = useMutation(api.contractsTable.create);
  const [kind, setKind] = useState<"master" | "sow" | "nda" | "release" | "custom">("sow");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await create({
        projectId,
        title: title.trim(),
        kind,
        contentHtml: "",
      });
      onCreated();
      setTitle("");
      setKind("sow");
    } catch (err) {
      console.error("Failed to create contract", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[8px_8px_0px_0px_#1a1a1a]">
      <DialogHeader>
        <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-[#1a1a1a]">
          New contract
        </DialogTitle>
        <DialogDescription className="text-sm text-[#888]">
          Drafts can be edited freely. Send for signature to lock it.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div>
          <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-1.5">
            Kind
          </label>
          <div className="grid grid-cols-5 gap-1">
            {(["master", "sow", "nda", "release", "custom"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "h-9 border-2 border-[#1a1a1a] text-[10px] font-bold uppercase tracking-wider transition-colors",
                  kind === k
                    ? "bg-[#1a1a1a] text-[#f0f0e8]"
                    : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#FFEDD5]",
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-1.5">
            Title
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. SOW — Spring product launch video"
            className="border-2 border-[#1a1a1a] bg-[#f0f0e8] rounded-none"
            autoFocus
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={handleCreate}
          disabled={submitting || !title.trim()}
        >
          {submitting ? "Creating…" : "Create draft"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
