"use client";

import type { TimelineSoftLockClaim } from "@/lib/timeline/types";
import { cn } from "@/lib/utils";
import { getSoftLockConflicts } from "./model";
import { useTimelinePresence } from "./useEditPresence";

function compactAge(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export function SoftLockWarning({
  target,
  onOpenAnyway,
  onClose,
  className,
}: {
  target: TimelineSoftLockClaim["target"];
  onOpenAnyway?: () => void;
  onClose?: () => void;
  className?: string;
}) {
  const { peers, actorId } = useTimelinePresence();
  const now = Date.now();
  const conflicts = getSoftLockConflicts(peers, target, actorId, now);
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
        {first.participant.displayName} · {compactAge(first.claim.claimedAt, now)}
      </span>
      {conflicts.length > 1 ? (
        <span className="font-mono text-xs">+{conflicts.length - 1}</span>
      ) : null}
      <div className="ml-auto flex items-center gap-3">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Close
          </button>
        ) : null}
        {onOpenAnyway ? (
          <button
            type="button"
            onClick={onOpenAnyway}
            className="border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2.5 py-1 text-xs font-black shadow-[2px_2px_0_0_#1a1a1a] transition-transform hover:translate-x-px hover:translate-y-px hover:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Open anyway
          </button>
        ) : null}
      </div>
    </div>
  );
}
