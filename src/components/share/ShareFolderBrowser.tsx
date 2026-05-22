"use client";

import { useMemo, useState } from "react";
import {
  Folder,
  Video as VideoIcon,
  Image as ImageIcon,
  FileText,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
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
  review: { label: "Needs Review", className: "bg-[#FFEDD5] text-[#C2410C]" },
  rework: { label: "Rework", className: "bg-[#fde2e2] text-[#dc2626]" },
  done: { label: "Done", className: "bg-[#dcfce7] text-[#15803d]" },
};

function KindIcon({ kind, className }: { kind: ItemKind; className?: string }) {
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "other") return <FileText className={className} />;
  return <VideoIcon className={className} />;
}

const SELECT_CLASS =
  "h-8 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2 text-xs font-bold text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#C2410C]";

export function ShareFolderBrowser({
  bundleName,
  folders,
  items,
  activeItemId,
  onSelectItem,
}: Props) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortMode>("name");
  const [view, setView] = useState<ViewMode>("grid");

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
    let list = items.filter((i) => i.folderId === currentFolderId);
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
  }, [items, currentFolderId, statusFilter, typeFilter, sort]);

  const totalSize = useMemo(
    () => items.reduce((sum, i) => sum + (i.fileSize ?? 0), 0),
    [items],
  );

  const isEmpty = folders.length === 0 && items.length === 0;
  if (isEmpty) {
    return (
      <section className="border-2 border-[#1a1a1a] bg-[#e8e8e0] p-6 text-center text-sm text-[#888]">
        This share has no ready items yet. Uploads will appear here as soon as
        processing finishes.
      </section>
    );
  }

  return (
    <section className="border-2 border-[#1a1a1a] bg-[#e8e8e0]" aria-label="Shared files">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 flex-wrap border-b-2 border-[#1a1a1a] px-3 py-2 text-sm">
        {breadcrumbs.map((crumb, idx) => {
          const isLast = idx === breadcrumbs.length - 1;
          return (
            <span key={crumb.id ?? "root"} className="flex items-center gap-1">
              {idx > 0 ? (
                <ChevronRight className="h-3.5 w-3.5 text-[#888]" />
              ) : null}
              <button
                type="button"
                onClick={() => setCurrentFolderId(crumb.id)}
                disabled={isLast}
                className={cn(
                  "font-bold",
                  isLast
                    ? "text-[#1a1a1a] cursor-default"
                    : "text-[#888] hover:text-[#C2410C]",
                )}
              >
                {crumb.name}
              </button>
            </span>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-[#1a1a1a] px-3 py-2">
        <span className="text-xs font-mono text-[#888] mr-auto">
          {items.length} {items.length === 1 ? "item" : "items"}
          {totalSize > 0 ? ` · ${formatBytes(totalSize)}` : ""}
        </span>

        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={SELECT_CLASS}
        >
          <option value="all">All statuses</option>
          <option value="review">Needs Review</option>
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

        <div className="flex items-center border-2 border-[#1a1a1a]">
          <button
            type="button"
            aria-label="Grid view"
            onClick={() => setView("grid")}
            className={cn(
              "flex h-8 w-8 items-center justify-center",
              view === "grid"
                ? "bg-[#1a1a1a] text-[#f0f0e8]"
                : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e0e0d6]",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="List view"
            onClick={() => setView("list")}
            className={cn(
              "flex h-8 w-8 items-center justify-center border-l-2 border-[#1a1a1a]",
              view === "list"
                ? "bg-[#1a1a1a] text-[#f0f0e8]"
                : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e0e0d6]",
            )}
          >
            <ListIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Subfolders */}
        {childFolders.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {childFolders.map((folder) => (
              <button
                key={folder._id}
                type="button"
                onClick={() => setCurrentFolderId(folder._id)}
                className="flex items-center gap-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] p-3 text-left hover:bg-[#FFEDD5] transition-colors"
              >
                <Folder className="h-5 w-5 flex-shrink-0 text-[#C2410C]" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#1a1a1a] truncate">
                    {folder.name}
                  </div>
                  <div className="text-[10px] font-mono text-[#888]">
                    {subtreeCountByFolder.get(folder._id) ?? 0} items
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {/* Files */}
        {visibleItems.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-[#888]">
            {childFolders.length > 0
              ? "No files in this folder match the current filters."
              : "No files match the current filters."}
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {visibleItems.map((item) => {
              const isActive = item._id === activeItemId;
              const kind = itemKind(item);
              const status = STATUS_META[item.workflowStatus];
              return (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => onSelectItem(item._id)}
                  className={cn(
                    "text-left border-2 transition-colors",
                    isActive
                      ? "border-[#C2410C] bg-[#FFEDD5]"
                      : "border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#e0e0d6]",
                  )}
                >
                  <div className="relative aspect-video bg-[#1a1a1a] overflow-hidden">
                    {item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#666]">
                        <KindIcon kind={kind} className="h-6 w-6" />
                      </div>
                    )}
                    {item.duration ? (
                      <span className="absolute bottom-1 right-1 bg-black/75 px-1 text-[10px] font-mono text-white">
                        {formatDuration(item.duration)}
                      </span>
                    ) : null}
                  </div>
                  <div className="p-2 space-y-1">
                    <div className="text-xs font-bold text-[#1a1a1a] truncate">
                      {item.title}
                    </div>
                    <span
                      className={cn(
                        "inline-block px-1.5 py-0.5 text-[10px] font-bold",
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
          <div className="divide-y-2 divide-[#1a1a1a] border-2 border-[#1a1a1a]">
            {visibleItems.map((item) => {
              const isActive = item._id === activeItemId;
              const kind = itemKind(item);
              const status = STATUS_META[item.workflowStatus];
              return (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => onSelectItem(item._id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                    isActive ? "bg-[#FFEDD5]" : "bg-[#f0f0e8] hover:bg-[#e0e0d6]",
                  )}
                >
                  <KindIcon kind={kind} className="h-4 w-4 flex-shrink-0 text-[#888]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-[#1a1a1a]">
                    {item.title}
                  </span>
                  <span
                    className={cn(
                      "hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-bold flex-shrink-0",
                      status.className,
                    )}
                  >
                    {status.label}
                  </span>
                  <span className="hidden md:block w-20 flex-shrink-0 text-right text-[11px] font-mono text-[#888]">
                    {item.fileSize ? formatBytes(item.fileSize) : "—"}
                  </span>
                  <span className="w-14 flex-shrink-0 text-right text-[11px] font-mono text-[#888]">
                    {item.duration ? formatDuration(item.duration) : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
