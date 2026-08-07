import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  clipMediaTimeToTimelineTime,
  createPlaybackController,
  nextSequenceClip,
  sortSequenceClips,
  timelineTimeToClip,
  timelineTimeToClipMediaTime,
  type PlaybackController,
  type SequencePlaybackClip,
} from "@/lib/playback";
import { cn } from "@/lib/utils";

export type SequencePlaybackHandle = {
  play: () => Promise<void>;
  pause: () => void;
  seek: (timelineTime: number) => Promise<void>;
};

type SequencePlaybackSurfaceProps = {
  clips: SequencePlaybackClip[];
  className?: string;
  onTimeUpdate: (timelineTime: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onStatusChange?: (status: string) => void;
};

type BankIndex = 0 | 1;

function sourceKey(clip: SequencePlaybackClip) {
  return clip.source
    ? `${clip.source.contentHash}\n${clip.source.url}`
    : null;
}

function otherBank(bank: BankIndex): BankIndex {
  return bank === 0 ? 1 : 0;
}

export const SequencePlaybackSurface = forwardRef<
  SequencePlaybackHandle,
  SequencePlaybackSurfaceProps
>(function SequencePlaybackSurface(
  {
    clips,
    className,
    onTimeUpdate,
    onPlayingChange,
    onStatusChange,
  },
  forwardedRef,
) {
  const canvasRefs = useRef<[HTMLCanvasElement | null, HTMLCanvasElement | null]>([
    null,
    null,
  ]);
  const videoRefs = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([
    null,
    null,
  ]);
  const controllersRef = useRef<
    [PlaybackController | null, PlaybackController | null]
  >([null, null]);
  const cleanupRef = useRef<Array<() => void>>([]);
  const loadedKeyRef = useRef<[string | null, string | null]>([null, null]);
  const loadedClipRef = useRef<
    [SequencePlaybackClip | null, SequencePlaybackClip | null]
  >([null, null]);
  const generationRef = useRef<[number, number]>([0, 0]);
  const activeBankRef = useRef<BankIndex>(0);
  const activeClipRef = useRef<SequencePlaybackClip | null>(null);
  const clipsRef = useRef(sortSequenceClips(clips));
  const timeRef = useRef(0);
  const wantsPlaybackRef = useRef(false);
  const transitioningRef = useRef(false);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlayingChangeRef = useRef(onPlayingChange);
  const onStatusChangeRef = useRef(onStatusChange);
  const seekTimelineRef = useRef<
    ((timelineTime: number, resume: boolean) => Promise<void>) | null
  >(null);
  const [activeBank, setActiveBank] = useState<BankIndex>(0);

  clipsRef.current = sortSequenceClips(clips);
  onTimeUpdateRef.current = onTimeUpdate;
  onPlayingChangeRef.current = onPlayingChange;
  onStatusChangeRef.current = onStatusChange;

  const reportStatus = useCallback((status: string) => {
    onStatusChangeRef.current?.(status);
  }, []);

  const loadBank = useCallback(
    async (
      bank: BankIndex,
      clip: SequencePlaybackClip,
      mediaTime: number,
      preload = false,
    ) => {
      const controller = controllersRef.current[bank];
      const source = clip.source;
      if (!controller || !source) throw new Error("Proxy unavailable");

      const generation = ++generationRef.current[bank];
      const key = sourceKey(clip);
      if (loadedKeyRef.current[bank] !== key) {
        if (!preload) reportStatus("Loading proxy");
        await controller.load(source);
        if (generation !== generationRef.current[bank]) return;
        loadedKeyRef.current[bank] = key;
      }
      await controller.seek(mediaTime);
      if (generation !== generationRef.current[bank]) return;
      loadedClipRef.current[bank] = clip;
      const video = videoRefs.current[bank];
      if (video) {
        video.volume = Math.max(0, Math.min(1, clip.volume));
        video.playbackRate = Math.max(0.25, Math.min(4, clip.playbackRate));
      }
      if (!preload) reportStatus("Ready");
    },
    [reportStatus],
  );

  const preloadAfter = useCallback(
    (clip: SequencePlaybackClip, bank: BankIndex) => {
      const next = nextSequenceClip(clipsRef.current, clip.id);
      if (!next?.source) return;
      const preloadBank = otherBank(bank);
      void loadBank(preloadBank, next, next.sourceStart, true).catch(() => {
        loadedKeyRef.current[preloadBank] = null;
        loadedClipRef.current[preloadBank] = null;
      });
    },
    [loadBank],
  );

  const seekTimeline = useCallback(
    async (timelineTime: number, resume: boolean) => {
      const clip = timelineTimeToClip(clipsRef.current, timelineTime);
      timeRef.current = Math.max(0, timelineTime);
      if (!clip?.source) {
        controllersRef.current[activeBankRef.current]?.pause();
        activeClipRef.current = clip;
        onTimeUpdateRef.current(timeRef.current);
        reportStatus(clip ? "Proxy unavailable" : "No clip");
        if (resume) onPlayingChangeRef.current(false);
        return;
      }

      const key = sourceKey(clip);
      const inactive = otherBank(activeBankRef.current);
      const bank =
        loadedKeyRef.current[inactive] === key
          ? inactive
          : loadedKeyRef.current[activeBankRef.current] === key
            ? activeBankRef.current
            : inactive;
      const mediaTime = timelineTimeToClipMediaTime(clip, timelineTime);
      await loadBank(bank, clip, mediaTime);
      activeClipRef.current = clip;
      activeBankRef.current = bank;
      setActiveBank(bank);
      onTimeUpdateRef.current(timeRef.current);
      preloadAfter(clip, bank);
      if (resume && wantsPlaybackRef.current) {
        await controllersRef.current[bank]?.play();
        onPlayingChangeRef.current(true);
        reportStatus("Playing");
      }
    },
    [loadBank, preloadAfter, reportStatus],
  );
  seekTimelineRef.current = seekTimeline;

  const transitionToNext = useCallback(async () => {
    if (transitioningRef.current) return;
    const current = activeClipRef.current;
    if (!current) return;
    transitioningRef.current = true;
    controllersRef.current[activeBankRef.current]?.pause();
    try {
      let next = nextSequenceClip(clipsRef.current, current.id);
      while (next && !next.source) {
        next = nextSequenceClip(clipsRef.current, next.id);
      }
      if (!next) {
        wantsPlaybackRef.current = false;
        onPlayingChangeRef.current(false);
        reportStatus("Ended");
        return;
      }
      timeRef.current = next.timelineStart;
      await seekTimeline(next.timelineStart, true);
    } catch (error) {
      wantsPlaybackRef.current = false;
      onPlayingChangeRef.current(false);
      reportStatus(error instanceof Error ? error.message : "Playback failed");
    } finally {
      transitioningRef.current = false;
    }
  }, [reportStatus, seekTimeline]);

  useEffect(() => {
    const canvases = canvasRefs.current;
    const videos = videoRefs.current;
    if (!canvases[0] || !canvases[1] || !videos[0] || !videos[1]) return;

    const controllers: [PlaybackController, PlaybackController] = [
      createPlaybackController({ canvas: canvases[0], fallbackVideo: videos[0] }),
      createPlaybackController({ canvas: canvases[1], fallbackVideo: videos[1] }),
    ];
    controllersRef.current = controllers;

    controllers.forEach((controller, rawBank) => {
      const bank = rawBank as BankIndex;
      cleanupRef.current.push(
        controller.on("timeupdate", ({ currentTime }) => {
          if (bank !== activeBankRef.current) return;
          const clip = activeClipRef.current;
          if (!clip || loadedClipRef.current[bank]?.id !== clip.id) return;
          const timelineTime = clipMediaTimeToTimelineTime(clip, currentTime);
          timeRef.current = timelineTime;
          onTimeUpdateRef.current(timelineTime);
          const mediaEnd = timelineTimeToClipMediaTime(
            clip,
            clip.timelineStart + clip.timelineDuration,
          );
          if (
            wantsPlaybackRef.current &&
            currentTime >= mediaEnd - 1 / 120
          ) {
            void transitionToNext();
          }
        }),
        controller.on("waiting", () => {
          if (bank === activeBankRef.current) reportStatus("Reading proxy");
        }),
        controller.on("modechange", ({ mode }) => {
          if (bank === activeBankRef.current) {
            reportStatus(mode === "webcodecs" ? "WebCodecs" : "Video fallback");
          }
        }),
        controller.on("ended", () => {
          if (bank === activeBankRef.current && wantsPlaybackRef.current) {
            void transitionToNext();
          }
        }),
        controller.on("error", ({ error }) => {
          if (bank === activeBankRef.current) reportStatus(error.message);
        }),
      );
    });
    return () => {
      for (const cleanup of cleanupRef.current) cleanup();
      cleanupRef.current = [];
      controllers[0].destroy();
      controllers[1].destroy();
      controllersRef.current = [null, null];
    };
  }, [reportStatus, transitionToNext]);

  useEffect(() => {
    const activeClip = activeClipRef.current;
    if (!activeClip) return;
    const latest = clipsRef.current.find((clip) => clip.id === activeClip.id);
    if (!latest) {
      controllersRef.current[activeBankRef.current]?.pause();
      activeClipRef.current = null;
      wantsPlaybackRef.current = false;
      onPlayingChangeRef.current(false);
      return;
    }
    activeClipRef.current = latest;
    const video = videoRefs.current[activeBankRef.current];
    if (video) {
      video.volume = Math.max(0, Math.min(1, latest.volume));
      video.playbackRate = Math.max(0.25, Math.min(4, latest.playbackRate));
    }
  }, [clips]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      play: async () => {
        wantsPlaybackRef.current = true;
        const current = activeClipRef.current;
        const activeKey = current ? sourceKey(current) : null;
        const needsLoad =
          current?.source &&
          (loadedKeyRef.current[activeBankRef.current] !== activeKey ||
            loadedClipRef.current[activeBankRef.current]?.id !== current.id);
        if (!current?.source || needsLoad) {
          const exact = timelineTimeToClip(clipsRef.current, timeRef.current);
          const firstPlayable =
            (exact?.source ? exact : null) ??
            clipsRef.current.find(
              (clip) =>
                clip.source &&
                clip.timelineStart + clip.timelineDuration >= timeRef.current,
            ) ??
            null;
          if (!firstPlayable) {
            wantsPlaybackRef.current = false;
            reportStatus("Proxy unavailable");
            return;
          }
          await seekTimeline(
            Math.max(firstPlayable.timelineStart, timeRef.current),
            true,
          );
          return;
        }
        await controllersRef.current[activeBankRef.current]?.play();
        onPlayingChangeRef.current(true);
        reportStatus("Playing");
      },
      pause: () => {
        wantsPlaybackRef.current = false;
        controllersRef.current[activeBankRef.current]?.pause();
        onPlayingChangeRef.current(false);
        reportStatus("Paused");
      },
      seek: async (timelineTime: number) => {
        const resume = wantsPlaybackRef.current;
        controllersRef.current[activeBankRef.current]?.pause();
        await seekTimelineRef.current?.(timelineTime, resume);
      },
    }),
    [reportStatus, seekTimeline],
  );

  return (
    <div
      className={cn(
        "relative grid aspect-video w-full place-items-center overflow-hidden bg-[#11110f]",
        className,
      )}
    >
      {([0, 1] as const).map((bank) => (
        <div
          key={bank}
          className={cn(
            "absolute inset-0 grid place-items-center bg-[#11110f]",
            activeBank === bank ? "visible" : "invisible",
          )}
          aria-hidden={activeBank !== bank}
        >
          <canvas
            ref={(node) => {
              canvasRefs.current[bank] = node;
            }}
            className="block h-full w-full object-contain"
            aria-label="Sequence proxy"
          />
          <video
            ref={(node) => {
              videoRefs.current[bank] = node;
            }}
            className="block h-full w-full object-contain"
            aria-label="Sequence fallback"
          />
        </div>
      ))}
      {clips.length === 0 ? (
        <p className="relative z-10 font-mono text-xs font-bold uppercase tracking-[0.16em] text-[#aaa99f]">
          Empty sequence
        </p>
      ) : null}
    </div>
  );
});
