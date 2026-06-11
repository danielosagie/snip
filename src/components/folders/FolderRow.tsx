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
  onDropVideo?: (videoId: Id<"videos">, targetFolderId: Id<"folders">) => void;
  onDropFolder?: (
    droppedFolderId: Id<"folders">,
    targetFolderId: Id<"folders">,
  ) => void;
  /** When a folder with this id renders, it auto-enters inline rename (used
   *  right after a background "New folder" or a drag-combine creates one). */
  renameFolderId?: Id<"folders"> | null;
  onRenameConsumed?: () => void;
}

export function FolderRow({
  teamSlug,
  projectId,
  folders,
  canEdit,
  onDropVideo,
  onDropFolder,
  renameFolderId,
  onRenameConsumed,
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
            onDropVideo={onDropVideo}
            onDropFolder={onDropFolder}
            autoRename={renameFolderId === f._id}
            onAutoRenameConsumed={onRenameConsumed}
          />
        ))}
      </div>
    </section>
  );
}
