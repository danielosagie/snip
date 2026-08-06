"use client";

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  ChevronRight,
  Search,
  ArrowUpDown,
  Grid3X3,
  LayoutList,
  Columns3,
  Check,
  ListFilter,
  ArrowLeft,
} from "lucide-react";
import {
  FILE_KIND_BUCKETS,
  FILE_KIND_BUCKET_LABEL,
  type FileKindBucket,
} from "@/lib/fileTypes";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { projectPath } from "@/lib/routes";
import {
  SNIP_VIDEOS_DRAG_TYPE,
  SNIP_VIDEO_DRAG_TYPE,
  readDraggedVideoIds,
} from "@/lib/projectDrag";

/**
 * Single-row toolbar that sits under the DashboardHeader on a project
 * page. Layout: [breadcrumbs] [search] [sort] [view toggle]. Project
 * name is intentionally absent because the DashboardHeader already
 * shows it — repeating it would burn a row for no reason.
 */

export type ProjectViewMode = "grid" | "list" | "kanban";
export type ProjectSortMode = "name" | "newest" | "oldest" | "type" | "size";

const SORT_LABEL: Record<ProjectSortMode, string> = {
  name: "Name A to Z",
  newest: "Newest first",
  oldest: "Oldest first",
  type: "File type",
  size: "File size",
};

const SOFT_MENU_CONTENT =
  "rounded-[12px] border border-[#E8E8EC] bg-white p-1 text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]";
const SOFT_MENU_ITEM =
  "rounded-[8px] px-2.5 py-1.5 text-[13px] font-medium text-[#131315] hover:bg-[#F1F1F3] focus:bg-[#F1F1F3] focus:text-[#131315]";

interface Props {
  teamSlug: string;
  projectId: Id<"projects">;
  currentFolderId: Id<"folders"> | null;
  viewMode: ProjectViewMode;
  onViewModeChange: (mode: ProjectViewMode) => void;
  sort: ProjectSortMode;
  onSortChange: (sort: ProjectSortMode) => void;
  search: string;
  onSearchChange: (q: string) => void;
  /** Selected kind buckets. Empty set = show all kinds. */
  kindFilter: Set<FileKindBucket>;
  onKindFilterChange: (next: Set<FileKindBucket>) => void;
  /** Buckets present in the current folder — only these are offered. */
  availableKindBuckets: Set<FileKindBucket>;
  /**
   * Optional handler invoked when a video is dropped onto a breadcrumb
   * segment. `targetFolderId` is `null` for the root segment.
   */
  onDropVideoOnBreadcrumb?: (
    videoId: Id<"videos">,
    targetFolderId: Id<"folders"> | null,
  ) => void;
  onDropVideosOnBreadcrumb?: (
    videoIds: Id<"videos">[],
    targetFolderId: Id<"folders"> | null,
  ) => void;
  onDropFolderOnBreadcrumb?: (
    folderId: Id<"folders">,
    targetFolderId: Id<"folders"> | null,
  ) => void;
}

export function ProjectToolbar({
  teamSlug,
  projectId,
  currentFolderId,
  viewMode,
  onViewModeChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  kindFilter,
  onKindFilterChange,
  availableKindBuckets,
  onDropVideoOnBreadcrumb,
  onDropVideosOnBreadcrumb,
  onDropFolderOnBreadcrumb,
}: Props) {
  const toggleKind = (bucket: FileKindBucket) => {
    const next = new Set(kindFilter);
    if (next.has(bucket)) next.delete(bucket);
    else next.add(bucket);
    onKindFilterChange(next);
  };
  // Only buckets that exist in this folder, in canonical order.
  const offeredBuckets = FILE_KIND_BUCKETS.filter((b) =>
    availableKindBuckets.has(b),
  );
  const activeKindCount = kindFilter.size;
  const navigate = useNavigate();
  const breadcrumbs = useQuery(
    api.folders.breadcrumbs,
    currentFolderId ? { folderId: currentFolderId } : "skip",
  );

  const goToFolder = (folderId: Id<"folders"> | null) => {
    (navigate as unknown as (opts: {
      to: string;
      search?: Record<string, string>;
    }) => void)({
      to: projectPath(teamSlug, projectId),
      search: folderId ? { folder: folderId } : {},
    });
  };

  const crumbs = breadcrumbs ?? [];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[#E8E8EC] bg-[#FAFAFA] px-2 py-2.5 sm:flex-nowrap sm:px-6">
      {/* Breadcrumbs — only when inside a folder. Project root is
          implicit (it's where you land); the back-up drop target is
          the leftmost crumb. When at root there's no breadcrumb row
          at all, which keeps the toolbar clean. */}
      {currentFolderId ? (
        <>
          {/* Root drop target — invisible chevron + button labeled
              "..". This lets users drag a file out of a deeper folder
              back to project root. */}
          <BreadcrumbSegment
            active={false}
            onClick={() => goToFolder(null)}
            onDropVideo={(id) => onDropVideoOnBreadcrumb?.(id, null)}
            onDropVideos={(ids) => onDropVideosOnBreadcrumb?.(ids, null)}
            onDropFolder={(id) => onDropFolderOnBreadcrumb?.(id, null)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Back to project root</span>
          </BreadcrumbSegment>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={c._id} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[#A0A0A5]" />
                <BreadcrumbSegment
                  active={last}
                  onClick={() => goToFolder(c._id)}
                  onDropVideo={(id) => onDropVideoOnBreadcrumb?.(id, c._id)}
                  onDropVideos={(ids) =>
                    onDropVideosOnBreadcrumb?.(ids, c._id)
                  }
                  onDropFolder={(id) => onDropFolderOnBreadcrumb?.(id, c._id)}
                >
                  <span className="truncate max-w-[16ch]">{c.name}</span>
                </BreadcrumbSegment>
              </span>
            );
          })}
        </>
      ) : null}

      {/* Right side: [search + sort] tight on the left, [view toggle]
          pinned to the far right with a gap. `flex-1` + `justify-between`
          on the wrapper does the spacing. */}
      <div
        className={cn(
          "basis-full flex-1 flex flex-row items-center justify-between gap-2 min-w-0 sm:basis-auto sm:gap-6",
          currentFolderId ? "sm:ml-2" : "",
        )}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0 sm:gap-2">
          <label className="field-shell flex min-h-11 max-w-md flex-1 items-center gap-2 rounded-[10px] border border-[#E8E8EC] bg-white px-3 transition-[border-color,box-shadow] sm:min-h-9">
            <Search className="h-4 w-4 text-[#A0A0A5]" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search this folder"
              className="field-bare min-w-0 flex-1 text-[13px] text-[#131315] placeholder:text-[#A0A0A5]"
              aria-label="Search files and folders"
            />
            {search ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="rounded-full px-2 py-1 text-[11px] font-medium text-[#A0A0A5] hover:bg-[#F1F1F3] hover:text-[#6E6E73]"
              >
                Clear
              </button>
            ) : null}
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3] sm:h-9 sm:w-auto sm:px-3"
              >
                <ArrowUpDown className="h-4 w-4" />
                <span className="hidden md:inline">
                  {SORT_LABEL[sort]}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className={cn(SOFT_MENU_CONTENT, "min-w-[180px]")}
            >
              {(Object.keys(SORT_LABEL) as ProjectSortMode[]).map((key) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() => onSortChange(key)}
                  className={cn(
                    SOFT_MENU_ITEM,
                    sort === key ? "bg-[#F1F1F3]" : "",
                  )}
                >
                  {sort === key ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <span className="mr-2 inline-block w-4" />
                  )}
                  {SORT_LABEL[key]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Kind filter — only rendered when there's more than one kind to
              choose between (a single-kind folder needs no filter). Multi-
              select: each click toggles a bucket; empty = show all. */}
          {offeredBuckets.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-11 w-11 flex-shrink-0 items-center justify-center gap-1.5 rounded-full border border-[#D8D8DE] text-[13px] font-medium transition-colors sm:h-9 sm:w-auto sm:px-3",
                    activeKindCount > 0
                      ? "border-[#F0D2C3] bg-[#FFF0E6] text-[#D14E00]"
                      : "bg-white text-[#131315] hover:bg-[#F1F1F3]",
                  )}
                  aria-label="Filter by kind"
                >
                  <ListFilter className="h-4 w-4" />
                  <span className="hidden md:inline">
                    {activeKindCount > 0 ? `Kind ${activeKindCount}` : "Kind"}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className={cn(SOFT_MENU_CONTENT, "min-w-[180px]")}
              >
                {offeredBuckets.map((bucket) => {
                  const on = kindFilter.has(bucket);
                  return (
                    <DropdownMenuItem
                      key={bucket}
                      onSelect={(e) => {
                        // Keep the menu open so several kinds can be toggled
                        // in one pass.
                        e.preventDefault();
                        toggleKind(bucket);
                      }}
                      className={cn(
                        SOFT_MENU_ITEM,
                        on ? "bg-[#F1F1F3]" : "",
                      )}
                    >
                      {on ? (
                        <Check className="mr-2 h-4 w-4" />
                      ) : (
                        <span className="mr-2 inline-block w-4" />
                      )}
                      {FILE_KIND_BUCKET_LABEL[bucket]}
                    </DropdownMenuItem>
                  );
                })}
                {activeKindCount > 0 ? (
                  <DropdownMenuItem
                    onClick={() => onKindFilterChange(new Set())}
                    className={cn(
                      SOFT_MENU_ITEM,
                      "mt-1 border-t border-[#F1F1F3] text-[#6E6E73]",
                    )}
                  >
                    <span className="mr-2 inline-block w-4" />
                    Clear filter
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {/* View-mode toggle — own group, pinned to the far right of
            the row. The `gap-6` on the parent guarantees breathing
            room between it and the search/sort cluster. */}
        <div className="flex flex-shrink-0 items-center gap-0.5 rounded-[8px] bg-[#F1F1F3] p-0.5">
          <button
            onClick={() => onViewModeChange("grid")}
            aria-label="Grid view"
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-[7px] border border-transparent text-[#6E6E73] transition-colors sm:h-8 sm:w-8",
              viewMode === "grid"
                ? "border-[#E8E8EC] bg-white text-[#131315] shadow-sm"
                : "hover:bg-white/60 hover:text-[#131315]",
            )}
          >
            <Grid3X3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => onViewModeChange("list")}
            aria-label="List view"
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-[7px] border border-transparent text-[#6E6E73] transition-colors sm:h-8 sm:w-8",
              viewMode === "list"
                ? "border-[#E8E8EC] bg-white text-[#131315] shadow-sm"
                : "hover:bg-white/60 hover:text-[#131315]",
            )}
          >
            <LayoutList className="h-4 w-4" />
          </button>
          <button
            onClick={() => onViewModeChange("kanban")}
            aria-label="Kanban view"
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-[7px] border border-transparent text-[#6E6E73] transition-colors sm:h-8 sm:w-8",
              viewMode === "kanban"
                ? "border-[#E8E8EC] bg-white text-[#131315] shadow-sm"
                : "hover:bg-white/60 hover:text-[#131315]",
            )}
          >
            <Columns3 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One breadcrumb segment. Doubles as a drop target so users can drag
 * a video/folder out of a deeper folder onto an ancestor. The active
 * (rightmost) segment isn't a drop target — you don't move things
 * into the folder you're already standing in.
 */
function BreadcrumbSegment({
  active,
  onClick,
  onDropVideo,
  onDropVideos,
  onDropFolder,
  children,
}: {
  active: boolean;
  onClick: () => void;
  onDropVideo: (videoId: Id<"videos">) => void;
  onDropVideos: (videoIds: Id<"videos">[]) => void;
  onDropFolder: (folderId: Id<"folders">) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={(e) => {
        if (active) return;
        const types = e.dataTransfer.types;
        if (
          !types.includes(SNIP_VIDEO_DRAG_TYPE) &&
          !types.includes(SNIP_VIDEOS_DRAG_TYPE) &&
          !types.includes("application/x-snip-folder")
        ) {
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (active) return;
        const videoIds = readDraggedVideoIds(e.dataTransfer);
        if (videoIds.length > 1) {
          onDropVideos(videoIds);
          return;
        }
        if (videoIds.length === 1) {
          onDropVideo(videoIds[0]);
          return;
        }
        const folderId = e.dataTransfer.getData("application/x-snip-folder");
        if (folderId) onDropFolder(folderId as Id<"folders">);
      }}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded-[8px] px-2 py-1 text-[13px] font-medium transition-colors",
        active
          ? "text-[#131315]"
          : "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]",
        over ? "bg-[#FFF0E6] text-[#D14E00]" : "",
      )}
    >
      {children}
    </button>
  );
}
