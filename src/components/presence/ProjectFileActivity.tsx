"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import {
  fileNameFromPath,
  isDesktopActivityActive,
} from "./model";

const CLOCK_TICK_MS = 15_000;

function normalizedPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function compactAge(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export interface ProjectFileActivityEntry {
  key: string;
  clientId: string;
  userClerkId: string;
  displayName: string;
  path: string;
  fileName: string;
  process?: string;
  lastSeen: number;
}

export function useProjectFileActivity(projectId?: Id<"projects">) {
  const rows = useQuery(
    api.desktopPresence.listForProject,
    projectId ? { projectId } : "skip",
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  const entries = useMemo(() => {
    if (!rows) return [];
    const next: ProjectFileActivityEntry[] = [];

    for (const row of rows) {
      if (!isDesktopActivityActive(row.lastSeen, now)) continue;
      for (const file of row.files) {
        next.push({
          key: `${row.clientId}:${file.path}`,
          clientId: row.clientId,
          userClerkId: row.userClerkId,
          displayName: row.userName?.trim() || "Teammate",
          path: normalizedPath(file.path),
          fileName: fileNameFromPath(file.path),
          process: file.process,
          lastSeen: row.lastSeen,
        });
      }
    }

    return next.sort((left, right) => right.lastSeen - left.lastSeen);
  }, [now, rows]);

  return { entries, isLoading: projectId !== undefined && rows === undefined, now };
}

export function ProjectFileActivity({
  projectId,
  className,
  limit = 3,
}: {
  projectId: Id<"projects">;
  className?: string;
  limit?: number;
}) {
  const { entries, now } = useProjectFileActivity(projectId);
  if (entries.length === 0) return null;

  const visible = entries.slice(0, limit);
  const overflow = Math.max(0, entries.length - visible.length);

  return (
    <aside
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-b-2 border-[#1a1a1a] bg-[#FFEDD5] px-6 py-2 text-xs text-[#1a1a1a]",
        className,
      )}
      aria-label="File activity"
    >
      <span className="font-black uppercase tracking-wider">File activity</span>
      {visible.map((entry) => (
        <span key={entry.key} className="min-w-0 font-mono">
          <strong className="font-bold">{entry.displayName}</strong>
          {" · "}
          <span title={entry.path}>{entry.fileName}</span>
          {" · "}
          <span className="text-[#666]">{compactAge(entry.lastSeen, now)}</span>
        </span>
      ))}
      {overflow > 0 ? (
        <span className="font-mono text-[#666]">+{overflow}</span>
      ) : null}
    </aside>
  );
}

export function DesktopFileLockWarning({
  projectId,
  path,
  ignoreUserClerkId,
  onOpenAnyway,
  onClose,
  className,
}: {
  projectId: Id<"projects">;
  path: string;
  ignoreUserClerkId?: string;
  onOpenAnyway?: () => void;
  onClose?: () => void;
  className?: string;
}) {
  const { entries, now } = useProjectFileActivity(projectId);
  const targetPath = normalizedPath(path);
  const conflicts = entries.filter(
    (entry) =>
      entry.path === targetPath && entry.userClerkId !== ignoreUserClerkId,
  );
  const first = conflicts[0];
  if (!first) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-2 border-[#1a1a1a] bg-[#FDBA74] px-3 py-2 text-[#1a1a1a]",
        className,
      )}
    >
      <span className="text-xs font-black uppercase tracking-wider">In use</span>
      <span className="font-mono text-xs">
        {first.displayName} · {compactAge(first.lastSeen, now)}
      </span>
      {conflicts.length > 1 ? (
        <span className="font-mono text-xs">+{conflicts.length - 1}</span>
      ) : null}
      <div className="ml-auto flex items-center gap-3">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold underline underline-offset-2"
          >
            Close
          </button>
        ) : null}
        {onOpenAnyway ? (
          <button
            type="button"
            onClick={onOpenAnyway}
            className="border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2.5 py-1 text-xs font-black shadow-[2px_2px_0_0_#1a1a1a] transition-transform hover:translate-x-px hover:translate-y-px hover:shadow-none"
          >
            Open anyway
          </button>
        ) : null}
      </div>
    </div>
  );
}
