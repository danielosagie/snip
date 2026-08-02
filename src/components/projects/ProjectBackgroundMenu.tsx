"use client";

import { type ReactNode } from "react";
import { Upload, FolderPlus, FileSignature, FileText } from "lucide-react";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "@/components/ui/context-menu";

/**
 * Finder-style background context menu for the empty area of a project
 * grid/list. Wrap the grid container with this — right-clicking a tile
 * never reaches here because each tile's own ContextMenu stops propagation
 * (and the non-menu file tiles stop their own onContextMenu), so this only
 * fires on the background.
 *
 * All four actions mirror ProjectAddButton's flows exactly; the page passes
 * the already-wired handlers so there's a single source of truth for create.
 */
export function ProjectBackgroundMenu({
  canEdit,
  onNewFolder,
  onUploadFiles,
  onNewDocument,
  onNewContract,
  children,
}: {
  canEdit: boolean;
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onNewDocument: () => void;
  onNewContract: () => void;
  children: ReactNode;
}) {
  const items = (): ContextMenuEntry[] => [
    {
      label: "New folder",
      icon: <FolderPlus className="h-4 w-4" />,
      onSelect: onNewFolder,
    },
    {
      label: "Upload files",
      icon: <Upload className="h-4 w-4" />,
      onSelect: onUploadFiles,
    },
    {
      label: "New document",
      icon: <FileText className="h-4 w-4" />,
      onSelect: onNewDocument,
    },
    {
      label: "New contract",
      icon: <FileSignature className="h-4 w-4" />,
      onSelect: onNewContract,
    },
  ];

  return (
    <ContextMenu items={items} disabled={!canEdit}>
      {children}
    </ContextMenu>
  );
}
