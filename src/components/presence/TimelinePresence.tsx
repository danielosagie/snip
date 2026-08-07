"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { TimelineClipId, TimelineRange } from "@/lib/timeline/types";
import { useTimelinePresence } from "./useEditPresence";

const PRESENCE_COLORS = [
  "#C2410C",
  "#2563EB",
  "#15803D",
  "#7E22CE",
  "#B45309",
  "#BE123C",
] as const;

function stableColor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "??";
}

function seconds(time: { value: number; rate: number }) {
  return time.rate > 0 ? time.value / time.rate : 0;
}

export function PresenceAvatarStack({
  className,
  limit = 5,
  includeSelf = true,
}: {
  className?: string;
  limit?: number;
  includeSelf?: boolean;
}) {
  const { participants, peers } = useTimelinePresence();
  const people = includeSelf ? participants : peers;
  if (people.length === 0) return null;

  const visible = people.slice(0, limit);
  const overflow = Math.max(0, people.length - visible.length);

  return (
    <div
      className={cn("inline-flex items-center -space-x-1.5", className)}
      aria-label={`${people.length} present`}
      title={people.map((person) => person.displayName).join(", ")}
    >
      {visible.map((person) => (
        <Avatar
          key={person.userId}
          className="h-6 w-6 border-2 border-[#f0f0e8]"
          style={{ outline: `1px solid ${stableColor(person.actorId)}` }}
        >
          {person.avatarUrl ? (
            <AvatarImage src={person.avatarUrl} alt={person.displayName} />
          ) : null}
          <AvatarFallback className="bg-[#e8e8e0] text-[8px] font-black text-[#1a1a1a]">
            {initials(person.displayName)}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 ? (
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-[#f0f0e8] bg-[#1a1a1a] px-1 text-[8px] font-black text-[#f0f0e8]">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

export function GhostPlayheads({
  viewportRange,
  className,
}: {
  viewportRange?: TimelineRange;
  className?: string;
}) {
  const { peers } = useTimelinePresence();
  if (peers.length === 0) return null;

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 z-20", className)}
      aria-hidden="true"
    >
      {peers.map((peer) => {
        const range = viewportRange ?? peer.payload.viewportRange;
        const start = seconds(range.start);
        const duration = seconds(range.duration);
        if (duration <= 0) return null;
        const position = seconds(peer.payload.playheadPosition);
        const percent = ((position - start) / duration) * 100;
        if (percent < 0 || percent > 100) return null;
        const color = stableColor(peer.actorId);

        return (
          <div
            key={peer.userId}
            className="absolute inset-y-0 w-px"
            style={{ left: `${percent}%`, backgroundColor: color }}
          >
            <span
              className="absolute left-0 top-0 max-w-28 -translate-x-px truncate border border-[#1a1a1a] px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none text-[#f0f0e8]"
              style={{ backgroundColor: color }}
            >
              {peer.displayName}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Mount inside a position-relative clip. */
export function ClipSelectionPresence({
  clipId,
  className,
}: {
  clipId: TimelineClipId;
  className?: string;
}) {
  const { peers } = useTimelinePresence();
  const selectingPeers = peers.filter((peer) =>
    peer.payload.selectedClipIds.includes(clipId),
  );
  if (selectingPeers.length === 0) return null;

  const first = selectingPeers[0];
  const color = stableColor(first.actorId);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-10 border-2",
        className,
      )}
      style={{ borderColor: color }}
      title={selectingPeers.map((peer) => peer.displayName).join(", ")}
      aria-hidden="true"
    >
      <span
        className="absolute bottom-0 right-0 max-w-[75%] truncate border-l border-t border-[#1a1a1a] px-1 py-0.5 font-mono text-[8px] font-bold leading-none text-[#f0f0e8]"
        style={{ backgroundColor: color }}
      >
        {selectingPeers.length === 1
          ? first.displayName
          : `${first.displayName} +${selectingPeers.length - 1}`}
      </span>
    </div>
  );
}
