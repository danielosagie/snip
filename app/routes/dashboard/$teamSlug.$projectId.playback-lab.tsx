import { useAction, useQuery } from "convex/react";
import { createFileRoute } from "@tanstack/react-router";
import { Pause, Play, StepBack, StepForward } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PlaybackSurface } from "@/components/editor/PlaybackSurface";
import { Button } from "@/components/ui/button";
import type {
  PlaybackController,
  PlaybackMetadata,
  PlaybackMode,
  PlaybackSource,
} from "@/lib/playback";
import { formatBytes } from "@/lib/utils";
import { DashboardHeader } from "@/components/DashboardHeader";

export const Route = createFileRoute(
  "/dashboard/$teamSlug/$projectId/playback-lab",
)({
  component: PlaybackLabRoute,
});

function extensionOf(value: string | undefined): string | null {
  if (!value) return null;
  const index = value.lastIndexOf(".");
  if (index < 0 || index === value.length - 1) return null;
  return value.slice(index + 1).toLowerCase();
}

function stripExtension(value: string, extension: string): string {
  const suffix = `.${extension}`;
  return value.toLowerCase().endsWith(suffix)
    ? value.slice(0, -suffix.length)
    : value;
}

function formatTimecode(seconds: number, frameRate: number): string {
  const fps = Math.max(1, Math.round(frameRate || 30));
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return [hours, minutes, secs, frames]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function PlaybackLabRoute() {
  const { teamSlug, projectId: rawProjectId } = Route.useParams();
  const projectId = rawProjectId as Id<"projects">;
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const enabled = featureStatus?.demoMode === true;
  const videos = useQuery(
    api.videos.list,
    enabled ? { projectId, folderId: null } : "skip",
  );
  const desktopProjects = useQuery(
    api.desktopBrowse.listProjectsForDesktop,
    enabled ? { teamSlug } : "skip",
  );
  const getR2ProxyUrl = useAction(
    api.desktopBrowse.getDownloadUrlForDesktop,
  );

  const project = desktopProjects?.find((row) => row.projectId === projectId);
  const playbackItems = useMemo(() => {
    if (!videos) return [];
    const rows = videos.map((video) => {
      const extension =
        extensionOf(video.s3Key) ?? extensionOf(video.title) ?? "mp4";
      const rawTitle = stripExtension(video.title, extension);
      const rawName = `${rawTitle}.${extension}`;
      return { video, rawName };
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.rawName, (counts.get(row.rawName) ?? 0) + 1);
    }
    const oldestByName = new Map<string, number>();
    for (const row of rows) {
      const current = oldestByName.get(row.rawName);
      if (current === undefined || row.video._creationTime < current) {
        oldestByName.set(row.rawName, row.video._creationTime);
      }
    }

    return rows.map(({ video, rawName }) => {
      const displayName =
        (counts.get(rawName) ?? 0) <= 1 ||
        oldestByName.get(rawName) === video._creationTime
          ? rawName
          : `${rawName} (${String(video._id).slice(-6)})`;
      const mirrored = (video.staticRenditions ?? [])
        .filter(
          (rendition) =>
            rendition.status === "ready" &&
            rendition.ext === "mp4" &&
            Boolean(rendition.r2Key) &&
            Boolean(rendition.filesizeBytes),
        )
        .sort((a, b) => {
          if (a.resolution === "720p") return -1;
          if (b.resolution === "720p") return 1;
          return (a.filesizeBytes ?? 0) - (b.filesizeBytes ?? 0);
        })[0];
      return { video, displayName, mirrored };
    });
  }, [videos]);

  const controllerRef = useRef<PlaybackController | null>(null);
  const controllerCleanupRef = useRef<(() => void) | null>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const timecodeRef = useRef<HTMLOutputElement>(null);
  const scrubRafRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const resumeAfterScrubRef = useRef(false);
  const frameRateRef = useRef(30);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [activeId, setActiveId] = useState<Id<"videos"> | null>(null);
  const [status, setStatus] = useState("Idle");
  const [mode, setMode] = useState<PlaybackMode>("webcodecs");
  const [playing, setPlaying] = useState(false);
  const [metadata, setMetadata] = useState<PlaybackMetadata | null>(null);

  const updateTimeReadout = useCallback((currentTime: number) => {
    if (scrubRef.current) scrubRef.current.value = String(currentTime);
    if (timecodeRef.current) {
      timecodeRef.current.value = formatTimecode(currentTime, frameRateRef.current);
    }
  }, []);

  const handleControllerChange = useCallback(
    (controller: PlaybackController | null) => {
      controllerCleanupRef.current?.();
      controllerCleanupRef.current = null;
      controllerRef.current = controller;
      if (!controller) return;

      const unsubscribers = [
        controller.on("ready", (nextMetadata) => {
          frameRateRef.current = nextMetadata.frameRate || 30;
          setMetadata(nextMetadata);
          setMode(nextMetadata.mode);
          setStatus("Ready");
          updateTimeReadout(controller.currentTime);
        }),
        controller.on("timeupdate", ({ currentTime }) => {
          updateTimeReadout(currentTime);
        }),
        controller.on("play", () => {
          setPlaying(true);
          setStatus("Playing");
        }),
        controller.on("pause", () => {
          setPlaying(false);
          setStatus("Paused");
        }),
        controller.on("waiting", () => setStatus("Reading GOP window")),
        controller.on("ended", () => {
          setPlaying(false);
          setStatus("Ended");
        }),
        controller.on("modechange", ({ mode: nextMode, reason }) => {
          setMode(nextMode);
          if (nextMode === "video") {
            setStatus(reason ? `Video fallback: ${reason}` : "Video fallback");
          }
        }),
        controller.on("error", ({ error }) => setStatus(error.message)),
      ];
      controllerCleanupRef.current = () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    [updateTimeReadout],
  );

  useEffect(
    () => () => {
      controllerCleanupRef.current?.();
      if (scrubRafRef.current !== null) {
        cancelAnimationFrame(scrubRafRef.current);
      }
    },
    [],
  );

  const openProxy = useCallback(
    async (item: (typeof playbackItems)[number]) => {
      if (!project || !item.mirrored?.r2Key || !item.mirrored.filesizeBytes) {
        return;
      }
      setStatus("Signing R2 proxy URL");
      setMetadata(null);
      setPlaying(false);
      try {
        const result = await getR2ProxyUrl({
          teamSlug,
          projectName: project.displayName,
          fileName: item.displayName,
          preferProxy: true,
        });
        if (!result) throw new Error("The project file could not be resolved.");
        if (!result.isProxy) {
          throw new Error("This item resolved to its original, not an R2 proxy.");
        }
        setActiveId(item.video._id);
        setStatus("Reading MP4 index");
        setSource({
          url: result.url,
          contentHash: item.mirrored.r2Key,
          byteLength: result.size,
          mimeType: result.contentType,
        });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Proxy URL failed.");
      }
    },
    [getR2ProxyUrl, project, teamSlug],
  );

  const togglePlayback = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller || !source) return;
    if (controller.paused) await controller.play();
    else controller.pause();
  }, [source]);

  const scheduleSeek = useCallback((time: number) => {
    pendingSeekRef.current = time;
    if (scrubRafRef.current !== null) return;
    scrubRafRef.current = requestAnimationFrame(() => {
      scrubRafRef.current = null;
      const target = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (target === null) return;
      void controllerRef.current?.seek(target).catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") {
          setStatus(error.message);
        }
      });
    });
  }, []);

  const finishScrub = useCallback(async () => {
    const controller = controllerRef.current;
    const input = scrubRef.current;
    if (!controller || !input) return;
    if (scrubRafRef.current !== null) {
      cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = null;
    }
    pendingSeekRef.current = null;
    try {
      await controller.seek(Number(input.value));
      if (resumeAfterScrubRef.current) await controller.play();
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setStatus(error.message);
      }
    } finally {
      resumeAfterScrubRef.current = false;
    }
  }, []);

  const stepFrame = useCallback(async (direction: -1 | 1) => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.pause();
    const frameDuration = 1 / Math.max(1, metadata?.frameRate ?? 30);
    await controller.seek(controller.currentTime + direction * frameDuration);
  }, [metadata?.frameRate]);

  if (featureStatus === undefined) {
    return <div className="p-8 font-mono text-sm">Checking playback flag...</div>;
  }

  if (!enabled) {
    return (
      <div className="flex h-full flex-col">
        <DashboardHeader paths={[{ label: "Playback lab" }]} />
        <main className="grid flex-1 place-items-center p-8">
          <section className="max-w-xl border-2 border-[#1a1a1a] bg-[#f0f0e8] p-8 shadow-[8px_8px_0_0_#1a1a1a]">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-[#C2410C]">
              Demo feature
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight">
              Playback lab is disabled
            </h1>
            <p className="mt-4 max-w-[60ch] text-sm leading-6 text-[#555]">
              Set DEMO_MODE in Convex to exercise browser proxy playback in a
              local or preview deployment.
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f0f0e8] text-[#1a1a1a]">
      <DashboardHeader
        paths={[
          {
            label: project?.rawName ?? "Project",
            href: `/dashboard/${teamSlug}/${projectId}`,
          },
          { label: "Playback lab" },
        ]}
      >
        <span className="border-2 border-[#1a1a1a] bg-[#FFEDD5] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em]">
          Playback lab
        </span>
      </DashboardHeader>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
        <section className="flex min-h-[540px] min-w-0 flex-col border-b-2 border-[#1a1a1a] lg:min-h-0 lg:border-b-0 lg:border-r-2">
          <div className="min-h-0 flex-1 bg-[#11110f] p-3 sm:p-6">
            <PlaybackSurface
              source={source}
              className="h-full max-h-full border-2 border-[#d5d4c8]"
              onControllerChange={handleControllerChange}
              onLoadError={(error) => setStatus(error.message)}
            />
          </div>

          <div className="border-t-2 border-[#1a1a1a] bg-[#f0f0e8] px-4 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => void stepFrame(-1)}
                disabled={!source}
                aria-label="Previous frame"
                title="Previous frame"
              >
                <StepBack />
              </Button>
              <Button
                type="button"
                size="icon"
                onClick={() => void togglePlayback()}
                disabled={!source}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause /> : <Play />}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => void stepFrame(1)}
                disabled={!source}
                aria-label="Next frame"
                title="Next frame"
              >
                <StepForward />
              </Button>

              <input
                ref={scrubRef}
                type="range"
                min={0}
                max={metadata?.duration ?? 0}
                step={1 / Math.max(1, metadata?.frameRate ?? 30)}
                defaultValue={0}
                disabled={!source || !metadata}
                aria-label="Playhead"
                className="h-8 min-w-0 flex-1 cursor-ew-resize accent-[#C2410C] disabled:cursor-not-allowed"
                onPointerDown={() => {
                  const controller = controllerRef.current;
                  resumeAfterScrubRef.current = Boolean(
                    controller && !controller.paused,
                  );
                  controller?.pause();
                }}
                onInput={(event) => {
                  const time = Number(event.currentTarget.value);
                  updateTimeReadout(time);
                  scheduleSeek(time);
                }}
                onPointerUp={() => void finishScrub()}
                onKeyUp={() => void finishScrub()}
              />

              <output
                ref={timecodeRef}
                className="w-[11ch] text-right font-mono text-xs font-bold tabular-nums sm:text-sm"
                aria-live="off"
              >
                00:00:00:00
              </output>
            </div>

            <div className="mt-4 grid gap-2 border-t border-[#aaa99f] pt-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#66665f] sm:grid-cols-3">
              <span>{status}</span>
              <span className="sm:text-center">
                {mode === "webcodecs" ? "WebCodecs canvas" : "HTML video fallback"}
              </span>
              <span className="sm:text-right">
                {metadata
                  ? `${metadata.width}x${metadata.height} at ${metadata.frameRate.toFixed(2)} fps`
                  : "No source loaded"}
              </span>
            </div>
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto bg-[#e8e8e0]">
          <header className="sticky top-0 z-10 border-b-2 border-[#1a1a1a] bg-[#e8e8e0] p-5">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#C2410C]">
              R2 proxy sources
            </p>
            <h1 className="mt-2 text-2xl font-black tracking-tight">
              Browser playback
            </h1>
            <p className="mt-3 text-sm leading-5 text-[#555]">
              Only root-level videos with mirrored MP4 renditions are enabled.
              Range requests read one GOP at a time.
            </p>
          </header>

          <div className="divide-y-2 divide-[#1a1a1a] border-b-2 border-[#1a1a1a]">
            {videos === undefined || desktopProjects === undefined ? (
              <p className="p-5 font-mono text-xs uppercase tracking-[0.14em]">
                Loading project videos...
              </p>
            ) : playbackItems.length === 0 ? (
              <p className="p-5 text-sm leading-6 text-[#555]">
                No root-level videos are available in this project.
              </p>
            ) : (
              playbackItems.map((item) => {
                const available = Boolean(item.mirrored && project);
                const active = activeId === item.video._id;
                return (
                  <button
                    key={item.video._id}
                    type="button"
                    disabled={!available}
                    onClick={() => void openProxy(item)}
                    className={`w-full p-5 text-left transition-colors disabled:cursor-not-allowed disabled:text-[#8b8a82] ${
                      active
                        ? "bg-[#1a1a1a] text-[#f0f0e8]"
                        : "hover:bg-[#FFEDD5]"
                    }`}
                  >
                    <span className="block truncate text-sm font-black">
                      {item.video.title}
                    </span>
                    <span className="mt-2 flex items-center justify-between gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em]">
                      <span>
                        {item.mirrored
                          ? `${item.mirrored.resolution} R2`
                          : "Proxy not mirrored"}
                      </span>
                      <span>
                        {item.mirrored?.filesizeBytes
                          ? formatBytes(item.mirrored.filesizeBytes)
                          : "Unavailable"}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
