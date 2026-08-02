"use client";

import { Id } from "@convex/_generated/dataModel";
import { FolderTile } from "./FolderTile";

/**
 * Horizontal row of subfolders that sits above the file grid on a
 * project page (Drive-style "Folders" section). One column of tiles
 * per breakpoint — kept dense so the visual weight stays on the
 * file grid below.
 */

interface FolderSummary {
  _id: Id<"folders">;
  name: string;
  itemCount: number;
}

interface Props {
  teamSlug: string;
  projectId: Id<"projects">;
  folders: FolderSummary[];
  canEdit: boolean;
  selectedFolderIds?: Set<Id<"folders">>;
  selectionMode?: boolean;
  onSelectToggle?: (
    folderId: Id<"folders">,
    event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  ) => void;
  onDropVideo?: (videoId: Id<"videos">, targetFolderId: Id<"folders">) => void;
  onDropFolder?: (
    droppedFolderId: Id<"folders">,
    targetFolderId: Id<"folders">,
  ) => void;
  onDropFiles?: (files: File[], targetFolderId: Id<"folders">) => void;
}

export function FolderRow({
  teamSlug,
  projectId,
  folders,
  canEdit,
  selectedFolderIds,
  selectionMode,
  onSelectToggle,
  onDropVideo,
  onDropFolder,
  onDropFiles,
}: Props) {
  if (folders.length === 0) return null;

  return (
    <section className="px-6 pt-4">
      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
        Folders
      </div>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {folders.map((f) => (
          <FolderTile
            key={f._id}
            teamSlug={teamSlug}
            projectId={projectId}
            folderId={f._id}
            name={f.name}
            itemCount={f.itemCount}
            canEdit={canEdit}
            selected={selectedFolderIds?.has(f._id)}
            selectionMode={selectionMode}
            onSelectToggle={(event) => onSelectToggle?.(f._id, event)}
            onDropVideo={onDropVideo}
            onDropFolder={onDropFolder}
            onDropFiles={onDropFiles}
          />
        ))}
      </div>
    </section>
  );
}
