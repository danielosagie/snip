import { ChevronDown, ChevronUp, GripVertical, Volume2 } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  ClipSelectionPresence,
  GhostPlayheads,
} from "@/components/presence";
import type { TimelineRange } from "@/lib/timeline/types";
import { cn } from "@/lib/utils";
import type { EditorTrack } from "./timelineModel";

const LABEL_WIDTH = 136;
const TRACK_HEIGHT = 78;

type DragState = {
  clipId: string;
  kind: "move" | "trim-in" | "trim-out";
  originX: number;
  originalStart: number;
  originalDuration: number;
  targetTrackId: string;
  position: number;
  changed: boolean;
};

type TimelineCanvasProps = {
  tracks: EditorTrack[];
  duration: number;
  frameRate: number;
  pixelsPerSecond: number;
  playhead: number;
  selectedClipIds: string[];
  viewportRange: TimelineRange;
  onViewportChange: (start: number, duration: number) => void;
  onPlayheadChange: (time: number) => void;
  onSelectionChange: (ids: string[]) => void;
  onMoveClip: (clipId: string, trackId: string, start: number) => void;
  onTrimClip: (
    clipId: string,
    edge: "in" | "out",
    position: number,
  ) => void;
  onGainChange: (clipId: string, volume: number) => void;
  onReorderTrack: (trackId: string, direction: -1 | 1) => void;
  onResolveMedia?: (mediaId: string) => void;
};

function snap(value: number, frameRate: number) {
  return Math.max(0, Math.round(value * frameRate) / frameRate);
}

function trackTone(kind: EditorTrack["kind"]) {
  switch (kind) {
    case "audio":
      return "bg-[#dbe7dc]";
    case "title":
      return "bg-[#e7def0]";
    case "metadata":
      return "bg-[#dedede]";
    default:
      return "bg-[#FDBA74]";
  }
}

export function TimelineCanvas({
  tracks,
  duration,
  frameRate,
  pixelsPerSecond,
  playhead,
  selectedClipIds,
  viewportRange,
  onViewportChange,
  onPlayheadChange,
  onSelectionChange,
  onMoveClip,
  onTrimClip,
  onGainChange,
  onReorderTrack,
  onResolveMedia,
}: TimelineCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const ignoreClickRef = useRef<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragState | null>(null);
  const timelineWidth = Math.max(
    900,
    Math.ceil((duration + 5) * pixelsPerSecond),
  );
  const tickStep = pixelsPerSecond >= 72 ? 1 : pixelsPerSecond >= 30 ? 5 : 10;
  const ticks = useMemo(() => {
    const count = Math.ceil((duration + 5) / tickStep);
    return Array.from({ length: count + 1 }, (_, index) => index * tickStep);
  }, [duration, tickStep]);

  const publishViewport = () => {
    const element = scrollRef.current;
    if (!element) return;
    onViewportChange(
      element.scrollLeft / pixelsPerSecond,
      Math.max(1, (element.clientWidth - LABEL_WIDTH) / pixelsPerSecond),
    );
  };

  const beginDrag = (
    event: ReactPointerEvent,
    track: EditorTrack,
    clip: EditorTrack["clips"][number],
    kind: DragState["kind"],
  ) => {
    if (track.locked) return;
    event.preventDefault();
    event.stopPropagation();
    onResolveMedia?.(clip.mediaId);
    const selected = selectedClipIds.includes(clip.id);
    if (!selected) onSelectionChange([clip.id]);
    const state: DragState = {
      clipId: clip.id,
      kind,
      originX: event.clientX,
      originalStart: clip.timelineStart,
      originalDuration: clip.timelineDuration,
      targetTrackId: track.id,
      position:
        kind === "trim-out"
          ? clip.timelineStart + clip.timelineDuration
          : clip.timelineStart,
      changed: false,
    };
    dragRef.current = state;
    setDragPreview(state);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = (event.clientX - drag.originX) / pixelsPerSecond;
    const position = snap(
      drag.kind === "trim-out"
        ? drag.originalStart + drag.originalDuration + delta
        : drag.originalStart + delta,
      frameRate,
    );
    let targetTrackId = drag.targetTrackId;
    if (drag.kind === "move") {
      const target = document
        .elementsFromPoint(event.clientX, event.clientY)
        .find((element) => element instanceof HTMLElement && element.dataset.trackId);
      if (target instanceof HTMLElement && target.dataset.trackId) {
        targetTrackId = target.dataset.trackId;
      }
    }
    const next = {
      ...drag,
      position,
      targetTrackId,
      changed:
        drag.changed ||
        Math.abs(event.clientX - drag.originX) >= 2 ||
        targetTrackId !== drag.targetTrackId,
    };
    dragRef.current = next;
    setDragPreview(next);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragPreview(null);
    if (!drag.changed) return;
    ignoreClickRef.current = drag.clipId;
    window.setTimeout(() => {
      if (ignoreClickRef.current === drag.clipId) ignoreClickRef.current = null;
    }, 0);
    if (drag.kind === "move") {
      onMoveClip(drag.clipId, drag.targetTrackId, drag.position);
    } else {
      onTrimClip(
        drag.clipId,
        drag.kind === "trim-in" ? "in" : "out",
        drag.position,
      );
    }
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#e8e8e0]">
      <div
        ref={scrollRef}
        className="h-full overflow-auto overscroll-contain"
        onScroll={publishViewport}
        onPointerMove={updateDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div
          className="relative min-h-full"
          style={{ width: LABEL_WIDTH + timelineWidth }}
        >
          <div className="sticky top-0 z-30 flex h-8 border-b-2 border-[#1a1a1a] bg-[#f0f0e8]">
            <div
              className="sticky left-0 z-20 grid shrink-0 place-items-center border-r-2 border-[#1a1a1a] bg-[#1a1a1a] font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#f0f0e8]"
              style={{ width: LABEL_WIDTH }}
            >
              Tracks
            </div>
            <div
              className="relative h-full cursor-crosshair bg-[#f0f0e8]"
              style={{ width: timelineWidth }}
              onPointerDown={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onPlayheadChange(
                  snap((event.clientX - rect.left) / pixelsPerSecond, frameRate),
                );
              }}
            >
              {ticks.map((time) => (
                <span
                  key={time}
                  className="absolute inset-y-0 border-l border-[#9a9a91] pl-1 pt-1 font-mono text-[8px] font-bold tabular-nums text-[#66665f]"
                  style={{ left: time * pixelsPerSecond }}
                >
                  {time}s
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            {tracks.length === 0 ? (
              <div className="flex h-36 items-center border-b-2 border-[#1a1a1a] bg-[#f0f0e8]">
                <div
                  className="sticky left-0 h-full shrink-0 border-r-2 border-[#1a1a1a] bg-[#e8e8e0]"
                  style={{ width: LABEL_WIDTH }}
                />
                <p className="px-8 font-mono text-xs font-bold uppercase tracking-[0.14em] text-[#66665f]">
                  Add first clip
                </p>
              </div>
            ) : (
              tracks.map((track, trackIndex) => (
                <div
                  key={track.id}
                  data-track-id={track.id}
                  className="flex border-b-2 border-[#1a1a1a]"
                  style={{ height: TRACK_HEIGHT }}
                >
                  <div
                    className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r-2 border-[#1a1a1a] bg-[#f0f0e8] px-2"
                    style={{ width: LABEL_WIDTH }}
                  >
                    <GripVertical className="size-3 shrink-0 text-[#77776f]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-black uppercase tracking-wide">
                        {track.name}
                      </p>
                      <p className="font-mono text-[8px] font-bold uppercase text-[#77776f]">
                        {track.kind}
                      </p>
                    </div>
                    <div className="grid gap-0.5">
                      <button
                        type="button"
                        disabled={trackIndex === 0}
                        onClick={() => onReorderTrack(track.id, -1)}
                        className="grid size-4 place-items-center border border-[#1a1a1a] disabled:opacity-25"
                        aria-label="Move track up"
                        title="Move up"
                      >
                        <ChevronUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        disabled={trackIndex === tracks.length - 1}
                        onClick={() => onReorderTrack(track.id, 1)}
                        className="grid size-4 place-items-center border border-[#1a1a1a] disabled:opacity-25"
                        aria-label="Move track down"
                        title="Move down"
                      >
                        <ChevronDown className="size-3" />
                      </button>
                    </div>
                  </div>

                  <div
                    data-track-id={track.id}
                    className="relative bg-[linear-gradient(to_right,#c8c8bf_1px,transparent_1px)] bg-[length:20px_100%]"
                    style={{ width: timelineWidth }}
                    onPointerDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      onPlayheadChange(
                        snap(
                          (event.clientX - rect.left) / pixelsPerSecond,
                          frameRate,
                        ),
                      );
                      onSelectionChange([]);
                    }}
                  >
                    {track.clips.map((clip) => {
                      const preview =
                        dragPreview?.clipId === clip.id ? dragPreview : null;
                      const start = preview
                        ? preview.kind === "trim-out"
                          ? clip.timelineStart
                          : preview.position
                        : clip.timelineStart;
                      const durationValue = preview
                        ? preview.kind === "trim-in"
                          ? clip.timelineDuration -
                            (preview.position - clip.timelineStart)
                          : preview.kind === "trim-out"
                            ? preview.position - clip.timelineStart
                            : clip.timelineDuration
                        : clip.timelineDuration;
                      const selected = selectedClipIds.includes(clip.id);
                      return (
                        <div
                          key={clip.id}
                          role="option"
                          aria-selected={selected}
                          tabIndex={0}
                          onFocus={() => onResolveMedia?.(clip.mediaId)}
                          onPointerEnter={() => onResolveMedia?.(clip.mediaId)}
                          onPointerDown={(event) =>
                            beginDrag(event, track, clip, "move")
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            if (ignoreClickRef.current === clip.id) {
                              ignoreClickRef.current = null;
                              return;
                            }
                            const additive = event.metaKey || event.ctrlKey;
                            onSelectionChange(
                              additive
                                ? selected
                                  ? selectedClipIds.filter((id) => id !== clip.id)
                                  : [...selectedClipIds, clip.id]
                                : [clip.id],
                            );
                            onPlayheadChange(clip.timelineStart);
                          }}
                          className={cn(
                            "absolute top-2 h-[60px] overflow-hidden border-2 border-[#1a1a1a] text-[#1a1a1a] shadow-[2px_2px_0_0_#1a1a1a] focus-visible:outline-2 focus-visible:outline-offset-2",
                            trackTone(track.kind),
                            selected && "bg-[#FFEDD5] outline outline-2 outline-[#C2410C]",
                            track.locked && "cursor-not-allowed opacity-60",
                          )}
                          style={{
                            left: Math.max(0, start) * pixelsPerSecond,
                            width: Math.max(14, durationValue * pixelsPerSecond),
                          }}
                        >
                          <ClipSelectionPresence clipId={clip.id} />
                          <button
                            type="button"
                            className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize border-r-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#C2410C]"
                            aria-label="Trim in"
                            title="Trim in"
                            onPointerDown={(event) =>
                              beginDrag(event, track, clip, "trim-in")
                            }
                          />
                          <div className="min-w-0 px-3 pt-1.5">
                            <p className="truncate text-[10px] font-black uppercase tracking-wide">
                              {clip.name}
                            </p>
                            <p className="mt-0.5 font-mono text-[8px] font-bold tabular-nums text-[#55554f]">
                              {clip.timelineDuration.toFixed(2)}s
                            </p>
                          </div>
                          <label
                            className="absolute bottom-1 left-3 right-3 z-20 flex items-center gap-1"
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <Volume2 className="size-2.5 shrink-0" />
                            <span className="sr-only">Clip gain</span>
                            <input
                              type="range"
                              min={0}
                              max={1.5}
                              step={0.05}
                              value={clip.volume}
                              onChange={(event) =>
                                onGainChange(clip.id, Number(event.currentTarget.value))
                              }
                              className="h-3 min-w-0 flex-1 cursor-ew-resize accent-[#C2410C]"
                            />
                          </label>
                          <button
                            type="button"
                            className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize border-l-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#C2410C]"
                            aria-label="Trim out"
                            title="Trim out"
                            onPointerDown={(event) =>
                              beginDrag(event, track, clip, "trim-out")
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}

            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-0 border-l-2 border-[#C2410C]"
              style={{ left: LABEL_WIDTH + playhead * pixelsPerSecond }}
              aria-hidden="true"
            >
              <span className="absolute -left-1.5 top-0 size-3 -translate-y-1/2 rotate-45 border-2 border-[#1a1a1a] bg-[#C2410C]" />
            </div>
          </div>
        </div>
      </div>

      <div
        className="pointer-events-none absolute bottom-0 right-0 top-8 z-20"
        style={{ left: LABEL_WIDTH }}
      >
        <GhostPlayheads viewportRange={viewportRange} />
      </div>
    </div>
  );
}
