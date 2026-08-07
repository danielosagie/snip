import { useAuth } from "@clerk/tanstack-react-start";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  Pause,
  Play,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  PresenceAvatarStack,
  SoftLockWarning,
  TimelinePresenceProvider,
} from "@/components/presence";
import { Button } from "@/components/ui/button";
import {
  nextSequenceClip,
  timelineTimeToClip,
  type PlaybackSource,
  type SequencePlaybackClip,
} from "@/lib/playback";
import { applyTimelineOps } from "@/lib/timeline/operations";
import {
  TIMELINE_CLIP_PROPERTIES,
  type RenderOutputSpec,
  type TimelineDocument,
  type TimelineOp,
} from "@/lib/timeline/types";
import {
  buildRenderOutputSpec,
  exportProgressView,
  type RenderJobProgress,
} from "./exportModel";
import {
  SequencePlaybackSurface,
  type SequencePlaybackHandle,
} from "./SequencePlaybackSurface";
import { TimelineCanvas } from "./TimelineCanvas";
import {
  buildRippleDeleteOps,
  buildSplitOps,
  buildTrimOp,
  editorTimelineDuration,
  getEditorTracks,
  invertTimelineOps,
  materializeTimelineOps,
  sequenceFrameRate,
  timelineRange,
  timelineTime,
  type TimelineOpDraft,
} from "./timelineModel";

type TimelineEditorProps = {
  teamSlug: string;
  projectId: Id<"projects">;
};

type HistoryEntry = {
  label: string;
  undo: TimelineOpDraft[];
  redo: TimelineOpDraft[];
};

type MediaItem = {
  video: Doc<"videos">;
  displayName: string;
  mirrored?: NonNullable<Doc<"videos">["staticRenditions"]>[number];
};

type RenderJobCreateArgs = {
  snapshot: {
    timelineDocId: Id<"timelineDocs">;
    timelineSnapshotId: Id<"timelineSnapshots">;
    branch: string;
    revision: number;
  };
  output: RenderOutputSpec;
  priority?: number;
};

const EXPORT_ENABLED =
  (import.meta.env.VITE_RENDER_EXPORT_ENABLED as string | undefined) === "true";

const timelineDocsApi = {
  list: makeFunctionReference<
    "query",
    { projectId: Id<"projects">; branch?: string },
    Array<{
      _id: Id<"timelineDocs">;
      branch: string;
      revision: number;
      updatedAt: number;
    }>
  >("timelineDocs:list"),
  get: makeFunctionReference<
    "query",
    { timelineDocId: Id<"timelineDocs"> },
    Doc<"timelineDocs"> | null
  >("timelineDocs:get"),
  create: makeFunctionReference<
    "mutation",
    {
      projectId: Id<"projects">;
      branch?: string;
      sequenceId?: string;
      sequenceName?: string;
      versionId?: Id<"projectVersions">;
      sequenceProperties?: Record<string, unknown>;
    },
    Id<"timelineDocs">
  >("timelineDocs:create"),
  applyOps: makeFunctionReference<
    "mutation",
    { timelineDocId: Id<"timelineDocs">; ops: TimelineOp[] },
    { revision: number; appliedOpIds: string[]; updatedAt: number }
  >("timelineDocs:applyOps"),
  commit: makeFunctionReference<
    "mutation",
    { timelineDocId: Id<"timelineDocs">; message: string },
    {
      snapshotId: Id<"timelineSnapshots">;
      branch: string;
      revision: number;
    }
  >("timelineDocs:commit"),
  restore: makeFunctionReference<
    "mutation",
    {
      timelineDocId: Id<"timelineDocs">;
      snapshotId: Id<"timelineSnapshots">;
    },
    {
      revision: number;
      branch: string;
      snapshotId: Id<"timelineSnapshots">;
    }
  >("timelineDocs:restore"),
} as const;

const renderJobsApi = {
  isEnabled: makeFunctionReference<"query", Record<string, never>, boolean>(
    "renderJobs:isEnabled",
  ),
  create: makeFunctionReference<
    "mutation",
    RenderJobCreateArgs,
    Id<"renderJobs">
  >("renderJobs:create"),
  getProgress: makeFunctionReference<
    "query",
    { jobId: Id<"renderJobs"> },
    RenderJobProgress | null
  >("renderJobs:getProgress"),
} as const;

function extensionOf(value: string | undefined): string | null {
  if (!value) return null;
  const index = value.lastIndexOf(".");
  return index >= 0 && index < value.length - 1
    ? value.slice(index + 1).toLowerCase()
    : null;
}

function stripExtension(value: string, extension: string): string {
  const suffix = `.${extension}`;
  return value.toLowerCase().endsWith(suffix)
    ? value.slice(0, -suffix.length)
    : value;
}

function formatTimecode(seconds: number, frameRate: number): string {
  const fps = Math.max(1, Math.round(frameRate));
  const frames = Math.max(0, Math.round(seconds * fps));
  const values = [
    Math.floor(frames / fps / 3600),
    Math.floor(frames / fps / 60) % 60,
    Math.floor(frames / fps) % 60,
    frames % fps,
  ];
  return values.map((value) => String(value).padStart(2, "0")).join(":");
}

function versionTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function TimelineEditor({ teamSlug, projectId }: TimelineEditorProps) {
  const { userId } = useAuth();
  const convex = useConvex();
  const summaries = useQuery(timelineDocsApi.list, {
    projectId,
    branch: "main",
  });
  const timelineDocId = summaries?.[0]?._id;
  const timelineDoc = useQuery(
    timelineDocsApi.get,
    timelineDocId ? { timelineDocId } : "skip",
  );
  const videos = useQuery(api.videos.list, { projectId });
  const desktopProjects = useQuery(api.desktopBrowse.listProjectsForDesktop, {
    teamSlug,
  });
  const versions = useQuery(
    api.timelines.list,
    timelineDoc
      ? { projectId, branch: timelineDoc.branch, limit: 20 }
      : "skip",
  );
  const createTimeline = useMutation(timelineDocsApi.create);
  const applyOpsMutation = useMutation(timelineDocsApi.applyOps);
  const commitVersion = useMutation(timelineDocsApi.commit);
  const restoreVersion = useMutation(timelineDocsApi.restore);
  const createRenderJob = useMutation(renderJobsApi.create);
  const getProxyUrl = useAction(api.desktopBrowse.getDownloadUrlForDesktop);

  const creatingRef = useRef(false);
  const documentRef = useRef<TimelineDocument | null>(null);
  const operationQueueRef = useRef(Promise.resolve());
  const timestampRef = useRef(0);
  const historyRef = useRef<{ undo: HistoryEntry[]; redo: HistoryEntry[] }>({
    undo: [],
    redo: [],
  });
  const playbackRef = useRef<SequencePlaybackHandle>(null);
  const sourcePromisesRef = useRef(new Map<string, Promise<PlaybackSource | null>>());
  const sourceMapRef = useRef(new Map<string, PlaybackSource>());
  const sourceFailureUntilRef = useRef(new Map<string, number>());

  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState("Idle");
  const [editStatus, setEditStatus] = useState("Live");
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [pixelsPerSecond, setPixelsPerSecond] = useState(72);
  const [viewport, setViewport] = useState({ start: 0, duration: 12 });
  const [versionNote, setVersionNote] = useState("");
  const [versionBusy, setVersionBusy] = useState(false);
  const [lockDismissed, setLockDismissed] = useState(false);
  const [sourceVersion, setSourceVersion] = useState(0);
  const [renderJobId, setRenderJobId] = useState<Id<"renderJobs"> | null>(null);
  const [lastExportRequest, setLastExportRequest] =
    useState<RenderJobCreateArgs | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const renderQueueEnabled = useQuery(
    renderJobsApi.isEnabled,
    EXPORT_ENABLED ? {} : "skip",
  );
  const renderProgress = useQuery(
    renderJobsApi.getProgress,
    renderJobId ? { jobId: renderJobId } : "skip",
  );
  const exportView = renderProgress
    ? exportProgressView(renderProgress)
    : null;

  useEffect(() => {
    if (summaries === undefined || summaries.length > 0 || creatingRef.current) {
      return;
    }
    creatingRef.current = true;
    void createTimeline({
      projectId,
      branch: "main",
      sequenceName: "Assembly",
      sequenceProperties: {
        frameRate: { value: 30, rate: 1 },
        width: 1920,
        height: 1080,
        sampleRate: 48_000,
      },
    })
      .catch((error: unknown) => {
        setEditStatus(error instanceof Error ? error.message : "Create failed");
      })
      .finally(() => {
        creatingRef.current = false;
      });
  }, [createTimeline, projectId, summaries]);

  const document = timelineDoc?.document as TimelineDocument | undefined;
  useEffect(() => {
    if (document) documentRef.current = document;
  }, [document]);
  const tracks = useMemo(
    () => (document ? getEditorTracks(document) : []),
    [document],
  );
  const frameRate = document ? sequenceFrameRate(document) : 30;
  const duration = editorTimelineDuration(tracks);
  const project = desktopProjects?.find((row) => row.projectId === projectId);

  const mediaItems = useMemo<MediaItem[]>(() => {
    if (!videos) return [];
    const rows = videos.map((video) => {
      const extension =
        extensionOf(video.s3Key) ?? extensionOf(video.title) ?? "mp4";
      const rawName = `${stripExtension(video.title, extension)}.${extension}`;
      const namespace = String(video.folderId ?? "project-root");
      return { video, rawName, nameKey: `${namespace}\n${rawName}` };
    });
    const counts = new Map<string, number>();
    const oldest = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.nameKey, (counts.get(row.nameKey) ?? 0) + 1);
      oldest.set(
        row.nameKey,
        Math.min(oldest.get(row.nameKey) ?? Infinity, row.video._creationTime),
      );
    }
    return rows.map(({ video, rawName, nameKey }) => ({
      video,
      displayName:
        (counts.get(nameKey) ?? 0) <= 1 ||
        oldest.get(nameKey) === video._creationTime
          ? rawName
          : `${rawName} (${String(video._id).slice(-6)})`,
      mirrored: (video.staticRenditions ?? [])
        .filter(
          (rendition) =>
            rendition.status === "ready" &&
            rendition.ext === "mp4" &&
            Boolean(rendition.r2Key) &&
            Boolean(rendition.filesizeBytes),
        )
        .sort((left, right) => {
          if (left.resolution === "720p") return -1;
          if (right.resolution === "720p") return 1;
          return (left.filesizeBytes ?? 0) - (right.filesizeBytes ?? 0);
        })[0],
    }));
  }, [videos]);
  const mediaById = useMemo(
    () => new Map(mediaItems.map((item) => [String(item.video._id), item])),
    [mediaItems],
  );

  const resolveMedia = useCallback(
    (mediaId: string) => {
      if (sourceMapRef.current.has(mediaId)) {
        return Promise.resolve(sourceMapRef.current.get(mediaId) ?? null);
      }
      if ((sourceFailureUntilRef.current.get(mediaId) ?? 0) > Date.now()) {
        return Promise.resolve(null);
      }
      const pending = sourcePromisesRef.current.get(mediaId);
      if (pending) return pending;
      const item = mediaById.get(mediaId);
      if (!item?.mirrored?.r2Key || !project) return Promise.resolve(null);

      const request = (async () => {
        try {
          const folderPath = item.video.folderId
            ? await convex.query(api.folders.breadcrumbs, {
                folderId: item.video.folderId,
              })
            : [];
          const result = await getProxyUrl({
            teamSlug,
            projectName: project.displayName,
            folderPath:
              folderPath.length > 0
                ? folderPath.map((folder) => folder.name)
                : undefined,
            fileName: item.displayName,
            preferProxy: true,
          });
          if (!result?.isProxy) {
            sourceFailureUntilRef.current.set(mediaId, Date.now() + 30_000);
            return null;
          }
          const source: PlaybackSource = {
            url: result.url,
            contentHash: item.mirrored?.r2Key ?? String(item.video._id),
            byteLength: result.size,
            mimeType: result.contentType,
          };
          sourceMapRef.current.set(mediaId, source);
          sourceFailureUntilRef.current.delete(mediaId);
          setSourceVersion((value) => value + 1);
          return source;
        } catch {
          sourceFailureUntilRef.current.set(mediaId, Date.now() + 30_000);
          return null;
        }
      })().finally(() => sourcePromisesRef.current.delete(mediaId));
      sourcePromisesRef.current.set(mediaId, request);
      return request;
    }, [convex, getProxyUrl, mediaById, project, teamSlug]);

  const sequenceClips = useMemo<SequencePlaybackClip[]>(() => {
    void sourceVersion;
    return tracks
      .filter((track) => track.kind === "video" && !track.muted)
      .flatMap((track) => track.clips)
      .map((clip) => ({
        id: clip.id,
        mediaId: clip.mediaId,
        timelineStart: clip.timelineStart,
        timelineDuration: clip.timelineDuration,
        sourceStart: clip.sourceStart,
        sourceDuration: clip.sourceDuration,
        playbackRate: clip.playbackRate,
        volume: clip.volume,
        source: sourceMapRef.current.get(clip.mediaId) ?? null,
      }));
  }, [sourceVersion, tracks]);

  const activePlaybackClip = timelineTimeToClip(sequenceClips, playhead);
  const nextPlaybackClip = activePlaybackClip
    ? nextSequenceClip(sequenceClips, activePlaybackClip.id)
    : null;
  const activeMediaId = activePlaybackClip?.mediaId;
  const nextMediaId = nextPlaybackClip?.mediaId;

  useEffect(() => {
    const ids = Array.from(
      new Set([activeMediaId, nextMediaId].filter(Boolean) as string[]),
    );
    void Promise.all(ids.map((mediaId) => resolveMedia(mediaId)));
  }, [activeMediaId, nextMediaId, resolveMedia]);

  const refreshHistoryCounts = useCallback(() => {
    setHistoryCounts({
      undo: historyRef.current.undo.length,
      redo: historyRef.current.redo.length,
    });
  }, []);

  const nextTimestamp = useCallback((count: number) => {
    const timestamp = Math.max(Date.now(), timestampRef.current + 1);
    timestampRef.current = timestamp + Math.max(0, count - 1);
    return timestamp;
  }, []);

  const applyDrafts = useCallback(
    (
      drafts: readonly TimelineOpDraft[],
      label: string,
      historyMode: "record" | "undo" | "redo" = "record",
      historyEntry?: HistoryEntry,
    ) => {
      if (drafts.length === 0) return Promise.resolve();
      const task = operationQueueRef.current.then(async () => {
        const current = documentRef.current;
        if (!current || !timelineDocId || !userId) {
          setEditStatus("Auth required");
          return;
        }
        const ops = materializeTimelineOps(
          drafts,
          userId,
          nextTimestamp(drafts.length),
        );
        const inverse = invertTimelineOps(current, ops);
        setEditStatus(label);
        await applyOpsMutation({ timelineDocId, ops });
        documentRef.current = applyTimelineOps(current, ops).document;

        if (historyMode === "record") {
          historyRef.current.undo.push({
            label,
            undo: inverse,
            redo: [...drafts],
          });
          historyRef.current.redo = [];
        } else if (historyMode === "undo" && historyEntry) {
          historyRef.current.redo.push(historyEntry);
        } else if (historyMode === "redo" && historyEntry) {
          historyRef.current.undo.push(historyEntry);
        }
        refreshHistoryCounts();
        setEditStatus("Live");
      });
      const safeTask = task.catch((error: unknown) => {
        if (historyMode === "undo" && historyEntry) {
          historyRef.current.undo.push(historyEntry);
        } else if (historyMode === "redo" && historyEntry) {
          historyRef.current.redo.push(historyEntry);
        }
        refreshHistoryCounts();
        setEditStatus(error instanceof Error ? error.message : "Edit failed");
      });
      operationQueueRef.current = safeTask;
      return safeTask;
    },
    [
      applyOpsMutation,
      nextTimestamp,
      refreshHistoryCounts,
      timelineDocId,
      userId,
    ],
  );

  const undo = useCallback(() => {
    const entry = historyRef.current.undo.pop();
    if (!entry) return;
    refreshHistoryCounts();
    void applyDrafts(entry.undo, "Undoing", "undo", entry);
  }, [applyDrafts, refreshHistoryCounts]);

  const redo = useCallback(() => {
    const entry = historyRef.current.redo.pop();
    if (!entry) return;
    refreshHistoryCounts();
    void applyDrafts(entry.redo, "Redoing", "redo", entry);
  }, [applyDrafts, refreshHistoryCounts]);

  const seek = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(Math.max(0, duration), time));
      setPlayhead(clamped);
      void playbackRef.current?.seek(clamped).catch((error: unknown) => {
        setPlaybackStatus(
          error instanceof Error ? error.message : "Seek failed",
        );
      });
    },
    [duration],
  );

  const togglePlayback = useCallback(() => {
    if (playing) playbackRef.current?.pause();
    else {
      void playbackRef.current?.play().catch((error: unknown) => {
        setPlaybackStatus(
          error instanceof Error ? error.message : "Playback failed",
        );
      });
    }
  }, [playing]);

  const moveSelected = useCallback(
    (delta: number) => {
      const drafts: TimelineOpDraft[] = [];
      for (const track of tracks) {
        for (const clip of track.clips) {
          if (!selectedClipIds.includes(clip.id)) continue;
          drafts.push({
            type: "moveClip",
            clipId: clip.id,
            targetTrackId: track.id,
            timelineStart: timelineTime(
              Math.max(0, clip.timelineStart + delta),
              frameRate,
            ),
          });
        }
      }
      void applyDrafts(drafts, "Nudging");
    },
    [applyDrafts, frameRate, selectedClipIds, tracks],
  );

  const rippleDelete = useCallback(() => {
    if (!document || selectedClipIds.length === 0) return;
    const drafts = buildRippleDeleteOps(document, selectedClipIds);
    setSelectedClipIds([]);
    void applyDrafts(drafts, "Deleting");
  }, [applyDrafts, document, selectedClipIds]);

  const split = useCallback(() => {
    if (!document) return;
    const clip = tracks
      .flatMap((track) => track.clips)
      .find(
        (candidate) =>
          selectedClipIds.includes(candidate.id) &&
          playhead > candidate.timelineStart &&
          playhead < candidate.timelineStart + candidate.timelineDuration,
      );
    if (!clip) {
      setEditStatus("Select clip");
      return;
    }
    const nextId = `clip:${crypto.randomUUID()}`;
    void applyDrafts(
      buildSplitOps(document, clip.id, playhead, nextId),
      "Splitting",
    );
    setSelectedClipIds([nextId]);
  }, [applyDrafts, document, playhead, selectedClipIds, tracks]);

  const addMedia = useCallback(
    (item: MediaItem) => {
      if (!document) return;
      const targetTrack = tracks.find(
        (track) => track.kind === "video" && !track.locked,
      );
      const trackId = targetTrack?.id ?? `track:${crypto.randomUUID()}`;
      const clipId = `clip:${crypto.randomUUID()}`;
      const clipDuration = Math.max(
        1 / frameRate,
        typeof item.video.duration === "number" ? item.video.duration : 5,
      );
      const drafts: TimelineOpDraft[] = [];
      if (!targetTrack) {
        drafts.push({
          type: "addTrack",
          track: {
            id: trackId,
            kind: "video",
            name: "Video 1",
            position: tracks.length,
          },
        });
      }
      drafts.push({
        type: "addClip",
        trackId,
        clip: {
          id: clipId,
          mediaId: item.video._id,
          timelineRange: timelineRange(duration, clipDuration, frameRate),
          sourceRange: timelineRange(0, clipDuration, frameRate),
          properties: {
            [TIMELINE_CLIP_PROPERTIES.name]: item.video.title,
            [TIMELINE_CLIP_PROPERTIES.volume]: 1,
            [TIMELINE_CLIP_PROPERTIES.playbackRate]: 1,
          },
        },
      });
      setSelectedClipIds([clipId]);
      void resolveMedia(String(item.video._id));
      void applyDrafts(drafts, "Adding");
    }, [applyDrafts, document, duration, frameRate, resolveMedia, tracks]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const frames = event.shiftKey ? 10 : 1;
        if (selectedClipIds.length > 0) {
          moveSelected((direction * frames) / frameRate);
        } else {
          seek(playhead + (direction * frames) / frameRate);
        }
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        rippleDelete();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    frameRate,
    moveSelected,
    playhead,
    redo,
    rippleDelete,
    seek,
    selectedClipIds.length,
    togglePlayback,
    undo,
  ]);

  const saveVersion = async () => {
    if (!timelineDocId || !versionNote.trim()) return;
    setVersionBusy(true);
    try {
      await commitVersion({
        timelineDocId,
        message: versionNote.trim(),
      });
      setVersionNote("");
      setEditStatus("Version saved");
    } catch (error) {
      setEditStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setVersionBusy(false);
    }
  };

  const submitExport = async (request: RenderJobCreateArgs) => {
    setLastExportRequest(request);
    const jobId = await createRenderJob(request);
    setRenderJobId(jobId);
    setEditStatus("Export queued");
  };

  const startExport = async () => {
    if (!timelineDocId || !documentRef.current) return;
    setExportBusy(true);
    setExportError(null);
    setRenderJobId(null);
    setLastExportRequest(null);
    try {
      await operationQueueRef.current;
      const currentDocument = documentRef.current;
      if (!currentDocument) throw new Error("Timeline unavailable.");
      const snapshot = await commitVersion({
        timelineDocId,
        message: "Export",
      });
      await submitExport({
        snapshot: {
          timelineDocId,
          timelineSnapshotId: snapshot.snapshotId,
          branch: snapshot.branch,
          revision: snapshot.revision,
        },
        output: buildRenderOutputSpec(currentDocument),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed";
      setExportError(message);
      setEditStatus(message);
    } finally {
      setExportBusy(false);
    }
  };

  const retryExport = async () => {
    if (!lastExportRequest) return;
    setExportBusy(true);
    setExportError(null);
    setRenderJobId(null);
    try {
      await submitExport(lastExportRequest);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Retry failed";
      setExportError(message);
      setEditStatus(message);
    } finally {
      setExportBusy(false);
    }
  };

  const restore = async (snapshotId: Id<"timelineSnapshots">) => {
    if (!timelineDocId) return;
    setVersionBusy(true);
    try {
      await restoreVersion({ timelineDocId, snapshotId });
      historyRef.current = { undo: [], redo: [] };
      refreshHistoryCounts();
      setSelectedClipIds([]);
      setEditStatus("Version restored");
    } catch (error) {
      setEditStatus(error instanceof Error ? error.message : "Restore failed");
    } finally {
      setVersionBusy(false);
    }
  };

  if (!timelineDocId || !timelineDoc || videos === undefined) {
    return (
      <main className="grid min-h-0 flex-1 place-items-center bg-[#f0f0e8] p-8">
        <div className="w-full max-w-lg border-2 border-[#1a1a1a] bg-[#e8e8e0] p-8 shadow-[6px_6px_0_0_#1a1a1a]">
          <p className="font-mono text-xs font-black uppercase tracking-[0.16em] text-[#C2410C]">
            {editStatus === "Live" ? "Loading editor" : editStatus}
          </p>
          <div className="mt-5 h-2 animate-pulse bg-[#1a1a1a]" />
        </div>
      </main>
    );
  }

  const viewportRange = timelineRange(
    viewport.start,
    viewport.duration,
    frameRate,
  );
  const playheadPosition = timelineTime(playhead, frameRate);
  const sequenceName =
    timelineDoc.document.sequence.properties.name?.value ?? "Assembly";
  const exportFailure = exportError ?? exportView?.failureMessage ?? null;
  const exportComplete = renderProgress?.status === "done";
  const showExportPanel = EXPORT_ENABLED
    && (exportBusy || renderJobId !== null || exportError !== null);

  return (
    <TimelinePresenceProvider
      timelineDocId={timelineDocId}
      playheadPosition={playheadPosition}
      selectedClipIds={selectedClipIds}
      viewportRange={viewportRange}
      sequenceId={timelineDoc.document.sequence.id}
    >
      <main className="flex min-h-0 flex-1 flex-col bg-[#f0f0e8] text-[#1a1a1a]">
        {!lockDismissed ? (
          <SoftLockWarning
            target={{
              kind: "sequence",
              sequenceId: timelineDoc.document.sequence.id,
            }}
            onOpenAnyway={() => setLockDismissed(true)}
            className="border-x-0 border-t-0"
          />
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col xl:grid xl:grid-cols-[220px_minmax(480px,1fr)_240px]">
          <aside className="order-2 max-h-52 overflow-y-auto border-t-2 border-[#1a1a1a] bg-[#e8e8e0] xl:order-1 xl:max-h-none xl:border-r-2 xl:border-t-0">
            <div className="sticky top-0 z-10 border-b-2 border-[#1a1a1a] bg-[#e8e8e0] p-4">
              <p className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-[#C2410C]">
                Project media
              </p>
              <p className="mt-1 text-xl font-black tracking-tight">
                {mediaItems.length} files
              </p>
            </div>
            <div className="divide-y-2 divide-[#1a1a1a]">
              {mediaItems.length === 0 ? (
                <p className="p-4 font-mono text-xs font-bold uppercase text-[#66665f]">
                  No media
                </p>
              ) : (
                mediaItems.map((item) => (
                  <div
                    key={item.video._id}
                    className="p-3 hover:bg-[#FFEDD5]"
                    onPointerEnter={() => void resolveMedia(String(item.video._id))}
                  >
                    <p className="truncate text-xs font-black">{item.video.title}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="font-mono text-[8px] font-bold uppercase text-[#66665f]">
                        {item.mirrored ? "Proxy ready" : "Proxy pending"}
                      </span>
                      <button
                        type="button"
                        onClick={() => addMedia(item)}
                        className="border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2 py-1 text-[9px] font-black uppercase shadow-[2px_2px_0_0_#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8]"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <section className="order-1 flex min-h-[640px] min-w-0 flex-col xl:order-2 xl:min-h-0">
            <div className="flex flex-wrap items-center gap-2 border-b-2 border-[#1a1a1a] bg-[#f0f0e8] p-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={undo}
                disabled={historyCounts.undo === 0}
                aria-label="Undo"
              >
                <Undo2 /> Undo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={redo}
                disabled={historyCounts.redo === 0}
                aria-label="Redo"
              >
                <Redo2 /> Redo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={split}
                disabled={selectedClipIds.length !== 1}
              >
                <Scissors /> Split
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={rippleDelete}
                disabled={selectedClipIds.length === 0}
              >
                <Trash2 /> Ripple
              </Button>

              <div className="ml-auto flex items-center gap-2">
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[#66665f]">
                  {editStatus}
                </span>
                <PresenceAvatarStack />
                {EXPORT_ENABLED ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      renderQueueEnabled !== true
                      || exportBusy
                      || exportView?.active === true
                    }
                    title={
                      renderQueueEnabled === false
                        ? "Render queue disabled"
                        : renderQueueEnabled === undefined
                          ? "Checking render queue"
                          : undefined
                    }
                    onClick={() => void startExport()}
                  >
                    {exportBusy ? "Queueing" : "Export"}
                  </Button>
                ) : null}
              </div>
            </div>

            {showExportPanel ? (
              <section
                aria-label="Export progress"
                className="border-b-2 border-[#1a1a1a] bg-[#FFEDD5] px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <div>
                    <p className="font-mono text-[8px] font-black uppercase tracking-[0.14em] text-[#66665f]">
                      Phase
                    </p>
                    <p className="font-mono text-xs font-black uppercase">
                      {exportBusy ? "queueing" : exportView?.phase ?? "queued"}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[8px] font-black uppercase tracking-[0.14em] text-[#66665f]">
                      Done
                    </p>
                    <p className="font-mono text-xs font-black tabular-nums">
                      {exportView?.percent ?? 0}%
                    </p>
                  </div>
                  {exportComplete ? (
                    <div>
                      <p className="font-mono text-[8px] font-black uppercase tracking-[0.14em] text-[#66665f]">
                        Cache
                      </p>
                      <p className="font-mono text-xs font-black tabular-nums">
                        {exportView?.streamCopyPercent === null
                          ? "Unavailable"
                          : `${exportView?.streamCopyPercent ?? 0}% copy`}
                      </p>
                    </div>
                  ) : null}
                  <div className="min-w-36 flex-1">
                    <div
                      className="h-2 border border-[#1a1a1a] bg-[#f0f0e8]"
                      role="progressbar"
                      aria-label="Render progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={exportView?.percent ?? 0}
                    >
                      <div
                        className="h-full bg-[#C2410C] transition-[width] duration-200 motion-reduce:transition-none"
                        style={{ width: `${exportView?.percent ?? 0}%` }}
                      />
                    </div>
                    {renderProgress?.message && !exportFailure ? (
                      <p className="mt-1 truncate font-mono text-[9px] font-bold">
                        {renderProgress.message}
                      </p>
                    ) : null}
                  </div>
                  {exportFailure ? (
                    <p className="w-full text-pretty font-mono text-[10px] font-black text-[#9A3412]">
                      {exportFailure}
                    </p>
                  ) : null}
                  {(renderProgress?.status === "failed" || exportError)
                    && lastExportRequest ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={exportBusy || renderQueueEnabled !== true}
                      onClick={() => void retryExport()}
                    >
                      Retry
                    </Button>
                  ) : null}
                  {exportComplete ? (
                    <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
                      <dl className="grid min-w-0 gap-1 font-mono text-[8px] font-bold sm:grid-cols-2 sm:gap-3">
                        <div className="min-w-0">
                          <dt className="uppercase text-[#66665f]">Output</dt>
                          <dd
                            className="max-w-48 truncate"
                            title={renderProgress.outputObjectKey ?? undefined}
                          >
                            {renderProgress.outputObjectKey ?? "Ready"}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="uppercase text-[#66665f]">Manifest</dt>
                          <dd
                            className="max-w-48 truncate"
                            title={renderProgress.manifestObjectKey ?? undefined}
                          >
                            {renderProgress.manifestObjectKey ?? "Ready"}
                          </dd>
                        </div>
                      </dl>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled
                        title="Needs an authenticated render output URL action"
                      >
                        Copy URL
                      </Button>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(250px,44%)_minmax(300px,1fr)]">
              <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_170px] border-b-2 border-[#1a1a1a] bg-[#11110f]">
                <div className="grid min-h-0 place-items-center p-3 sm:p-5">
                  <SequencePlaybackSurface
                    ref={playbackRef}
                    clips={sequenceClips}
                    className="h-full max-h-full border-2 border-[#d5d4c8]"
                    onTimeUpdate={setPlayhead}
                    onPlayingChange={setPlaying}
                    onStatusChange={setPlaybackStatus}
                  />
                </div>
                <div className="border-l-2 border-[#d5d4c8] bg-[#1a1a1a] p-4 text-[#f0f0e8]">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-[#FDBA74]">
                    {String(sequenceName)}
                  </p>
                  <output className="mt-3 block font-mono text-sm font-black tabular-nums">
                    {formatTimecode(playhead, frameRate)}
                  </output>
                  <button
                    type="button"
                    onClick={togglePlayback}
                    className="mt-4 grid size-12 place-items-center border-2 border-[#f0f0e8] bg-[#C2410C] shadow-[4px_4px_0_0_#f0f0e8] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0_0_#f0f0e8]"
                    aria-label={playing ? "Pause" : "Play"}
                  >
                    {playing ? <Pause /> : <Play />}
                  </button>
                  <p className="mt-5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#aaa99f]">
                    {playbackStatus}
                  </p>
                  <p className="mt-2 font-mono text-[9px] font-bold uppercase text-[#aaa99f]">
                    Rev {timelineDoc.revision}
                  </p>
                </div>
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="flex h-10 items-center gap-2 border-b-2 border-[#1a1a1a] bg-[#f0f0e8] px-3">
                  <button
                    type="button"
                    onClick={() =>
                      setPixelsPerSecond((value) => Math.max(18, value - 18))
                    }
                    className="grid size-6 place-items-center border border-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8]"
                    aria-label="Zoom out"
                    title="Zoom out"
                  >
                    <ZoomOut className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPixelsPerSecond((value) => Math.min(240, value + 18))
                    }
                    className="grid size-6 place-items-center border border-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8]"
                    aria-label="Zoom in"
                    title="Zoom in"
                  >
                    <ZoomIn className="size-3" />
                  </button>
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#66665f]">
                    {Math.round(pixelsPerSecond)} px/s
                  </span>
                  <span className="ml-auto font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#66665f]">
                    {selectedClipIds.length} selected
                  </span>
                </div>
                <TimelineCanvas
                  tracks={tracks}
                  duration={duration}
                  frameRate={frameRate}
                  pixelsPerSecond={pixelsPerSecond}
                  playhead={playhead}
                  selectedClipIds={selectedClipIds}
                  viewportRange={viewportRange}
                  onViewportChange={(start, viewportDuration) =>
                    setViewport({ start, duration: viewportDuration })
                  }
                  onPlayheadChange={seek}
                  onSelectionChange={setSelectedClipIds}
                  onResolveMedia={(mediaId) => void resolveMedia(mediaId)}
                  onMoveClip={(clipId, targetTrackId, start) => {
                    const sourceTrack = tracks.find((track) =>
                      track.clips.some((clip) => clip.id === clipId),
                    );
                    const targetTrack = tracks.find(
                      (track) => track.id === targetTrackId,
                    );
                    const safeTrackId =
                      sourceTrack && targetTrack?.kind === sourceTrack.kind
                        ? targetTrackId
                        : sourceTrack?.id ?? targetTrackId;
                    void applyDrafts(
                      [
                        {
                          type: "moveClip",
                          clipId,
                          targetTrackId: safeTrackId,
                          timelineStart: timelineTime(start, frameRate),
                        },
                      ],
                      "Moving",
                    );
                  }}
                  onTrimClip={(clipId, edge, position) => {
                    if (!document) return;
                    const draft = buildTrimOp(document, clipId, edge, position);
                    if (draft) void applyDrafts([draft], "Trimming");
                  }}
                  onGainChange={(clipId, volume) =>
                    void applyDrafts(
                      [
                        {
                          type: "setClipProperty",
                          clipId,
                          property: TIMELINE_CLIP_PROPERTIES.volume,
                          value: volume,
                        },
                      ],
                      "Gain",
                    )
                  }
                  onReorderTrack={(trackId, direction) => {
                    const index = tracks.findIndex((track) => track.id === trackId);
                    const adjacent = tracks[index + direction];
                    const track = tracks[index];
                    if (!track || !adjacent) return;
                    void applyDrafts(
                      [
                        {
                          type: "setTrackProperty",
                          trackId: track.id,
                          property: "position",
                          value: adjacent.position,
                        },
                        {
                          type: "setTrackProperty",
                          trackId: adjacent.id,
                          property: "position",
                          value: track.position,
                        },
                      ],
                      "Reordering",
                    );
                  }}
                />
              </div>
            </div>
          </section>

          <aside className="order-3 max-h-56 overflow-y-auto border-t-2 border-[#1a1a1a] bg-[#f0f0e8] xl:max-h-none xl:border-l-2 xl:border-t-0">
            <div className="sticky top-0 z-10 border-b-2 border-[#1a1a1a] bg-[#f0f0e8] p-4">
              <p className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-[#C2410C]">
                Cut versions
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  value={versionNote}
                  onChange={(event) => setVersionNote(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveVersion();
                  }}
                  placeholder="Version note"
                  maxLength={500}
                  className="h-8 min-w-0 flex-1 border-2 border-[#1a1a1a] bg-[#e8e8e0] px-2 text-xs font-bold outline-none focus:bg-[#FFEDD5]"
                />
                <button
                  type="button"
                  disabled={!versionNote.trim() || versionBusy}
                  onClick={() => void saveVersion()}
                  className="border-2 border-[#1a1a1a] bg-[#1a1a1a] px-2 text-[9px] font-black uppercase text-[#f0f0e8] disabled:opacity-35"
                >
                  Save
                </button>
              </div>
            </div>
            <div className="divide-y-2 divide-[#1a1a1a]">
              {versions === undefined ? (
                <p className="p-4 font-mono text-xs font-bold uppercase">
                  Loading versions
                </p>
              ) : versions.length === 0 ? (
                <p className="p-4 font-mono text-xs font-bold uppercase text-[#66665f]">
                  No versions
                </p>
              ) : (
                versions.map((version) => (
                  <div key={version._id} className="p-4">
                    <p className="break-words text-xs font-black">
                      {version.message}
                    </p>
                    <p className="mt-1 font-mono text-[8px] font-bold uppercase text-[#66665f]">
                      {version.createdByName}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="font-mono text-[8px] font-bold text-[#66665f]">
                        {versionTime(version._creationTime)}
                      </span>
                      <button
                        type="button"
                        disabled={
                          versionBusy || timelineDoc.headSnapshotId === version._id
                        }
                        onClick={() => void restore(version._id)}
                        className="border border-[#1a1a1a] px-2 py-1 text-[8px] font-black uppercase hover:bg-[#1a1a1a] hover:text-[#f0f0e8] disabled:opacity-30"
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </main>
    </TimelinePresenceProvider>
  );
}
