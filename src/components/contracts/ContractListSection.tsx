"use client";

import { Link } from "@tanstack/react-router";
import { Id } from "@convex/_generated/dataModel";
import { contractPath, documentPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Check, FileSignature, FileText } from "lucide-react";

interface ContractListSectionProps {
  projectId: Id<"projects">;
  teamSlug: string;
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
  search?: string;
  selectedIds?: Set<Id<"contracts">>;
  selectionMode?: boolean;
  onSelectToggle?: (contractId: Id<"contracts">) => void;
}

const KIND_LABELS: Record<string, string> = {
  master: "Master agreement",
  sow: "Statement of work",
  nda: "NDA",
  release: "Release form",
  custom: "Custom",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-[#F1F1F3] text-[#6E6E73]",
  pending: "bg-[#FFF0E6] text-[#D14E00]",
  completed: "bg-[#F2FBF5] text-[#225B36]",
  declined: "bg-[#FFF5F5] text-[#8A2B34]",
  voided: "bg-[#F1F1F3] text-[#6E6E73] line-through",
  expired: "bg-[#F1F1F3] text-[#6E6E73]",
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
  items,
  search = "",
  selectedIds,
  selectionMode,
  onSelectToggle,
}: ContractListSectionProps) {
  if (items === undefined) return null;
  const allContractRows = items.filter((row) => (row.docType ?? "contract") === "contract");
  const allDocumentRows = items.filter((row) => row.docType === "document");
  const totalCount =
    allContractRows.length + allDocumentRows.length;
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
  if (q && contractRows.length === 0 && documentRows.length === 0) {
    return null;
  }
  const hasContracts = contractRows.length > 0;
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
          <div className="font-['Geist_Mono',system-ui,sans-serif] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
            Contracts
          </div>
        </div>
        {hasContracts ? (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
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
                  "group flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[12px] border border-[#E8E8EC] bg-white px-3 py-2 transition-[background-color,border-color,box-shadow] hover:border-[#D8D8DE] hover:shadow-sm",
                  selectedIds?.has(c._id) && "shadow-[inset_0_0_0_1.5px_#FF6600]",
                )}
              >
                {selectionMode ? <SelectionBox selected={Boolean(selectedIds?.has(c._id))} /> : null}
                <FileSignature
                  className="h-5 w-5 flex-shrink-0 text-[#6E6E73]"
                  strokeWidth={1.75}
                />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-[#131315]">
                    {c.title}
                  </div>
                  <div className="truncate font-['Geist_Mono',system-ui,sans-serif] text-[11px] text-[#A0A0A5]">
                    {c.recipientCount > 0
                      ? `${c.signedCount}/${c.recipientCount} signed`
                      : KIND_LABELS[c.kind] ?? c.kind}
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
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
          <div className="text-[13px] text-[#A0A0A5]">
            No contracts yet.
          </div>
        )}
      </div>

      {/* Documents are the default project writing surface. */}
      <div className="order-1">
        <div className="flex items-center justify-between mb-2">
          <div className="font-['Geist_Mono',system-ui,sans-serif] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
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
                  "group flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[12px] border border-[#E8E8EC] bg-white px-3 py-2 transition-[background-color,border-color,box-shadow] hover:border-[#D8D8DE] hover:shadow-sm",
                  selectedIds?.has(d._id) && "shadow-[inset_0_0_0_1.5px_#FF6600]",
                )}
              >
                {selectionMode ? <SelectionBox selected={Boolean(selectedIds?.has(d._id))} /> : null}
                <FileText
                  className="h-5 w-5 flex-shrink-0 text-[#6E6E73]"
                  strokeWidth={1.75}
                />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-[#131315]">
                    {d.title}
                  </div>
                  <div className="truncate font-['Geist_Mono',system-ui,sans-serif] text-[11px] text-[#A0A0A5]">
                    Document
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-[13px] text-[#A0A0A5]">
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
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
        selected ? "bg-[#FF6600] text-white" : "border border-[#D8D8DE] bg-white text-transparent",
      )}
    >
      {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  );
}
