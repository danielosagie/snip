"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ImageSequenceFrameGridProps {
  frames: Array<{ key: string; url: string }> | null;
  stitchStatus?: string;
  stitchError?: string;
}

/**
 * Frame-grid + scrubbable viewer for image sequences. Renders before
 * the ffmpeg stitch completes (or permanently when stitching fails).
 *
 *   - Top half: large preview of the currently-selected frame.
 *   - Bottom: scrubbable horizontal strip of every frame, click to jump.
 *
 * Brutalist styling: black backdrop, cream borders, accent-orange
 * scrubber thumb. Square corners.
 */
export function ImageSequenceFrameGrid({
  frames,
  stitchStatus,
  stitchError,
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
      {/* Stitch status banner — brutalist strip across the top. */}
      {stitchStatus && stitchStatus !== "ready" && (
        <div className="flex-shrink-0 flex items-center gap-3 border-b-2 border-[#1a1a1a] bg-[#f0f0e8] px-4 py-2 text-[12px] font-medium text-[#1a1a1a]">
          {stitchStatus === "pending" || stitchStatus === "preparing" ? (
            <>
              <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-[#C2410C]" />
              <span className="font-bold">
                Stitching sequence into a video preview…
              </span>
              <span className="text-[#888]">
                Frame grid stays available below.
              </span>
            </>
          ) : stitchStatus === "errored" ? (
            <>
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#dc2626]" />
              <span className="font-bold">Stitch failed</span>
              <span className="text-[#888]">
                {stitchError ?? "Frame grid is the only preview."}
              </span>
            </>
          ) : null}
        </div>
      )}

      {/* Large preview of the focused frame. */}
      <div className="flex-1 flex items-center justify-center min-h-0 p-4">
        <img
          src={current.url}
          alt={`Frame ${index + 1} of ${frames.length}`}
          className="max-h-full max-w-full object-contain border-2 border-[#1a1a1a] bg-black"
        />
      </div>

      {/* Scrubber + frame strip — brutalist, square thumbs. */}
      <div className="flex-shrink-0 border-t-2 border-[#1a1a1a] bg-[#1a1a1a]">
        <div className="flex items-center justify-between px-4 py-2 text-[11px] font-mono uppercase tracking-wider text-[#f0f0e8]">
          <span>
            Frame <span className="text-[#FDBA74]">{index + 1}</span>
            <span className="text-white/40"> / {frames.length}</span>
          </span>
          <span className="text-white/40">
            Click any frame to jump · drag the slider to scrub
          </span>
        </div>
        <div className="px-4 pb-2">
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            className="w-full accent-[#C2410C]"
          />
        </div>
        <div
          ref={stripRef}
          className="flex overflow-x-auto border-t border-white/10 bg-black"
        >
          {frames.map((frame, i) => (
            <button
              key={frame.key}
              type="button"
              onClick={() => setIndex(i)}
              className={cn(
                "flex-shrink-0 h-16 w-24 border-r border-white/10 bg-black flex items-center justify-center transition-opacity",
                i === index ? "opacity-100 ring-2 ring-[#C2410C] ring-inset" : "opacity-60 hover:opacity-100",
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
