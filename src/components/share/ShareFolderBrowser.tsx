"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Folder,
  Video as VideoIcon,
  Image as ImageIcon,
  FileText,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
  Search,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn, formatBytes, formatDuration } from "@/lib/utils";

/**
 * Drive-style folder browser for a shared bundle. Renders the bundle's real
 * folder hierarchy (breadcrumbs + subfolder tiles + file grid/list) with
 * client-side filters and sort. Selecting a file calls `onSelectItem`; the
 * parent share page renders the focused item's player/preview below.
 *
 * Folder ids are normalized by the server so the share root is always `null`.
 */

export type ShareFolderNode = {
  _id: string;
  name: string;
  parentFolderId: string | null;
};

export type ShareItemNode = {
  _id: string;
  title: string;
  duration: number | null;
  thumbnailUrl: string | null;
  contentType: string | null;
  hasMuxPlayback: boolean;
  workflowStatus: "review" | "rework" | "done";
  fileSize: number | null;
  createdAt: number;
  uploaderName: string;
  /** Normalized by the server: null = the share root. */
  folderId: string | null;
};

interface Props {
  bundleName: string;
  folders: ShareFolderNode[];
  items: ShareItemNode[];
  activeItemId: string | null;
  onSelectItem: (id: string) => void;
  grantToken: string | null;
  viewAs: "client" | "owner";
}

type ItemKind = "video" | "image" | "other";
type StatusFilter = "all" | "review" | "rework" | "done";
type TypeFilter = "all" | ItemKind;
type SortMode = "name" | "newest" | "oldest" | "size";
type ViewMode = "grid" | "list";

function itemKind(i: Pick<ShareItemNode, "contentType" | "hasMuxPlayback">): ItemKind {
  if (i.contentType?.startsWith("image/")) return "image";
  if (i.contentType?.startsWith("video/") || i.hasMuxPlayback) return "video";
  return "other";
}

const STATUS_META: Record<
  ShareItemNode["workflowStatus"],
  { label: string; className: string }
> = {
  review: { label: "Needs review", className: "bg-[#FFF0E6] text-[#D14E00]" },
  rework: { label: "Rework", className: "bg-[#FFF5F5] text-[#8A2B34]" },
  done: { label: "Done", className: "bg-[#F2FBF5] text-[#225B36]" },
};

function KindIcon({ kind, className }: { kind: ItemKind; className?: string }) {
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "other") return <FileText className={className} />;
  return <VideoIcon className={className} />;
}

function ShareThumbnail({
  item,
  grantToken,
  viewAs,
  className,
}: {
  item: ShareItemNode;
  grantToken: string | null;
  viewAs: "client" | "owner";
  className: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const getImagePreview = useAction(api.videoActions.getSharedImagePreview);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    item.thumbnailUrl?.startsWith("http") ? item.thumbnailUrl : null,
  );
  const kind = itemKind(item);

  useEffect(() => {
    if (resolvedUrl || kind !== "image" || !grantToken) return;
    const node = containerRef.current;
    if (!node) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void getImagePreview({
        grantToken,
        itemVideoId: item._id as Id<"videos">,
        viewAs,
      }).then((result) => {
        if (!cancelled && result.url) setResolvedUrl(result.url);
      }).catch(() => {
        // Keep the stable kind placeholder when a preview is unavailable.
      });
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [getImagePreview, grantToken, item._id, kind, resolvedUrl, viewAs]);

  return (
    <div ref={containerRef} className={className}>
      {resolvedUrl ? (
        <img src={resolvedUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#0A0A0B] text-[#A0A0A5]">
          <KindIcon kind={kind} className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}

const SELECT_CLASS =
  "h-9 rounded-full border border-[#D8D8DE] bg-white px-3 text-[13px] font-medium text-[#131315] focus:border-[#D14E00] focus:outline-none focus:ring-2 focus:ring-[#FFF0E6]";

export function ShareFolderBrowser({
  bundleName,
  folders,
  items,
  activeItemId,
  onSelectItem,
  grantToken,
  viewAs,
}: Props) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortMode>("name");
  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(true);

  const folderById = useMemo(() => {
    const m = new Map<string, ShareFolderNode>();
    for (const f of folders) m.set(f._id, f);
    return m;
  }, [folders]);

  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, ShareFolderNode[]>();
    for (const f of folders) {
      const arr = m.get(f.parentFolderId) ?? [];
      arr.push(f);
      m.set(f.parentFolderId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [folders]);

  // Subtree item-count rollup for folder tiles (direct items + descendants).
  const subtreeCountByFolder = useMemo(() => {
    const direct = new Map<string | null, number>();
    for (const it of items) {
      direct.set(it.folderId, (direct.get(it.folderId) ?? 0) + 1);
    }
    const counts = new Map<string, number>();
    const compute = (folderId: string): number => {
      const cached = counts.get(folderId);
      if (cached !== undefined) return cached;
      let c = direct.get(folderId) ?? 0;
      for (const child of childrenByParent.get(folderId) ?? []) {
        c += compute(child._id);
      }
      counts.set(folderId, c);
      return c;
    };
    for (const f of folders) compute(f._id);
    return counts;
  }, [items, folders, childrenByParent]);

  const breadcrumbs = useMemo(() => {
    const crumbs: Array<{ id: string | null; name: string }> = [];
    let cur = currentFolderId;
    const guard = new Set<string>();
    while (cur) {
      const f = folderById.get(cur);
      if (!f || guard.has(cur)) break;
      guard.add(cur);
      crumbs.unshift({ id: f._id, name: f.name });
      cur = f.parentFolderId;
    }
    crumbs.unshift({ id: null, name: bundleName });
    return crumbs;
  }, [currentFolderId, folderById, bundleName]);

  const childFolders = childrenByParent.get(currentFolderId) ?? [];

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    let list = items.filter((i) =>
      normalizedQuery
        ? i.title.toLocaleLowerCase().includes(normalizedQuery)
        : i.folderId === currentFolderId,
    );
    if (statusFilter !== "all") {
      list = list.filter((i) => i.workflowStatus === statusFilter);
    }
    if (typeFilter !== "all") {
      list = list.filter((i) => itemKind(i) === typeFilter);
    }
    const sorted = [...list];
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "newest":
        sorted.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case "oldest":
        sorted.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case "size":
        sorted.sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0));
        break;
    }
    return sorted;
  }, [items, currentFolderId, statusFilter, typeFilter, sort, query]);

  const totalSize = useMemo(
    () => items.reduce((sum, i) => sum + (i.fileSize ?? 0), 0),
    [items],
  );

  const isEmpty = folders.length === 0 && items.length === 0;
  if (isEmpty) {
    return (
      <section className="rounded-[14px] border border-[#E8E8EC] bg-white p-6 text-center text-sm text-[#6E6E73]">
        This share has no ready items yet. Uploads will appear here as soon as
        processing finishes.
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white" aria-label="Shared files">
      <div className="flex items-center gap-3 border-b border-[#E8E8EC] bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#131315]">Shared files</div>
          <div className="text-[11px] text-[#6E6E73]">{items.length} items</div>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className="flex h-9 items-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white px-3 text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#FAFAFA]"
        >
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {isOpen ? "Collapse" : "Browse"}
        </button>
      </div>
      {isOpen ? <>
      {/* Breadcrumbs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[#F1F1F3] px-4 py-2.5 text-sm">
        {breadcrumbs.map((crumb, idx) => {
          const isLast = idx === breadcrumbs.length - 1;
          return (
            <span key={crumb.id ?? "root"} className="flex items-center gap-1">
              {idx > 0 ? (
                <ChevronRight className="h-3.5 w-3.5 text-[#A0A0A5]" />
              ) : null}
              <button
                type="button"
                onClick={() => setCurrentFolderId(crumb.id)}
                disabled={isLast}
                className={cn(
                  "font-medium",
                  isLast
                    ? "cursor-default text-[#131315]"
                    : "text-[#6E6E73] hover:text-[#D14E00]",
                )}
              >
                {crumb.name}
              </button>
            </span>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#F1F1F3] px-4 py-3">
        <span className="mr-auto text-xs text-[#6E6E73]">
          {items.length} {items.length === 1 ? "item" : "items"}
          {totalSize > 0 ? ` · ${formatBytes(totalSize)}` : ""}
        </span>

        <label className="field-shell relative flex min-h-9 min-w-[12rem] flex-1 items-center rounded-full border border-[#D8D8DE] bg-white pl-8 pr-3 transition-[border-color,box-shadow] sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A0A0A5]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this share…"
            aria-label="Search shared files"
            className="field-bare min-w-0 flex-1 text-[13px] text-[#131315] placeholder:text-[#A0A0A5]"
          />
        </label>

        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={SELECT_CLASS}
        >
          <option value="all">All statuses</option>
          <option value="review">Needs review</option>
          <option value="rework">Rework</option>
          <option value="done">Done</option>
        </select>

        <select
          aria-label="Filter by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className={SELECT_CLASS}
        >
          <option value="all">All types</option>
          <option value="video">Video</option>
          <option value="image">Image</option>
          <option value="other">Other</option>
        </select>

        <select
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className={SELECT_CLASS}
        >
          <option value="name">Name</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="size">Largest</option>
        </select>

        <div className="flex items-center rounded-full border border-[#D8D8DE] bg-white p-0.5">
          <button
            type="button"
            aria-label="Grid view"
            onClick={() => setView("grid")}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              view === "grid"
                ? "bg-[#FFF0E6] text-[#D14E00]"
                : "text-[#6E6E73] hover:bg-[#FAFAFA] hover:text-[#131315]",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="List view"
            onClick={() => setView("list")}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              view === "list"
                ? "bg-[#FFF0E6] text-[#D14E00]"
                : "text-[#6E6E73] hover:bg-[#FAFAFA] hover:text-[#131315]",
            )}
          >
            <ListIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Subfolders */}
        {childFolders.length > 0 && !query.trim() ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {childFolders.map((folder) => (
              <button
                key={folder._id}
                type="button"
                onClick={() => setCurrentFolderId(folder._id)}
                className="flex items-center gap-2 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-3 text-left transition-colors hover:bg-[#FFF0E6]"
              >
                <Folder className="h-5 w-5 flex-shrink-0 text-[#D14E00]" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-[#131315]">
                    {folder.name}
                  </div>
                  <div className="text-[11px] text-[#6E6E73]">
                    {subtreeCountByFolder.get(folder._id) ?? 0} items
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {/* Files */}
        {visibleItems.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-[#6E6E73]">
            {childFolders.length > 0
              ? "No files in this folder match the current filters."
              : "No files match the current filters."}
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {visibleItems.map((item) => {
              const isActive = item._id === activeItemId;
              const status = STATUS_META[item.workflowStatus];
              return (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => onSelectItem(item._id)}
                  className={cn(
                    "overflow-hidden rounded-[11px] border text-left transition-colors",
                    isActive
                      ? "border-[#E8E8EC] bg-[#FFF0E6]"
                      : "border-[#E8E8EC] bg-white hover:bg-[#FAFAFA]",
                  )}
                >
                  <div className="relative aspect-video overflow-hidden bg-[#0A0A0B]">
                    <ShareThumbnail item={item} grantToken={grantToken} viewAs={viewAs} className="h-full w-full" />
                    {item.duration ? (
                      <span className="absolute bottom-1 right-1 rounded-full bg-[#161618] px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {formatDuration(item.duration)}
                      </span>
                    ) : null}
                  </div>
                  <div className="p-2 space-y-1">
                    <div className="truncate text-xs font-medium text-[#131315]">
                      {item.title}
                    </div>
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
                        status.className,
                      )}
                    >
                      {status.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[11px] border border-[#E8E8EC] divide-y divide-[#F1F1F3]">
            {visibleItems.map((item) => {
              const isActive = item._id === activeItemId;
              const status = STATUS_META[item.workflowStatus];
              return (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => onSelectItem(item._id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                    isActive ? "bg-[#FFF0E6]" : "bg-white hover:bg-[#FAFAFA]",
                  )}
                >
                  <ShareThumbnail item={item} grantToken={grantToken} viewAs={viewAs} className="h-10 w-16 flex-shrink-0 overflow-hidden rounded-[10px] bg-[#0A0A0B]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#131315]">
                    {item.title}
                  </span>
                  <span
                    className={cn(
                      "hidden flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-block",
                      status.className,
                    )}
                  >
                    {status.label}
                  </span>
                  <span className="hidden w-20 flex-shrink-0 text-right text-[11px] text-[#6E6E73] md:block">
                    {item.fileSize ? formatBytes(item.fileSize) : "Unknown"}
                  </span>
                  <span className="w-14 flex-shrink-0 text-right text-[11px] text-[#6E6E73]">
                    {item.duration ? formatDuration(item.duration) : "Unknown"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      </> : null}
    </section>
  );
}
