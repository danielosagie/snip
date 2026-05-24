"use client";

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Plus, Upload, FolderPlus, FileSignature } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { contractPath } from "@/lib/routes";
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
  const createContract = useMutation(api.contractsTable.create);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingContract, setCreatingContract] = useState(false);

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
      alert(e instanceof Error ? e.message : "Couldn't create folder.");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleAddContract = async () => {
    if (creatingContract) return;
    const raw = prompt("Contract title", "Untitled contract");
    if (!raw) return;
    setCreatingContract(true);
    try {
      const contractId = await createContract({
        projectId,
        title: raw.trim() || "Untitled contract",
        kind: "sow",
        contentHtml: "",
      });
      // Drop straight into the new contract's editor.
      navigate({ to: contractPath(teamSlug, projectId, contractId) });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't create contract.");
    } finally {
      setCreatingContract(false);
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
          onClick={() => void handleAddContract()}
          disabled={creatingContract}
        >
          <FileSignature className="mr-2 h-4 w-4" />
          Add contract
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
