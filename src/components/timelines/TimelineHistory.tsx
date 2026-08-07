"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import {
  ChevronDown,
  GitBranch,
  Film,
  Sparkles,
  Clock,
  Database,
  Box,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

interface Props {
  projectId: Id<"projects">;
  canEdit: boolean;
}

/**
 * Timeline-snapshot history for a project — snip's vit-style version
 * history. Each row is a single push from the Resolve plugin (or a
 * manual tag from the dashboard). Branch chip on the left, message in
 * the middle, source + size on the right.
 *
 * Drill-down (per-domain diff view) is not in this round — that becomes
 * a side panel once we have a snapshot detail page.
 */
export function TimelineHistory({ projectId, canEdit }: Props) {
  const snapshots = useQuery(api.timelines.list, { projectId, limit: 30 });
  const branches = useQuery(api.timelines.listBranches, { projectId });
  const createManual = useMutation(api.timelines.createManual);

  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [tagMessage, setTagMessage] = useState("");

  const handleTag = async () => {
    if (!tagMessage.trim()) return;
    setTagging(true);
    try {
      await createManual({
        projectId,
        message: tagMessage.trim(),
        branch: filterBranch ?? undefined,
      });
      setTagMessage("");
    } finally {
      setTagging(false);
    }
  };

  if (snapshots === undefined || branches === undefined) {
    return (
      <div className="py-3 text-sm text-[#6E6E73]">Loading timeline history…</div>
    );
  }

  const filtered = filterBranch
    ? snapshots.filter((s) => s.branch === filterBranch)
    : snapshots;

  if (snapshots.length === 0) {
    return (
      <div className="rounded-[14px] border border-[#E8E8EC] bg-white p-6">
        <div className="flex items-start gap-3">
          <Film className="mt-0.5 h-5 w-5 text-[#A0A0A5]" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-[#131315]">No timeline snapshots yet</div>
            <div className="mt-1 text-xs text-[#6E6E73]">
              Push a snapshot from the Resolve plugin, or tag a milestone below.
            </div>
          </div>
        </div>
        {canEdit ? (
          <div className="mt-4 flex gap-2 border-t border-[#E8E8EC] pt-3">
            <input
              value={tagMessage}
              onChange={(e) => setTagMessage(e.target.value)}
              placeholder="Or tag a manual milestone…"
              className="flex-1 rounded-[11px] border border-[#D8D8DE] bg-white px-3 py-2 text-sm text-[#131315] outline-none placeholder:text-[#A0A0A5] focus:border-[#FF6600] focus:ring-2 focus:ring-[#FF6600]/10"
            />
            <button
              type="button"
              onClick={() => void handleTag()}
              disabled={!tagMessage.trim() || tagging}
              className="rounded-full bg-[#131315] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {tagging ? "Tagging…" : "Tag"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white">
      <header
        className="flex items-center justify-between gap-2 border-b border-[#E8E8EC] bg-white px-3 py-2.5"
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[#131315]">
          <Film className="h-3.5 w-3.5" />
          Timeline history
          <span className="text-xs font-normal text-[#A0A0A5]">
            {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"}
          </span>
        </div>
        <BranchPicker
          branches={branches}
          selected={filterBranch}
          onSelect={setFilterBranch}
        />
      </header>

      <ul className="max-h-[480px] divide-y divide-[#F1F1F3] overflow-y-auto">
        {filtered.map((s, i) => (
          <li
            key={s._id}
            className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-[#FAFAFA]"
          >
            <div className="flex-shrink-0 mt-0.5">
              {s.source === "resolve" ? (
                <Film className="h-4 w-4 text-[#FF6600]" />
              ) : s.source === "premiere" ? (
                <Box className="h-4 w-4 text-[#74521D]" />
              ) : (
                <Sparkles className="h-4 w-4 text-[#A0A0A5]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-[#131315]">
                  {s.message}
                </span>
                {i === 0 ? (
                  <span className="rounded-full bg-[#FFF0E6] px-1.5 py-0.5 text-[10px] font-medium text-[#D14E00]">
                    Head
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#6E6E73]">
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="h-3 w-3" />
                  {s.branch}
                </span>
                <span>·</span>
                <span>{s.createdByName}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatRelativeTime(s._creationTime)}
                </span>
                {s.sizeBytes != null ? (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Database className="h-3 w-3" />
                      {formatBytes(s.sizeBytes)}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <div className="flex-shrink-0 text-[11px] text-[#A0A0A5]">
              {s.source}
            </div>
          </li>
        ))}
      </ul>

      {canEdit ? (
        <div className="flex gap-2 border-t border-[#E8E8EC] bg-[#FAFAFA] px-3 py-2.5">
          <input
            value={tagMessage}
            onChange={(e) => setTagMessage(e.target.value)}
            placeholder="Tag a milestone"
            className="flex-1 rounded-[11px] border border-[#D8D8DE] bg-white px-3 py-2 text-xs text-[#131315] outline-none placeholder:text-[#A0A0A5] focus:border-[#FF6600] focus:ring-2 focus:ring-[#FF6600]/10"
          />
          <button
            type="button"
            onClick={() => void handleTag()}
            disabled={!tagMessage.trim() || tagging}
            className="rounded-full bg-[#131315] px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {tagging ? "Tagging…" : "Tag"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BranchPicker({
  branches,
  selected,
  onSelect,
}: {
  branches: Array<{ branch: string; count: number; tipAt: number }>;
  selected: string | null;
  onSelect: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-full border border-[#D8D8DE] bg-white px-2.5 py-1 text-xs font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3]"
      >
        <GitBranch className="h-3 w-3" />
        {selected ?? "All branches"}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 min-w-[180px] overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-white p-1">
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className="w-full rounded-[8px] px-3 py-1.5 text-left text-xs font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3]"
            >
              All branches
            </button>
            {branches.map((b) => (
              <button
                key={b.branch}
                type="button"
                onClick={() => {
                  onSelect(b.branch);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-[8px] px-3 py-1.5 text-left text-xs text-[#131315] transition-colors hover:bg-[#F1F1F3]"
              >
                <span>{b.branch}</span>
                <span className="text-[#A0A0A5]">{b.count}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
