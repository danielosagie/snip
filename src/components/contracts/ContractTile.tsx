"use client";

import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  FileSignature,
  Check,
  FileText,
  Send,
  MoreVertical,
  Trash2,
  Plus,
} from "lucide-react";
import { Id } from "@convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

interface Contract {
  signedAt?: number;
  sentForSignatureAt?: number;
  clientName?: string;
  priceCents?: number;
  currency?: string;
  lastSavedAt?: number;
  docxS3Key?: string;
}

interface Props {
  teamSlug: string;
  projectId: Id<"projects">;
  projectName: string;
  contract?: Contract | null;
  /** When true (admin/member), the hover menu shows a delete option. */
  canDelete?: boolean;
}

/**
 * Project's contract surfaced as a first-class tile in the project grid —
 * looks like a video card, behaves like a file. Clicking opens the
 * full-page Ghost-style editor at `/dashboard/<slug>/<projectId>/contract`.
 *
 * Drag works like a video tile (HTML5 `draggable`); we don't act on the
 * drag yet (no destinations to move TO), but the affordance is there so
 * folders + files feel consistent.
 */
export function ContractTile({
  teamSlug,
  projectId,
  projectName,
  contract,
  canDelete,
}: Props) {
  const clearContract = useMutation(api.projects.clearContract);
  const confirmDialog = useConfirmDialog();

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await confirmDialog({
      title: "Delete contract",
      description: `Delete ${projectName}'s contract? You can redraft it later.`,
      confirmLabel: "Delete",
      variant: "destructive",
      action: () => clearContract({ projectId }),
      errorMessage: (error) =>
        error instanceof Error ? error.message : "Couldn't delete contract.",
    });
  };

  const status = contract?.signedAt
    ? "signed"
    : contract?.sentForSignatureAt
      ? "sent"
      : contract
        ? "draft"
        : "missing";

  const headline =
    status === "signed"
      ? "Signed"
      : status === "sent"
        ? "Awaiting signature"
        : status === "draft"
          ? "Draft"
          : "Tap to draft";

  const subtext = contract?.clientName
    ? `Client: ${contract.clientName}`
    : status === "missing"
      ? "Statement of work"
      : "Statement of work";

  return (
    <Link
      to={`/dashboard/${teamSlug}/${projectId}/contract`}
      className="group flex flex-col cursor-pointer"
      draggable
      onDragStart={(e) => {
        // Drag data — useful if we later add a "drop on signature box" target.
        e.dataTransfer.setData(
          "application/x-videoinfra-contract",
          JSON.stringify({ projectId, teamSlug }),
        );
        e.dataTransfer.effectAllowed = "copyMove";
      }}
    >
      <div
        className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[14px] border border-[#E8E8EC] transition-colors"
        style={{
          background:
            status === "signed"
              ? "#F2FBF5"
              : status === "sent"
                ? "#FFF9EC"
                : status === "draft"
                  ? "#FAFAFA"
                  : "#F1F1F3",
        }}
      >
        <FileSignature
          className={
            "h-16 w-16 " +
            (status === "signed"
              ? "text-[#225B36]"
              : status === "sent"
                ? "text-[#74521D]"
                : status === "draft"
                  ? "text-[#6E6E73]"
                  : "text-[#A0A0A5]")
          }
        />
        <div className="absolute left-2 top-2 rounded-full border border-[#D8D8DE] bg-white px-2 py-0.5 text-[11px] font-medium text-[#6E6E73]">
          .docx
        </div>
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          {status === "signed" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#F2FBF5] px-2 py-1 text-[11px] font-medium text-[#225B36]">
              <Check className="h-3 w-3" />
              Signed
            </span>
          ) : status === "sent" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF9EC] px-2 py-1 text-[11px] font-medium text-[#74521D]">
              <Send className="h-3 w-3" />
              Sent
            </span>
          ) : status === "missing" ? (
            // No contract yet — show a quiet "add" affordance, not a
            // red "missing" alarm. Deletion is final; this tile lives
            // as the project's contract slot whether or not anyone's
            // drafted into it yet.
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-medium text-[#6E6E73]">
              <Plus className="h-3 w-3" />
              Draft
            </span>
          ) : null}
        </div>
        {contract?.docxS3Key ? (
          <div className="absolute right-2 top-2 rounded-full bg-[#FFF0E6] px-2 py-1 text-[11px] font-medium text-[#D14E00]">
            In folder
          </div>
        ) : null}
        {canDelete && contract ? (
          <div
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.preventDefault()}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[#D8D8DE] bg-white text-[#131315] transition-colors hover:bg-[#F1F1F3]"
                  aria-label="Contract menu"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => void handleDelete(e)}
                  className="text-[#D8434F] focus:text-[#D8434F]"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete contract
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      <div className="mt-3">
        <h3 className="truncate text-sm font-semibold text-[#131315] group-hover:underline">
          Contract: {projectName}
        </h3>
        <div className="mt-1 flex items-center gap-2 text-xs text-[#6E6E73]">
          <FileText className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{headline}</span>
          <span className="ml-auto truncate">{subtext}</span>
        </div>
        {contract?.priceCents && contract.currency ? (
          <div className="mt-1 text-[11px] text-[#6E6E73]">
            {(contract.priceCents / 100).toFixed(2)}{" "}
            {contract.currency.toUpperCase()}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
