"use client";

import { useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { contractPath, documentPath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Check, FileSignature, FileText } from "lucide-react";

interface ContractListSectionProps {
  projectId: Id<"projects">;
  teamSlug: string;
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
 * Contracts and plain documents share the `contracts` table (split by
 * `docType`) but are NOT the same thing to the user: contracts carry
 * signing chrome (status badge, signed counts), documents are just
 * docs. Render them as two distinct groups so a document never looks
 * like something awaiting signature.
 */
export function ContractListSection({
  projectId,
  teamSlug,
}: ContractListSectionProps) {
  // Each group fetches its own kind server-side — documents never ride
  // along in a "contracts" payload and vice versa.
  const contractRows = useQuery(api.contractsTable.list, {
    projectId,
    docType: "contract",
  });
  const documentRows = useQuery(api.contractsTable.list, {
    projectId,
    docType: "document",
  });
  // Legacy embedded contract (the wizard-backed singleton on
  // projects.contract). Surfaced as a synthetic row at the top of the
  // list so a project that pre-dates the multi-contract table still
  // shows its contract here with folder-style tiles, instead of as a
  // separate large file card in the grid.
  const project = useQuery(api.projects.get, { projectId });
  const legacyContract = project?.contract ?? null;

  if (
    contractRows === undefined ||
    documentRows === undefined ||
    project === undefined
  ) {
    return null;
  }
  const totalCount =
    contractRows.length + documentRows.length + (legacyContract ? 1 : 0);
  if (totalCount === 0) {
    return null;
  }
  const hasContracts = contractRows.length > 0 || legacyContract !== null;
  const hasDocuments = documentRows.length > 0;

  return (
    // Match FolderRow: dense top-padding, plain mono header, no
    // shadow on the section container. stopPropagation on right-click so a
    // contract tile never triggers the project's background context menu —
    // contracts aren't part of the create/combine background gesture.
    <section
      className="px-6 pt-4 space-y-4"
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* ── Contracts — signing lifecycle lives here ─────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
            Contracts
          </div>
        </div>
        {hasContracts ? (
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
            {contractRows.map((c) => (
              <Link
                key={c._id}
                to={contractPath(teamSlug, projectId, c._id)}
                className="group flex items-center gap-2 px-3 py-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#e8e8e0] cursor-pointer transition-colors w-full min-w-0"
              >
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

      {/* ── Documents — plain docs, no signing chrome ────────────── */}
      <div>
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
                className="group flex items-center gap-2 px-3 py-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#e8e8e0] cursor-pointer transition-colors w-full min-w-0"
              >
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
