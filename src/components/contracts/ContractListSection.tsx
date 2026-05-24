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
import { cn } from "@/lib/utils";
import { Check, FileSignature, FileText, Plus } from "lucide-react";

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
  // Legacy embedded contract (the wizard-backed singleton on
  // projects.contract). Surfaced as a synthetic row at the top of the
  // list so a project that pre-dates the multi-contract table still
  // shows its contract here with folder-style tiles, instead of as a
  // separate large file card in the grid.
  const project = useQuery(api.projects.get, { projectId });
  const legacyContract = project?.contract ?? null;
  const [createOpen, setCreateOpen] = useState(false);

  if (contracts === undefined || project === undefined) {
    return null;
  }
  const totalCount = contracts.length + (legacyContract ? 1 : 0);
  if (totalCount === 0 && !canEdit) {
    return null;
  }

  return (
    // Match FolderRow: dense top-padding, plain mono header, no
    // shadow on the section container.
    <section className="px-6 pt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
          Contracts
          {totalCount > 0 && (
            <span className="ml-2 text-[#C2410C]">{totalCount}</span>
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

      {totalCount === 0 ? (
        <div className="border-2 border-dashed border-[#1a1a1a]/30 bg-[#f0f0e8] p-6 text-center text-sm text-[#888]">
          No contracts yet. Click <span className="font-bold">New contract</span> to draft one.
        </div>
      ) : (
        // Folder-tile parity: dense horizontal rows, 2px border, no
        // drop-shadow, single FileSignature icon on the left, name +
        // subline of meta on the right. Click navigates to the editor.
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {legacyContract ? (
            <Link
              to={`/dashboard/${teamSlug}/${projectId}/contract`}
              className="group flex items-center gap-2 px-3 py-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#e8e8e0] cursor-pointer transition-colors w-full min-w-0"
            >
              <FileSignature
                className="h-5 w-5 flex-shrink-0 text-[#888]"
                strokeWidth={1.75}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-[#1a1a1a] truncate">
                  {project?.name ?? "Contract"}
                </div>
                <div className="text-[10px] font-mono text-[#888] truncate">
                  {legacyContract.clientName
                    ? `Client: ${legacyContract.clientName}`
                    : "Statement of work"}
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 inline-flex items-center px-1.5 py-0.5 border text-[9px] font-bold uppercase tracking-wider",
                  legacyContract.signedAt
                    ? STATUS_STYLES.completed
                    : legacyContract.sentForSignatureAt
                      ? STATUS_STYLES.pending
                      : STATUS_STYLES.draft,
                )}
              >
                {legacyContract.signedAt ? (
                  <>
                    <Check className="mr-0.5 h-2.5 w-2.5" strokeWidth={3} />
                    signed
                  </>
                ) : legacyContract.sentForSignatureAt ? (
                  "sent"
                ) : (
                  "draft"
                )}
              </span>
            </Link>
          ) : null}
          {contracts.map((c) => {
            const isDoc = c.docType === "document";
            const meta = isDoc
              ? "Document"
              : c.recipientCount > 0
                ? `${c.signedCount}/${c.recipientCount} signed`
                : KIND_LABELS[c.kind] ?? c.kind;
            const Icon = isDoc ? FileText : FileSignature;
            return (
              <Link
                key={c._id}
                to={contractPath(teamSlug, projectId, c._id)}
                className="group flex items-center gap-2 px-3 py-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#e8e8e0] cursor-pointer transition-colors w-full min-w-0"
              >
                <Icon
                  className="h-5 w-5 flex-shrink-0 text-[#888]"
                  strokeWidth={1.75}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[#1a1a1a] truncate">
                    {c.title}
                  </div>
                  <div className="text-[10px] font-mono text-[#888] truncate">
                    {meta}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 inline-flex items-center px-1.5 py-0.5 border text-[9px] font-bold uppercase tracking-wider",
                    STATUS_STYLES[c.status] ?? STATUS_STYLES.draft,
                  )}
                >
                  {c.status === "completed" ? (
                    <>
                      <Check className="mr-0.5 h-2.5 w-2.5" strokeWidth={3} />
                      {c.status}
                    </>
                  ) : (
                    c.status
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
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
