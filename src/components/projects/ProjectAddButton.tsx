"use client";

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Plus, Upload, FolderPlus, FileSignature, FileText } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { contractPath, documentPath } from "@/lib/routes";
import { friendlyError } from "@/lib/friendlyError";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NamePromptDialog } from "@/components/ui/name-prompt-dialog";

const SOFT_MENU_CONTENT =
  "rounded-[12px] border border-[#E8E8EC] bg-white p-1 text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]";
const SOFT_MENU_ITEM =
  "rounded-[8px] px-2.5 py-1.5 text-[13px] font-medium text-[#131315] hover:bg-[#F1F1F3] focus:bg-[#F1F1F3] focus:text-[#131315]";

/**
 * Compact "Add" dropdown in the DashboardHeader on a project page. Actions:
 * upload files, create a folder, add a contract.
 *
 * "Add contract" creates a new draft in the multi-contract table and drops you
 * into its editor. There's no single "the contract" per project anymore, so the
 * old contract-aware Edit/View link is gone — every contract is its own tile in
 * the Contracts section.
 */

interface Props {
  projectId: Id<"projects">;
  teamSlug: string;
  currentFolderId: Id<"folders"> | null;
  onAddFiles: () => void;
}

export function ProjectAddButton({
  projectId,
  teamSlug,
  currentFolderId,
  onAddFiles,
}: Props) {
  const navigate = useNavigate();
  const createFolder = useMutation(api.folders.create);
  const createDocumentItem = useMutation(api.contractsTable.create);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingDocumentItem, setCreatingDocumentItem] = useState(false);
  const [folderPromptOpen, setFolderPromptOpen] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [documentPrompt, setDocumentPrompt] = useState<
    "contract" | "document" | null
  >(null);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const handleAddFolder = async (raw: string) => {
    if (creatingFolder) return;
    if (!raw) return;
    setCreatingFolder(true);
    setFolderError(null);
    try {
      await createFolder({
        projectId,
        name: raw,
        parentFolderId: currentFolderId ?? undefined,
      });
      setFolderPromptOpen(false);
    } catch (e) {
      setFolderError(friendlyError(e, "Couldn't create folder."));
    } finally {
      setCreatingFolder(false);
    }
  };

  // Documents start as focused writing surfaces. Contracts opt into the
  // recipient and signing workflow from creation.
  const handleAdd = async (
    docType: "contract" | "document",
    raw: string,
  ) => {
    if (creatingDocumentItem) return;
    const label = docType === "document" ? "document" : "contract";
    if (!raw) return;
    setCreatingDocumentItem(true);
    setDocumentError(null);
    try {
      const documentId = await createDocumentItem({
        projectId,
        title: raw.trim() || `Untitled ${label}`,
        kind: docType === "document" ? "custom" : "sow",
        docType,
        contentHtml: "",
      });
      // Drop straight into the new editor — documents get their own
      // /doc/ URL space, never a /contract/ one.
      navigate({
        to:
          docType === "document"
            ? documentPath(teamSlug, projectId, documentId)
            : contractPath(teamSlug, projectId, documentId),
      });
      setDocumentPrompt(null);
    } catch (e) {
      setDocumentError(friendlyError(e, `Couldn't create ${label}.`));
    } finally {
      setCreatingDocumentItem(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#131315] px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-85"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={`${SOFT_MENU_CONTENT} min-w-[220px]`}
        >
          <DropdownMenuItem className={SOFT_MENU_ITEM} onClick={onAddFiles}>
            <Upload className="mr-2 h-4 w-4" />
            Add files
          </DropdownMenuItem>
          <DropdownMenuItem
            className={SOFT_MENU_ITEM}
            onClick={() => {
              setFolderError(null);
              setFolderPromptOpen(true);
            }}
            disabled={creatingFolder}
          >
            <FolderPlus className="mr-2 h-4 w-4" />
            Add folder
          </DropdownMenuItem>
          <DropdownMenuItem
            className={SOFT_MENU_ITEM}
            onClick={() => {
              setDocumentError(null);
              setDocumentPrompt("document");
            }}
            disabled={creatingDocumentItem}
          >
            <FileText className="mr-2 h-4 w-4" />
            Add document
          </DropdownMenuItem>
          <DropdownMenuItem
            className={SOFT_MENU_ITEM}
            onClick={() => {
              setDocumentError(null);
              setDocumentPrompt("contract");
            }}
            disabled={creatingDocumentItem}
          >
            <FileSignature className="mr-2 h-4 w-4" />
            Add contract
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NamePromptDialog
        open={folderPromptOpen}
        onOpenChange={(open) => {
          if (!creatingFolder) setFolderPromptOpen(open);
          if (!open) setFolderError(null);
        }}
        title="New folder"
        inputLabel="Folder name"
        initialValue="Untitled folder"
        actionLabel="Create"
        busy={creatingFolder}
        busyLabel="Creating…"
        error={folderError}
        onSubmit={handleAddFolder}
      />

      <NamePromptDialog
        open={documentPrompt !== null}
        onOpenChange={(open) => {
          if (!open && !creatingDocumentItem) setDocumentPrompt(null);
          if (!open) setDocumentError(null);
        }}
        title={documentPrompt === "document" ? "New document" : "New contract"}
        inputLabel={documentPrompt === "document" ? "Document title" : "Contract title"}
        initialValue={`Untitled ${documentPrompt ?? "document"}`}
        actionLabel="Create"
        busy={creatingDocumentItem}
        busyLabel="Creating…"
        error={documentError}
        onSubmit={(value) => {
          if (documentPrompt) void handleAdd(documentPrompt, value);
        }}
      />
    </>
  );
}
