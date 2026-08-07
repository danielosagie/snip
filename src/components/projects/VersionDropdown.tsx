"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, FolderClosed, Check, Star } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";

interface Props {
  projectId: Id<"projects">;
  canEdit: boolean;
}

/**
 * Version-folder switcher for the project page. Lists every folder the
 * agency has pushed via the desktop app and lets a member mark a different
 * one as the canonical "latest." Viewers (without member role) see the
 * dropdown read-only — a project history panel they can browse.
 */
export function VersionDropdown({ projectId, canEdit }: Props) {
  const versions = useQuery(api.projectVersions.list, { projectId });
  const markLatest = useMutation(api.projectVersions.markLatest);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Hide the chip entirely until at least one snapshot exists. Empty
  // state is noisy on a fresh project and was confusing users who
  // hadn't installed the desktop app yet.
  if (versions === undefined || versions.length === 0) return null;

  const latest = versions.find((v) => v.isLatest) ?? versions[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          open
            ? "border-[#D8D8DE] bg-[#FFF0E6] text-[#D14E00]"
            : "border-[#D8D8DE] bg-white text-[#131315] hover:bg-[#F1F1F3]",
        )}
      >
        <FolderClosed className="h-3.5 w-3.5" />
        <span>{latest.folderName}</span>
        {latest.isLatest ? (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              open ? "bg-white text-[#D14E00]" : "bg-[#FFF0E6] text-[#D14E00]",
            )}
          >
            Latest
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-40 mt-2 min-w-[320px] max-w-[420px] overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white">
            <div className="border-b border-[#E8E8EC] px-3 py-2.5 text-[13px] font-semibold text-[#131315]">
              Version history
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              {versions.map((v) => (
                <li
                  key={v._id}
                  className="border-b border-[#F1F1F3] last:border-b-0"
                >
                  <div className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-[#FAFAFA]">
                    <FolderClosed className="h-4 w-4 flex-shrink-0 text-[#A0A0A5]" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-sm font-medium text-[#131315]">
                        {v.folderName}
                        {v.isLatest ? (
                          <Star className="h-3 w-3 fill-[#FF6600] text-[#FF6600]" />
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#6E6E73]">
                        <span>by {v.createdByName}</span>
                        <span>·</span>
                        <span>push #{v.versionNumber}</span>
                        {v.label ? (
                          <>
                            <span>·</span>
                            <span className="italic truncate">
                              {v.label}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {canEdit && !v.isLatest ? (
                      <button
                        type="button"
                        onClick={async () => {
                          setBusyId(v._id);
                          try {
                            await markLatest({ versionId: v._id });
                          } catch (err) {
                            console.error("markLatest failed", err);
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        disabled={busyId !== null}
                        className="rounded-full px-2 py-1 text-xs font-medium text-[#D14E00] transition-colors hover:bg-[#FFF0E6] disabled:opacity-40"
                      >
                        {busyId === v._id ? "…" : "Set latest"}
                      </button>
                    ) : v.isLatest ? (
                      <Check className="h-4 w-4 text-[#FF6600]" />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
