"use client";

import { useRef } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { useGridWindow } from "@/lib/useGridWindow";
import { ProjectVideoTile } from "./ProjectVideoTile";
import { ProjectVideoRow } from "./ProjectVideoRow";
import {
  ProjectFileListRowCell,
  ProjectFileTileCell,
  canDownloadVideo,
  isPlayableVideo,
} from "./ProjectFileCells";
import type {
  ProjectTileActions,
  ProjectVideoItem,
} from "./projectTileShared";

const GRID_CLASSES =
  "grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7";

/**
 * The project's file grid, windowed.
 *
 * This component re-renders on every selection click (it holds the selection
 * Set), but its children are memoized on primitives, so a click re-renders
 * only the one or two tiles whose `selected` flag actually flipped.
 */
export function ProjectFileGrid({
  videos,
  actions,
  selectedVideoIds,
  selectionMode,
  canEdit,
  presenceCounts,
  scrollRef,
}: {
  videos: ProjectVideoItem[];
  actions: ProjectTileActions;
  selectedVideoIds: Set<Id<"videos">>;
  selectionMode: boolean;
  canEdit: boolean;
  presenceCounts?: Record<string, number>;
  scrollRef: React.RefObject<HTMLElement | null>;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { startIndex, endIndex, spanBefore, spanAfter, rowHeight } =
    useGridWindow({
      scrollRef,
      gridRef,
      itemCount: videos.length,
    });

  return (
    <div
      ref={gridRef}
      className={GRID_CLASSES}
      style={rowHeight ? { gridAutoRows: `${rowHeight}px` } : undefined}
    >
      {/* Skipped rows are spanned, not padded — the browser owns the gap
          arithmetic, and `gridAutoRows` above gives the empty tracks a
          height. See src/lib/useGridWindow.ts. */}
      {spanBefore > 0 ? (
        <div
          aria-hidden="true"
          style={{ gridColumn: "1 / -1", gridRow: `span ${spanBefore}` }}
        />
      ) : null}

      {videos.slice(startIndex, endIndex).map((video) =>
        isPlayableVideo(video) ? (
          <ProjectVideoTile
            key={video._id}
            video={video}
            actions={actions}
            selected={selectedVideoIds.has(video._id)}
            selectionMode={selectionMode}
            canEdit={canEdit}
            canDownload={canDownloadVideo(video)}
            watchingCount={presenceCounts?.[video._id] ?? 0}
          />
        ) : (
          <ProjectFileTileCell
            key={video._id}
            video={video}
            actions={actions}
            selected={selectedVideoIds.has(video._id)}
            selectionMode={selectionMode}
            canEdit={canEdit}
          />
        ),
      )}

      {spanAfter > 0 ? (
        <div
          aria-hidden="true"
          style={{ gridColumn: "1 / -1", gridRow: `span ${spanAfter}` }}
        />
      ) : null}
    </div>
  );
}

/**
 * List variant. Not windowed: rows are two different heights (a video row is
 * ~2.5× a file row) so there is no uniform stride to window against, and the
 * memoized rows plus deferred menus already take the click cost from
 * "re-render 369 rows" to "re-render 2".
 */
export function ProjectFileList({
  videos,
  actions,
  selectedVideoIds,
  selectionMode,
  canEdit,
  presenceCounts,
}: {
  videos: ProjectVideoItem[];
  actions: ProjectTileActions;
  selectedVideoIds: Set<Id<"videos">>;
  selectionMode: boolean;
  canEdit: boolean;
  presenceCounts?: Record<string, number>;
}) {
  return (
    <div className="bg-white">
      {videos.map((video) =>
        isPlayableVideo(video) ? (
          <ProjectVideoRow
            key={video._id}
            video={video}
            actions={actions}
            selected={selectedVideoIds.has(video._id)}
            selectionMode={selectionMode}
            canEdit={canEdit}
            canDownload={canDownloadVideo(video)}
            watchingCount={presenceCounts?.[video._id] ?? 0}
          />
        ) : (
          <ProjectFileListRowCell
            key={video._id}
            video={video}
            actions={actions}
            selected={selectedVideoIds.has(video._id)}
            selectionMode={selectionMode}
            canEdit={canEdit}
          />
        ),
      )}
    </div>
  );
}
