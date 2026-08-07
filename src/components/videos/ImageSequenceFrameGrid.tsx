"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ImageSequenceFrameGridProps {
  frames: Array<{ key: string; url: string }> | null;
}

/**
 * Frame-grid + scrubbable viewer for image sequences.
 *
 *   - Top: large preview of the currently-selected frame.
 *   - Bottom: scrubbable horizontal strip of every frame, click to jump.
 *
 * This is the preview for sequences, with no server-side video stitching
 * (ffmpeg doesn't run cleanly in a Convex action). Pure client-side,
 * dependency-free. The canvas and immediate controls use the dark player
 * surface treatment.
 */
export function ImageSequenceFrameGrid({
  frames,
}: ImageSequenceFrameGridProps) {
  const [index, setIndex] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!frames) return;
    if (index >= frames.length) setIndex(0);
  }, [frames, index]);

  if (frames === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/70 text-sm">
        Loading sequence frames…
      </div>
    );
  }
  if (frames.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/70 text-sm">
        No frames available for this sequence.
      </div>
    );
  }

  const current = frames[Math.min(index, frames.length - 1)];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Large preview of the focused frame. */}
      <div className="flex-1 flex items-center justify-center min-h-0 p-4">
        <img
          src={current.url}
          alt={`Frame ${index + 1} of ${frames.length}`}
          className="max-h-full max-w-full rounded-[14px] border border-[#26262A] bg-[#0A0A0B] object-contain"
        />
      </div>

      {/* Scrubber and frame strip. */}
      <div className="flex-shrink-0 border-t border-[#26262A] bg-[#161618]">
        <div className="flex items-center justify-between px-4 py-2 font-mono text-[11px] text-white">
          <span>
            Frame <span className="text-[#FF6600]">{index + 1}</span>
            <span className="text-[#A0A0A5]"> / {frames.length}</span>
          </span>
          <span className="text-[#A0A0A5]">
            Drag to scrub
          </span>
        </div>
        <div className="px-4 pb-2">
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            className="w-full accent-[#FF6600]"
          />
        </div>
        <div
          ref={stripRef}
          className="flex overflow-x-auto border-t border-[#26262A] bg-[#0A0A0B]"
        >
          {frames.map((frame, i) => (
            <button
              key={frame.key}
              type="button"
              onClick={() => setIndex(i)}
              className={cn(
                "flex h-16 w-24 flex-shrink-0 items-center justify-center border-r border-[#26262A] bg-[#0A0A0B] transition-opacity",
                i === index ? "opacity-100 ring-2 ring-[#FF6600] ring-inset" : "opacity-60 hover:opacity-100",
              )}
              aria-label={`Show frame ${i + 1}`}
            >
              <img
                src={frame.url}
                alt=""
                className="max-h-full max-w-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
