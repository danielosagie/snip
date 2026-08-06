"use client";

import { memo } from "react";
import { FileTile, FileListRow } from "@/components/files/FileTile";
import type {
  ProjectTileActions,
  ProjectVideoItem,
} from "./projectTileShared";

// Content types that have an in-app focused view (the asset detail page).
// Click in the project grid → navigate to the editor view instead of
// triggering a download. Everything else (zips, source files, etc.)
// downloads on click as before.
const DOC_CONTENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function computeHasFocusedView(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) return false;
  if (contentType.startsWith("image/")) return true;
  if (contentType.startsWith("text/")) return true;
  return DOC_CONTENT_TYPES.has(contentType);
}

/** The list view has always used a narrower rule than the grid. Kept as-is. */
export function computeHasFocusedViewList(
  contentType: string | null | undefined,
): boolean {
  return (
    (contentType?.startsWith("image/") ?? false) ||
    contentType === "application/pdf"
  );
}

/**
 * A non-video asset (PDF, doc, image, source file) is NOT a playable video —
 * a "video" without a Mux playback id once processing has finished is, by
 * definition, something else.
 */
export function isPlayableVideo(video: ProjectVideoItem): boolean {
  return (
    Boolean(video.muxPlaybackId) ||
    (video.contentType?.startsWith("video/") ?? false) ||
    video.status === "uploading" ||
    video.status === "processing"
  );
}

export function canDownloadVideo(video: ProjectVideoItem): boolean {
  return (
    Boolean(video.s3Key) &&
    video.status !== "failed" &&
    video.status !== "uploading"
  );
}

export type ProjectFileCellProps = {
  video: ProjectVideoItem;
  actions: ProjectTileActions;
  selected: boolean;
  selectionMode: boolean;
  canEdit: boolean;
};

/**
 * Memoized adapters that turn one stable `actions` object plus primitives
 * into the per-item callbacks `FileTile` / `FileListRow` expect. Without
 * these the grid's inline arrow functions made every tile a new render on
 * every selection click.
 */
export const ProjectFileTileCell = memo(function ProjectFileTileCell({
  video,
  actions,
  selected,
  selectionMode,
  canEdit,
}: ProjectFileCellProps) {
  const hasFocusedView = computeHasFocusedView(video.contentType);
  return (
    <FileTile
      videoId={video._id}
      title={video.title}
      contentType={video.contentType}
      fileSize={video.fileSize}
      uploaderName={video.uploaderName}
      createdAt={video._creationTime}
      status={video.status}
      canDelete={canEdit}
      draggable={canEdit}
      selected={selected}
      selectionMode={selectionMode}
      getSelectedVideoIds={actions.currentSelectionIds}
      onDragSelectOnly={() => actions.dragSelectOnly(video._id)}
      onSelectToggle={(mods) => actions.selectToggle(video._id, mods)}
      onDelete={() => actions.remove(video._id)}
      onCombine={
        canEdit
          ? (draggedId) => actions.combine(video._id, draggedId)
          : undefined
      }
      onOpen={hasFocusedView ? () => actions.open(video._id) : undefined}
    />
  );
});

export const ProjectFileListRowCell = memo(function ProjectFileListRowCell({
  video,
  actions,
  selected,
  selectionMode,
  canEdit,
}: ProjectFileCellProps) {
  const hasFocusedView = computeHasFocusedViewList(video.contentType);
  return (
    <FileListRow
      videoId={video._id}
      title={video.title}
      contentType={video.contentType}
      fileSize={video.fileSize}
      uploaderName={video.uploaderName}
      createdAt={video._creationTime}
      status={video.status}
      canDelete={canEdit}
      draggable={canEdit}
      selected={selected}
      selectionMode={selectionMode}
      getSelectedVideoIds={actions.currentSelectionIds}
      onDragSelectOnly={() => actions.dragSelectOnly(video._id)}
      onSelectToggle={(mods) => actions.selectToggle(video._id, mods)}
      onDelete={() => actions.remove(video._id)}
      onCombine={
        canEdit
          ? (draggedId) => actions.combine(video._id, draggedId)
          : undefined
      }
      onOpen={hasFocusedView ? () => actions.open(video._id) : undefined}
    />
  );
});
