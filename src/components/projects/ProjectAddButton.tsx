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

  const handleAddFolder = async () => {
    if (creatingFolder) return;
    const raw = prompt("Folder name", "Untitled folder");
    if (!raw) return;
    setCreatingFolder(true);
    try {
      await createFolder({
        projectId,
        name: raw,
        parentFolderId: currentFolderId ?? undefined,
      });
    } catch (e) {
      alert(friendlyError(e, "Couldn't create folder."));
    } finally {
      setCreatingFolder(false);
    }
  };

  // Documents start as focused writing surfaces. Contracts opt into the
  // recipient and signing workflow from creation.
  const handleAdd = async (docType: "contract" | "document") => {
    if (creatingDocumentItem) return;
    const label = docType === "document" ? "document" : "contract";
    const raw = prompt(`${label[0].toUpperCase()}${label.slice(1)} title`, `Untitled ${label}`);
    if (!raw) return;
    setCreatingDocumentItem(true);
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
    } catch (e) {
      alert(friendlyError(e, `Couldn't create ${label}.`));
    } finally {
      setCreatingDocumentItem(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border-2 border-[#1a1a1a] bg-[#1a1a1a] text-[#f0f0e8] text-xs font-bold uppercase tracking-wider hover:bg-[#FF6600] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuItem onClick={onAddFiles}>
          <Upload className="mr-2 h-4 w-4" />
          Add files
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void handleAddFolder()}
          disabled={creatingFolder}
        >
          <FolderPlus className="mr-2 h-4 w-4" />
          Add folder
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void handleAdd("document")}
          disabled={creatingDocumentItem}
        >
          <FileText className="mr-2 h-4 w-4" />
          Add document
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void handleAdd("contract")}
          disabled={creatingDocumentItem}
        >
          <FileSignature className="mr-2 h-4 w-4" />
          Add contract
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
