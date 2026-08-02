"use client";

import { Link } from "@tanstack/react-router";
import { Id } from "@convex/_generated/dataModel";
import { contractPath, documentPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Check, FileSignature, FileText } from "lucide-react";

interface ContractListSectionProps {
  projectId: Id<"projects">;
  teamSlug: string;
  projectName: string;
  items:
    | Array<{
        _id: Id<"contracts">;
        title: string;
        docType?: "contract" | "document";
        kind: string;
        status: string;
        recipientCount: number;
        signedCount: number;
      }>
    | undefined;
  legacyContract: {
    clientName?: string;
    signedAt?: number;
    sentForSignatureAt?: number;
  } | null;
  search?: string;
  selectedIds?: Set<Id<"contracts">>;
  legacySelected?: boolean;
  selectionMode?: boolean;
  onSelectToggle?: (contractId: Id<"contracts">) => void;
  onLegacySelectToggle?: () => void;
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
 *
 * Documents are the primary writing surface. Contracts are rendered as a
 * secondary workflow because they add recipients and a signing lifecycle.
 */
export function ContractListSection({
  projectId,
  teamSlug,
  projectName,
  items,
  legacyContract,
  search = "",
  selectedIds,
  legacySelected,
  selectionMode,
  onSelectToggle,
  onLegacySelectToggle,
}: ContractListSectionProps) {
  if (items === undefined) return null;
  const allContractRows = items.filter((row) => (row.docType ?? "contract") === "contract");
  const allDocumentRows = items.filter((row) => row.docType === "document");
  const totalCount =
    allContractRows.length + allDocumentRows.length + (legacyContract ? 1 : 0);
  if (totalCount === 0) {
    return null;
  }
  const q = search.trim().toLowerCase();
  const contractRows = q
    ? allContractRows.filter((row) => row.title.toLowerCase().includes(q))
    : allContractRows;
  const documentRows = q
    ? allDocumentRows.filter((row) => row.title.toLowerCase().includes(q))
    : allDocumentRows;
  const showLegacy =
    legacyContract !== null &&
    (!q ||
      projectName.toLowerCase().includes(q) ||
      legacyContract.clientName?.toLowerCase().includes(q));
  if (q && contractRows.length === 0 && documentRows.length === 0 && !showLegacy) {
    return null;
  }
  const hasContracts = contractRows.length > 0 || showLegacy;
  const hasDocuments = documentRows.length > 0;

  return (
    // Match FolderRow: dense top-padding, plain mono header, no
    // shadow on the section container.
    // stopPropagation on right-click so a contract tile never triggers the
    // project's background context menu — contracts aren't part of the
    // create/combine background gesture.
    <section
      className="flex flex-col gap-4 px-6 pt-4"
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* ── Contracts — signing lifecycle lives here ─────────────── */}
      <div className="order-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
            Contracts
          </div>
        </div>
        {hasContracts ? (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {showLegacy && legacyContract ? (
              <Link
                to={`/dashboard/${teamSlug}/${projectId}/contract`}
                onClick={(event) => {
                  if (
                    onLegacySelectToggle &&
                    (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey)
                  ) {
                    event.preventDefault();
                    onLegacySelectToggle();
                  }
                }}
                className={cn(
                  "group flex min-h-12 items-center gap-2 px-3 py-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#e8e8e0] cursor-pointer transition-[background-color,box-shadow] w-full min-w-0",
                  legacySelected && "bg-[#fff1e8] shadow-[inset_0_0_0_2px_#FF6600]",
                )}
              >
                {selectionMode ? <SelectionBox selected={Boolean(legacySelected)} /> : null}
                <FileSignature
                  className="h-5 w-5 flex-shrink-0 text-[#888]"
                  strokeWidth={1.75}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[#1a1a1a] truncate">
                    {projectName || "Contract"}
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
            {contractRows.map((c) => (
              <Link
                key={c._id}
                to={contractPath(teamSlug, projectId, c._id)}
                onClick={(event) => {
                  if (
                    onSelectToggle &&
                    (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey)
                  ) {
                    event.preventDefault();
                    onSelectToggle(c._id);
                  }
                }}
                className={cn(
                  "group flex min-h-12 items-center gap-2 px-3 py-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#e8e8e0] cursor-pointer transition-[background-color,box-shadow] w-full min-w-0",
                  selectedIds?.has(c._id) && "bg-[#fff1e8] shadow-[inset_0_0_0_2px_#FF6600]",
                )}
              >
                {selectionMode ? <SelectionBox selected={Boolean(selectedIds?.has(c._id))} /> : null}
                <FileSignature
                  className="h-5 w-5 flex-shrink-0 text-[#888]"
                  strokeWidth={1.75}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[#1a1a1a] truncate">
                    {c.title}
                  </div>
                  <div className="text-[10px] font-mono text-[#888] truncate">
                    {c.recipientCount > 0
                      ? `${c.signedCount}/${c.recipientCount} signed`
                      : KIND_LABELS[c.kind] ?? c.kind}
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
            ))}
          </div>
        ) : (
          <div className="text-[11px] font-mono text-[#888] italic">
            No contracts yet.
          </div>
        )}
      </div>

      {/* Documents are the default project writing surface. */}
      <div className="order-1">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
            Documents
          </div>
        </div>
        {hasDocuments ? (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {documentRows.map((d) => (
              <Link
                key={d._id}
                to={documentPath(teamSlug, projectId, d._id)}
                onClick={(event) => {
                  if (
                    onSelectToggle &&
                    (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey)
                  ) {
                    event.preventDefault();
                    onSelectToggle(d._id);
                  }
                }}
                className={cn(
                  "group flex min-h-12 items-center gap-2 px-3 py-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#e8e8e0] cursor-pointer transition-[background-color,box-shadow] w-full min-w-0",
                  selectedIds?.has(d._id) && "bg-[#fff1e8] shadow-[inset_0_0_0_2px_#FF6600]",
                )}
              >
                {selectionMode ? <SelectionBox selected={Boolean(selectedIds?.has(d._id))} /> : null}
                <FileText
                  className="h-5 w-5 flex-shrink-0 text-[#888]"
                  strokeWidth={1.75}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[#1a1a1a] truncate">
                    {d.title}
                  </div>
                  <div className="text-[10px] font-mono text-[#888] truncate">
                    Document
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-[11px] font-mono text-[#888] italic">
            No documents yet.
          </div>
        )}
      </div>
    </section>
  );
}

function SelectionBox({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center border-2 border-[#1a1a1a]",
        selected ? "bg-[#FF6600] text-[#f0f0e8]" : "bg-[#f0f0e8]",
      )}
    >
      {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  );
}
