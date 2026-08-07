"use client";

import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type PreviewSession = { url: string; posterUrl: string };

const previewSessions = new Map<string, Promise<PreviewSession>>();

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

export function MediaHoverPreview({
  videoId,
  title,
  posterUrl,
  duration,
  className,
}: {
  videoId: Id<"videos">;
  title: string;
  posterUrl?: string;
  duration?: number;
  className?: string;
}) {
  const getSession = useAction(api.videoActions.getHoverPreviewSession);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const pendingFractionRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active || session || failed) return;
    const key = String(videoId);
    let request = previewSessions.get(key);
    if (!request) {
      request = getSession({ videoId });
      previewSessions.set(key, request);
    }
    let cancelled = false;
    void request
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .catch(() => {
        previewSessions.delete(key);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, failed, getSession, session, videoId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !session || !video) return;
    let disposed = false;
    let destroyHls: (() => void) | undefined;

    const play = () => {
      if (disposed) return;
      const total = duration ?? video.duration;
      const pending = pendingFractionRef.current;
      if (pending !== null && Number.isFinite(total) && total > 0) {
        video.currentTime = pending * total;
      }
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        void video.play().catch(() => {});
      }
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = session.url;
      video.addEventListener("loadedmetadata", play, { once: true });
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          video.src = session.url;
          video.addEventListener("loadedmetadata", play, { once: true });
          return;
        }
        const hls = new Hls({
          enableWorker: true,
          startLevel: 0,
          capLevelToPlayerSize: true,
          maxBufferLength: 12,
        });
        destroyHls = () => hls.destroy();
        hls.loadSource(session.url);
        hls.attachMedia(video);
        hls.once(Hls.Events.MANIFEST_PARSED, play);
      });
    }

    return () => {
      disposed = true;
      destroyHls?.();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [active, duration, session]);

  const updateReadout = (seconds: number, total: number) => {
    const fraction = total > 0 ? Math.min(1, Math.max(0, seconds / total)) : 0;
    if (progressRef.current) {
      progressRef.current.style.transform = `scaleX(${fraction})`;
    }
    if (timeRef.current) {
      timeRef.current.textContent = `${formatClock(seconds)} / ${formatClock(total)}`;
    }
  };

  return (
    <div
      className={cn("absolute inset-0 z-10 overflow-hidden", className)}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => {
        setActive(false);
        pendingFractionRef.current = null;
      }}
      onPointerMove={(event) => {
        if (!active) {
          // The project grid mounts this lazily, on tile hover — by then the
          // pointer can already be inside, so `onPointerEnter` never fires.
          // Treat the first move as the enter.
          setActive(true);
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const fraction = Math.min(
          1,
          Math.max(0, (event.clientX - rect.left) / rect.width),
        );
        pendingFractionRef.current = fraction;
        const video = videoRef.current;
        const total = duration ?? video?.duration ?? 0;
        if (video && Number.isFinite(total) && total > 0) {
          const nextTime = fraction * total;
          if (Math.abs(video.currentTime - nextTime) > 0.12) {
            video.currentTime = nextTime;
          }
          updateReadout(nextTime, total);
        }
      }}
    >
      {active ? (
        <div className="absolute inset-0 bg-[#161613]">
          <video
            ref={videoRef}
            muted
            loop
            playsInline
            preload="metadata"
            poster={session?.posterUrl ?? posterUrl}
            aria-label={`Preview ${title}`}
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              updateReadout(video.currentTime, duration ?? video.duration);
            }}
            className="h-full w-full object-cover"
          />
          {!session && posterUrl ? (
            <img
              src={posterUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[#161613]/85 px-2 pb-1.5 pt-4 text-[#f4f1e8]">
            <div className="mb-1 h-1 overflow-hidden bg-[#f4f1e8]/30">
              <div
                ref={progressRef}
                className="h-full origin-left scale-x-0 bg-[#FF6600]"
              />
            </div>
            <div className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wide">
              <span>{failed ? "Preview unavailable" : "Move to scrub"}</span>
              <span ref={timeRef}>0:00 / {formatClock(duration ?? 0)}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
