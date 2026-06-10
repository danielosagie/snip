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

/**
 * Single-row toolbar that sits under the DashboardHeader on a project
 * page. Layout: [breadcrumbs] [search] [sort] [view toggle]. Project
 * name is intentionally absent because the DashboardHeader already
 * shows it — repeating it would burn a row for no reason.
 */

export type ProjectViewMode = "grid" | "list" | "kanban";
export type ProjectSortMode = "name" | "newest" | "oldest" | "type" | "size";

const SORT_LABEL: Record<ProjectSortMode, string> = {
  name: "Name (A→Z)",
  newest: "Newest first",
  oldest: "Oldest first",
  type: "File type",
  size: "File size",
};

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
    <div className="border-b-2 border-[#1a1a1a] bg-[#f0f0e8] flex items-center gap-2 px-4 sm:px-6 py-2 min-w-0">
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
            onDropFolder={(id) => onDropFolderOnBreadcrumb?.(id, null)}
          >
            <span className="font-mono">..</span>
          </BreadcrumbSegment>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={c._id} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3.5 w-3.5 text-[#888] flex-shrink-0" />
                <BreadcrumbSegment
                  active={last}
                  onClick={() => goToFolder(c._id)}
                  onDropVideo={(id) => onDropVideoOnBreadcrumb?.(id, c._id)}
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
          "flex-1 flex flex-row items-center justify-between gap-6 min-w-0",
          currentFolderId ? "ml-2" : "",
        )}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label className="flex-1 max-w-md flex items-center gap-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2 py-1">
            <Search className="h-3.5 w-3.5 text-[#888]" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search this folder…"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-[#888] min-w-0"
              aria-label="Search files and folders"
            />
            {search ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="text-[10px] font-mono text-[#888] hover:text-[#1a1a1a] uppercase"
              >
                clear
              </button>
            ) : null}
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-2 py-1 border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] text-xs font-bold uppercase tracking-wider hover:bg-[#e8e8e0] transition-colors flex-shrink-0"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span className="font-mono normal-case hidden md:inline">
                  {SORT_LABEL[sort]}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              {(Object.keys(SORT_LABEL) as ProjectSortMode[]).map((key) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() => onSortChange(key)}
                  className={cn("font-mono", sort === key ? "font-bold" : "")}
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
                    "inline-flex items-center gap-1.5 px-2 py-1 border-2 border-[#1a1a1a] text-xs font-bold uppercase tracking-wider transition-colors flex-shrink-0",
                    activeKindCount > 0
                      ? "bg-[#1a1a1a] text-[#f0f0e8]"
                      : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0]",
                  )}
                  aria-label="Filter by kind"
                >
                  <ListFilter className="h-3.5 w-3.5" />
                  <span className="font-mono normal-case hidden md:inline">
                    {activeKindCount > 0 ? `Kind · ${activeKindCount}` : "Kind"}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
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
                      className={cn("font-mono", on ? "font-bold" : "")}
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
                    className="font-mono text-[#888] border-t border-[#ccc] mt-1 pt-1"
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
        <div className="flex items-center border-2 border-[#1a1a1a] p-0.5 flex-shrink-0">
          <button
            onClick={() => onViewModeChange("grid")}
            aria-label="Grid view"
            className={cn(
              "p-1 transition-colors",
              viewMode === "grid"
                ? "bg-[#1a1a1a] text-[#f0f0e8]"
                : "text-[#888] hover:text-[#1a1a1a]",
            )}
          >
            <Grid3X3 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange("list")}
            aria-label="List view"
            className={cn(
              "p-1 transition-colors",
              viewMode === "list"
                ? "bg-[#1a1a1a] text-[#f0f0e8]"
                : "text-[#888] hover:text-[#1a1a1a]",
            )}
          >
            <LayoutList className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange("kanban")}
            aria-label="Kanban view"
            className={cn(
              "p-1 transition-colors",
              viewMode === "kanban"
                ? "bg-[#1a1a1a] text-[#f0f0e8]"
                : "text-[#888] hover:text-[#1a1a1a]",
            )}
          >
            <Columns3 className="h-3.5 w-3.5" />
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
  onDropFolder,
  children,
}: {
  active: boolean;
  onClick: () => void;
  onDropVideo: (videoId: Id<"videos">) => void;
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
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (active) return;
        const videoId = e.dataTransfer.getData("application/x-snip-video");
        if (videoId) {
          onDropVideo(videoId as Id<"videos">);
          return;
        }
        const folderId = e.dataTransfer.getData("application/x-snip-folder");
        if (folderId) onDropFolder(folderId as Id<"folders">);
      }}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-bold transition-colors min-w-0",
        active
          ? "text-[#1a1a1a]"
          : "text-[#888] hover:text-[#1a1a1a]",
        over ? "bg-[#FF6600] text-[#f0f0e8]" : "",
      )}
    >
      {children}
    </button>
  );
}
