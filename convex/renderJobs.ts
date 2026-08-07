import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireProjectAccess, requireUser } from "./auth";
import { generateOpaqueToken } from "./security";
import { parseTimelineDocumentJson } from "../src/lib/timeline/operations";
import {
  TIMELINE_CLIP_PROPERTIES,
  TIMELINE_TRACK_PROPERTIES,
  type RenderOutputSpec,
  type RenderWorkerSpec,
  type TimelineDocument,
  type TimelinePropertyValue,
  type TimelineTime,
} from "../src/lib/timeline/types";
import { renderUsageForCompletion } from "./usageMeters";

const DEFAULT_PRIORITY = 100;
const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 5 * 60_000;
const MAX_WORKER_ID_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_FAILURE_DETAIL_FIELDS = 32;
const ACTIVE_STATUSES = ["claimed", "running", "uploading"] as const;

const snapshotValidator = v.object({
  timelineDocId: v.id("timelineDocs"),
  timelineSnapshotId: v.id("timelineSnapshots"),
  branch: v.string(),
  revision: v.number(),
});

const outputValidator = v.object({
  container: v.union(v.literal("mp4"), v.literal("mov"), v.literal("webm")),
  videoCodec: v.union(
    v.literal("h264"),
    v.literal("hevc"),
    v.literal("prores"),
    v.literal("vp9"),
    v.literal("av1"),
  ),
  audioCodec: v.union(
    v.literal("aac"),
    v.literal("pcm"),
    v.literal("opus"),
    v.literal("none"),
  ),
  width: v.number(),
  height: v.number(),
  frameRate: v.object({ value: v.number(), rate: v.number() }),
});

const phaseValidator = v.union(
  v.literal("claimed"),
  v.literal("downloading"),
  v.literal("probing"),
  v.literal("rendering"),
  v.literal("uploading"),
  v.literal("complete"),
);

const cacheResultValidator = v.object({
  hits: v.number(),
  misses: v.number(),
  totalSegments: v.number(),
  hitRate: v.number(),
  hitBytes: v.number(),
  missBytes: v.number(),
  totalBytes: v.number(),
  byteHitRate: v.number(),
  hitDurationSeconds: v.number(),
  missDurationSeconds: v.number(),
  totalDurationSeconds: v.number(),
  streamCopyPercent: v.number(),
});

const claimIdentityValidator = {
  teamId: v.id("teams"),
  jobId: v.id("renderJobs"),
  workerId: v.string(),
  claimToken: v.string(),
};

type ActiveStatus = (typeof ACTIVE_STATUSES)[number];
type QueueCandidate = Pick<
  Doc<"renderJobs">,
  "priority" | "queuedAt" | "status" | "leaseExpiresAt"
>;

export function isRenderQueueEnabled(
  value = process.env.RENDER_QUEUE_ENABLED,
): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export function isActiveRenderStatus(status: string): status is ActiveStatus {
  return ACTIVE_STATUSES.includes(status as ActiveStatus);
}

/** Shared by the mutation and state-machine tests. */
export function isClaimableRenderJob(job: QueueCandidate, now: number): boolean {
  return job.status === "queued"
    || (isActiveRenderStatus(job.status) && (job.leaseExpiresAt ?? 0) <= now);
}

/** Lower priority values and then older queue timestamps win. */
export function compareQueueCandidates(left: QueueCandidate, right: QueueCandidate): number {
  return (left.priority ?? DEFAULT_PRIORITY) - (right.priority ?? DEFAULT_PRIORITY)
    || left.queuedAt - right.queuedAt;
}

export function ownsRenderClaim(
  job: Pick<Doc<"renderJobs">, "status" | "claimedBy" | "claimToken">,
  workerId: string,
  claimToken: string,
): boolean {
  return isActiveRenderStatus(job.status)
    && job.claimedBy === workerId
    && job.claimToken === claimToken;
}

export function statusForPhase(phase: string): ActiveStatus {
  if (phase === "claimed") return "claimed";
  if (phase === "uploading") return "uploading";
  return "running";
}

export function heartbeatDisposition(
  job: Pick<
    Doc<"renderJobs">,
    "status" | "claimedBy" | "claimToken" | "cancellationRequestedAt"
  >,
  workerId: string,
  claimToken: string,
): "accepted" | "cancelled" | "lease_lost" {
  if (!ownsRenderClaim(job, workerId, claimToken)) return "lease_lost";
  return job.cancellationRequestedAt === undefined ? "accepted" : "cancelled";
}

function boundedLeaseMs(value: number): number {
  if (!Number.isFinite(value)) throw new Error("leaseMs must be finite.");
  return Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, Math.round(value)));
}

function normalizedWorkerId(value: string): string {
  const result = value.trim();
  if (!result || result.length > MAX_WORKER_ID_LENGTH || /[\r\n]/.test(result)) {
    throw new Error(`workerId must contain 1 to ${MAX_WORKER_ID_LENGTH} safe characters.`);
  }
  return result;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) throw new Error("progress must be finite.");
  return Math.min(1, Math.max(0, value));
}

function assertCacheResult(cache: {
  hits: number;
  misses: number;
  totalSegments: number;
  hitRate: number;
  hitBytes: number;
  missBytes: number;
  totalBytes: number;
  byteHitRate: number;
  hitDurationSeconds: number;
  missDurationSeconds: number;
  totalDurationSeconds: number;
  streamCopyPercent: number;
}): void {
  const integers = [
    cache.hits,
    cache.misses,
    cache.totalSegments,
    cache.hitBytes,
    cache.missBytes,
    cache.totalBytes,
  ];
  if (integers.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Render cache counts and byte totals must be non-negative safe integers.");
  }
  if (cache.hits + cache.misses !== cache.totalSegments) {
    throw new Error("Render cache segment counts are inconsistent.");
  }
  if (cache.hitBytes + cache.missBytes !== cache.totalBytes) {
    throw new Error("Render cache byte totals are inconsistent.");
  }
  if (
    !Number.isFinite(cache.hitRate)
    || !Number.isFinite(cache.byteHitRate)
    || cache.hitRate < 0
    || cache.hitRate > 1
    || cache.byteHitRate < 0
    || cache.byteHitRate > 1
    || !Number.isFinite(cache.streamCopyPercent)
    || cache.streamCopyPercent < 0
    || cache.streamCopyPercent > 100
  ) {
    throw new Error("Render cache rates are outside their valid range.");
  }
  renderUsageForCompletion(cache);
  if (
    !Number.isFinite(cache.missDurationSeconds)
    || cache.missDurationSeconds < 0
    || Math.abs(
      cache.hitDurationSeconds + cache.missDurationSeconds - cache.totalDurationSeconds,
    ) > 0.001
  ) {
    throw new Error("Render cache duration totals are inconsistent.");
  }
}

function optionalMessage(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, MAX_MESSAGE_LENGTH) : undefined;
}

function propertyValue(
  properties: Record<string, { value: TimelinePropertyValue }>,
  property: string,
): TimelinePropertyValue | undefined {
  return properties[property]?.value;
}

function seconds(value: TimelinePropertyValue | undefined, label: string): number {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !("value" in value)
    || !("rate" in value)
  ) {
    throw new Error(`${label} is missing a timeline time.`);
  }
  const time = value as TimelineTime;
  if (!Number.isFinite(time.value) || !Number.isFinite(time.rate) || time.rate <= 0) {
    throw new Error(`${label} is not a valid timeline time.`);
  }
  return time.value / time.rate;
}

function finiteProperty(
  properties: Record<string, { value: TimelinePropertyValue }>,
  name: string,
  fallback: number,
): number {
  const value = propertyValue(properties, name);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanProperty(
  properties: Record<string, { value: TimelinePropertyValue }>,
  name: string,
  fallback: boolean,
): boolean {
  const value = propertyValue(properties, name);
  return typeof value === "boolean" ? value : fallback;
}

function assertOutput(output: RenderOutputSpec): number {
  if (
    output.container !== "mp4"
    || (output.videoCodec !== "h264" && output.videoCodec !== "hevc")
    || output.audioCodec !== "aac"
  ) {
    throw new Error("The first render adapter supports MP4 with H.264 or HEVC video and AAC audio only.");
  }
  if (
    !Number.isInteger(output.width)
    || !Number.isInteger(output.height)
    || output.width <= 0
    || output.height <= 0
    || output.width % 2 !== 0
    || output.height % 2 !== 0
  ) {
    throw new Error("Render width and height must be positive even integers.");
  }
  if (
    !Number.isFinite(output.frameRate.value)
    || !Number.isFinite(output.frameRate.rate)
    || output.frameRate.value <= 0
    || output.frameRate.rate <= 0
  ) {
    throw new Error("Render frameRate must contain positive finite value and rate fields.");
  }
  const fps = output.frameRate.value / output.frameRate.rate;
  if (fps < 1 || fps > 120) throw new Error("Render frame rate must be between 1 and 120 fps.");
  return fps;
}

function parseSnapshotMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function resolveWorkerSpec(
  ctx: MutationCtx,
  document: TimelineDocument,
  projectId: Id<"projects">,
  teamId: Id<"teams">,
  output: RenderOutputSpec,
): Promise<RenderWorkerSpec> {
  const fps = assertOutput(output);
  const activeTracks = Object.values(document.sequence.tracks)
    .filter((track) => !track.removed.value)
    .filter((track) => booleanProperty(track.properties, TIMELINE_TRACK_PROPERTIES.enabled, true));
  const activeAudioClips = activeTracks
    .filter((track) => propertyValue(track.properties, TIMELINE_TRACK_PROPERTIES.kind) === "audio")
    .flatMap((track) => Object.values(track.clips))
    .filter((clip) => !clip.removed.value)
    .filter((clip) => booleanProperty(clip.properties, TIMELINE_CLIP_PROPERTIES.enabled, true));
  if (activeAudioClips.length > 0) {
    throw new Error("The first render adapter does not support separate audio tracks.");
  }

  const videoTracks = activeTracks
    .filter((track) => propertyValue(track.properties, TIMELINE_TRACK_PROPERTIES.kind) === "video")
    .map((track) => ({
      track,
      clips: Object.values(track.clips)
        .filter((clip) => !clip.removed.value && clip.trackId.value === track.id)
        .filter((clip) => booleanProperty(clip.properties, TIMELINE_CLIP_PROPERTIES.enabled, true)),
    }))
    .filter(({ clips }) => clips.length > 0);
  if (videoTracks.length !== 1) {
    throw new Error("The first render adapter requires exactly one active video track with clips.");
  }

  const { track, clips } = videoTracks[0];
  const ordered = clips
    .map((clip) => ({
      clip,
      timelineStart: seconds(
        propertyValue(clip.properties, TIMELINE_CLIP_PROPERTIES.timelineStart),
        `Clip ${clip.id} timelineStart`,
      ),
      timelineDuration: seconds(
        propertyValue(clip.properties, TIMELINE_CLIP_PROPERTIES.timelineDuration),
        `Clip ${clip.id} timelineDuration`,
      ),
      sourceStart: seconds(
        propertyValue(clip.properties, TIMELINE_CLIP_PROPERTIES.sourceStart),
        `Clip ${clip.id} sourceStart`,
      ),
      sourceDuration: seconds(
        propertyValue(clip.properties, TIMELINE_CLIP_PROPERTIES.sourceDuration),
        `Clip ${clip.id} sourceDuration`,
      ),
    }))
    .sort((left, right) => left.timelineStart - right.timelineStart || left.clip.id.localeCompare(right.clip.id));

  const toleranceSeconds = 0.5 / fps;
  let cursor = 0;
  for (const entry of ordered) {
    if (entry.timelineStart < -toleranceSeconds || entry.sourceStart < 0) {
      throw new Error(`Clip ${entry.clip.id} starts before zero.`);
    }
    if (entry.timelineDuration <= 0 || entry.sourceDuration <= 0) {
      throw new Error(`Clip ${entry.clip.id} must have a positive duration.`);
    }
    if (Math.abs(entry.timelineStart - cursor) > toleranceSeconds) {
      throw new Error("The first render adapter does not support timeline gaps or overlapping clips.");
    }
    const playbackRate = finiteProperty(
      entry.clip.properties,
      TIMELINE_CLIP_PROPERTIES.playbackRate,
      1,
    );
    if (Math.abs(playbackRate - 1) > 0.000_001) {
      throw new Error("The first render adapter does not support clip speed changes.");
    }
    if (Math.abs(entry.timelineDuration - entry.sourceDuration) > toleranceSeconds) {
      throw new Error("Timeline and source durations must match for the first render adapter.");
    }
    cursor = entry.timelineStart + entry.timelineDuration;
  }

  const mediaIds = Array.from(new Set(ordered.map(({ clip }) => clip.mediaId.value)));
  const media = new Map<string, Doc<"videos">>();
  await Promise.all(mediaIds.map(async (rawId) => {
    const videoId = ctx.db.normalizeId("videos", rawId);
    if (!videoId) throw new Error(`Clip media ${rawId} is invalid.`);
    const video = await ctx.db.get(videoId);
    if (!video || video.projectId !== projectId || video.deletedAt) {
      throw new Error(`Clip media ${rawId} is not available in this project.`);
    }
    if (!video.s3Key) throw new Error(`Clip media ${rawId} has no source object.`);
    media.set(rawId, video);
  }));

  const renderKey = generateOpaqueToken(24);
  const prefix = `render-exports/${teamId}/${projectId}/${renderKey}`;
  const trackMuted = booleanProperty(track.properties, TIMELINE_TRACK_PROPERTIES.muted, false);
  return {
    segments: ordered.map(({ clip, sourceStart, sourceDuration }) => {
      const video = media.get(clip.mediaId.value);
      if (!video?.s3Key) throw new Error(`Clip media ${clip.mediaId.value} lost its source object.`);
      const brightness = finiteProperty(clip.properties, "brightness", 0);
      const contrast = finiteProperty(clip.properties, "contrast", 1);
      const saturation = finiteProperty(clip.properties, "saturation", 1);
      const volume = finiteProperty(clip.properties, TIMELINE_CLIP_PROPERTIES.volume, 1);
      if (brightness < -1 || brightness > 1) throw new Error("Clip brightness must be between -1 and 1.");
      if (contrast < 0 || contrast > 3) throw new Error("Clip contrast must be between 0 and 3.");
      if (saturation < 0 || saturation > 3) throw new Error("Clip saturation must be between 0 and 3.");
      if (volume < 0 || volume > 10) throw new Error("Clip volume must be between 0 and 10.");
      return {
        sourceKey: video.s3Key,
        // A3 has no checksum/object-version field on videos. Upload and overwrite
        // paths are versioned by timestamp, so the object key is the strongest
        // immutable identity available until that schema seam is added.
        sourceContentId: `object-key:${video.s3Key}`,
        inSeconds: sourceStart,
        outSeconds: sourceStart + sourceDuration,
        effects: {
          brightness,
          contrast,
          saturation,
          volume,
          muted: trackMuted,
        },
      };
    }),
    target: {
      codec: output.videoCodec === "hevc" ? "hevc" : "h264",
      container: "mp4",
      width: output.width,
      height: output.height,
      fps,
      pixelFormat: "yuv420p",
      crf: 20,
      preset: "fast",
      audioCodec: "aac",
      audioBitrateKbps: 192,
      audioSampleRate: 48_000,
      audioChannels: 2,
    },
    outputKey: `${prefix}.mp4`,
    manifestKey: `${prefix}.manifest.json`,
  };
}

function cancellationPatch(
  now: number,
  requestedBy: string | undefined,
  message = "Render cancelled.",
) {
  return {
    status: "failed" as const,
    failedAt: now,
    error: message,
    failure: {
      code: "CANCELLED",
      retryable: false,
      message,
    },
    cancellationRequestedAt: now,
    cancellationRequestedByClerkId: requestedBy,
    claimedBy: undefined,
    claimToken: undefined,
    leaseExpiresAt: undefined,
    heartbeatAt: undefined,
    workerMessage: message,
  };
}

export const isEnabled = query({
  args: {},
  handler: async () => isRenderQueueEnabled(),
});

/**
 * Public export entry point. This is feature-gated so an unconfigured app
 * continues to boot and no work is queued accidentally.
 */
export const create = mutation({
  args: {
    snapshot: snapshotValidator,
    output: outputValidator,
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!isRenderQueueEnabled()) {
      throw new Error("Render queue is not enabled for this deployment.");
    }
    const [timelineDoc, snapshot] = await Promise.all([
      ctx.db.get(args.snapshot.timelineDocId),
      ctx.db.get(args.snapshot.timelineSnapshotId),
    ]);
    if (!timelineDoc) throw new Error("Timeline document not found.");
    const { user, project } = await requireProjectAccess(ctx, timelineDoc.projectId, "member");
    if (project.teamId !== timelineDoc.teamId) {
      throw new Error("Timeline document workspace does not match its project.");
    }
    if (
      !snapshot
      || snapshot.projectId !== timelineDoc.projectId
      || snapshot.teamId !== timelineDoc.teamId
    ) {
      throw new Error("Timeline snapshot was not found in this project.");
    }
    const branch = args.snapshot.branch.trim();
    if (!branch || branch !== timelineDoc.branch || branch !== snapshot.branch) {
      throw new Error("Snapshot branch does not match the timeline document.");
    }
    if (!Number.isSafeInteger(args.snapshot.revision) || args.snapshot.revision < 0) {
      throw new Error("Snapshot revision must be a non-negative integer.");
    }
    const metadata = parseSnapshotMetadata(snapshot.metadata);
    if (
      metadata.format !== "snip.timeline.document"
      || metadata.timelineDocId !== String(timelineDoc._id)
      || metadata.revision !== args.snapshot.revision
    ) {
      throw new Error("Snapshot reference does not identify a committed timeline revision.");
    }
    const priority = args.priority ?? DEFAULT_PRIORITY;
    if (!Number.isInteger(priority) || priority < 0 || priority > 1_000) {
      throw new Error("priority must be an integer between 0 and 1000.");
    }
    const team = await ctx.db.get(project.teamId);
    if (!team) throw new Error("Workspace team not found.");
    const document = parseTimelineDocumentJson(snapshot.cuts);
    const workerSpec = await resolveWorkerSpec(
      ctx,
      document,
      timelineDoc.projectId,
      timelineDoc.teamId,
      args.output,
    );
    const now = Date.now();
    return await ctx.db.insert("renderJobs", {
      teamId: timelineDoc.teamId,
      projectId: timelineDoc.projectId,
      priority,
      requesterClerkId: user.subject,
      workspaceOwnerClerkId: team.ownerClerkId,
      status: "queued",
      snapshot: args.snapshot,
      output: args.output,
      workerSpec,
      createdAt: now,
      queuedAt: now,
      progress: 0,
      workerMessage: "Queued for render.",
      attemptCount: 0,
    });
  },
});

/** Minimal reactive shape for Agent B's progress UI. */
export const getProgress = query({
  args: { jobId: v.id("renderJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    await requireProjectAccess(ctx, job.projectId, "viewer");
    return {
      jobId: job._id,
      status: job.status,
      phase: job.phase ?? null,
      progress: job.progress ?? 0,
      message: job.workerMessage ?? null,
      cancellationRequestedAt: job.cancellationRequestedAt ?? null,
      outputObjectKey: job.outputObjectKey ?? null,
      manifestObjectKey: job.manifestObjectKey ?? null,
      outputBytes: job.outputBytes ?? null,
      failure: job.failure ?? null,
      createdAt: job.createdAt,
      queuedAt: job.queuedAt,
      completedAt: job.completedAt ?? null,
      failedAt: job.failedAt ?? null,
    };
  },
});

/** Requester-only cancellation. A3 has no cancelled status, so cancellation is a typed failure. */
export const cancel = mutation({
  args: { jobId: v.id("renderJobs") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Render job not found.");
    if (!job.requesterClerkId || job.requesterClerkId !== user.subject) {
      throw new Error("Only the render requester can cancel this job.");
    }
    if (job.status === "done" || job.status === "failed") return job.status;
    const now = Date.now();
    if (job.status === "queued") {
      await ctx.db.patch(job._id, cancellationPatch(now, user.subject));
      return "failed" as const;
    }
    await ctx.db.patch(job._id, {
      cancellationRequestedAt: job.cancellationRequestedAt ?? now,
      cancellationRequestedByClerkId: user.subject,
      workerMessage: "Cancellation requested.",
    });
    return job.status;
  },
});

async function expiredForStatus(
  ctx: MutationCtx,
  teamId: Id<"teams">,
  status: ActiveStatus,
  now: number,
) {
  return await ctx.db
    .query("renderJobs")
    .withIndex("by_lease", (q) => q.eq("status", status).lte("leaseExpiresAt", now))
    .filter((q) => q.eq(q.field("teamId"), teamId))
    .collect();
}

export const claim = internalMutation({
  args: {
    teamId: v.id("teams"),
    workerId: v.string(),
    leaseMs: v.number(),
  },
  handler: async (ctx, args) => {
    const workerId = normalizedWorkerId(args.workerId);
    const leaseMs = boundedLeaseMs(args.leaseMs);
    const now = Date.now();
    for (let skipped = 0; skipped < 20; skipped += 1) {
      const [queued, ...expiredGroups] = await Promise.all([
        ctx.db
          .query("renderJobs")
          .withIndex("by_queue", (q) => q.eq("status", "queued"))
          .filter((q) => q.eq(q.field("teamId"), args.teamId))
          .first(),
        ...ACTIVE_STATUSES.map((status) => expiredForStatus(ctx, args.teamId, status, now)),
      ]);
      const candidate = [queued, ...expiredGroups.flat()]
        .filter((job): job is Doc<"renderJobs"> => job !== null)
        .filter((job) => isClaimableRenderJob(job, now))
        .sort(compareQueueCandidates)[0];
      if (!candidate) return null;
      if (candidate.cancellationRequestedAt !== undefined) {
        await ctx.db.patch(
          candidate._id,
          cancellationPatch(
            now,
            candidate.cancellationRequestedByClerkId,
            "Render cancelled before it could be reclaimed.",
          ),
        );
        continue;
      }
      if (!candidate.workerSpec) {
        await ctx.db.patch(candidate._id, {
          status: "failed",
          failedAt: now,
          error: "Render job has no normalized worker specification.",
          failure: {
            code: "MISSING_WORKER_SPEC",
            retryable: false,
            message: "Render job has no normalized worker specification.",
          },
          workerMessage: "Render job is incompatible with this worker adapter.",
        });
        continue;
      }
      const claimToken = generateOpaqueToken(48);
      const attempt = candidate.attemptCount + 1;
      await ctx.db.patch(candidate._id, {
        status: "claimed",
        attemptCount: attempt,
        claimedBy: workerId,
        claimToken,
        claimedAt: now,
        startedAt: undefined,
        uploadingAt: undefined,
        heartbeatAt: now,
        leaseExpiresAt: now + leaseMs,
        phase: "claimed",
        progress: 0,
        workerMessage:
          candidate.status === "queued"
            ? `Claimed by ${workerId}.`
            : `Reclaimed by ${workerId} after an expired lease.`,
        error: undefined,
        failure: undefined,
        failedAt: undefined,
      });
      return {
        jobId: candidate._id,
        claimToken,
        workerId,
        attempt,
        spec: candidate.workerSpec,
      };
    }
    return null;
  },
});

async function applyWorkerProgress(
  ctx: MutationCtx,
  args: {
    teamId: Id<"teams">;
    jobId: Id<"renderJobs">;
    workerId: string;
    claimToken: string;
    phase: "claimed" | "downloading" | "probing" | "rendering" | "uploading" | "complete";
    progress: number;
    message?: string;
    leaseMs?: number;
  },
) {
  const job = await ctx.db.get(args.jobId);
  if (!job || job.teamId !== args.teamId) {
    return { accepted: false, cancellationRequested: false };
  }
  const disposition = heartbeatDisposition(job, args.workerId, args.claimToken);
  if (disposition === "lease_lost") {
    return { accepted: false, cancellationRequested: false };
  }
  if (disposition === "cancelled") {
    await ctx.db.patch(
      job._id,
      cancellationPatch(
        Date.now(),
        job.cancellationRequestedByClerkId,
        "Render cancelled by its requester.",
      ),
    );
    return { accepted: false, cancellationRequested: true };
  }
  const now = Date.now();
  const status = statusForPhase(args.phase);
  await ctx.db.patch(job._id, {
    status,
    phase: args.phase,
    progress: clampProgress(args.progress),
    workerMessage: optionalMessage(args.message),
    startedAt: status === "running" ? job.startedAt ?? now : job.startedAt,
    uploadingAt: status === "uploading" ? job.uploadingAt ?? now : job.uploadingAt,
    ...(args.leaseMs === undefined
      ? {}
      : {
          heartbeatAt: now,
          leaseExpiresAt: now + boundedLeaseMs(args.leaseMs),
        }),
  });
  return { accepted: true, cancellationRequested: false };
}

export const heartbeat = internalMutation({
  args: {
    ...claimIdentityValidator,
    phase: phaseValidator,
    progress: v.number(),
    message: v.optional(v.string()),
    leaseMs: v.number(),
  },
  handler: async (ctx, args) => await applyWorkerProgress(ctx, {
    ...args,
    workerId: normalizedWorkerId(args.workerId),
  }),
});

export const progress = internalMutation({
  args: {
    ...claimIdentityValidator,
    phase: phaseValidator,
    progress: v.number(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => await applyWorkerProgress(ctx, {
    ...args,
    workerId: normalizedWorkerId(args.workerId),
  }),
});

export const complete = internalMutation({
  args: {
    ...claimIdentityValidator,
    outputObjectKey: v.string(),
    manifestObjectKey: v.string(),
    outputBytes: v.number(),
    cache: cacheResultValidator,
  },
  handler: async (ctx, args) => {
    const workerId = normalizedWorkerId(args.workerId);
    const job = await ctx.db.get(args.jobId);
    if (
      !job
      || job.teamId !== args.teamId
      || !ownsRenderClaim(job, workerId, args.claimToken)
    ) {
      return { accepted: false, cancellationRequested: false };
    }
    if (job.cancellationRequestedAt !== undefined) {
      await ctx.db.patch(
        job._id,
        cancellationPatch(
          Date.now(),
          job.cancellationRequestedByClerkId,
          "Render cancelled before completion was committed.",
        ),
      );
      return { accepted: false, cancellationRequested: true };
    }
    if (
      !job.workerSpec
      || args.outputObjectKey !== job.workerSpec.outputKey
      || args.manifestObjectKey !== job.workerSpec.manifestKey
    ) {
      throw new Error("Completion object keys do not match the claimed job specification.");
    }
    if (!Number.isSafeInteger(args.outputBytes) || args.outputBytes < 0) {
      throw new Error("outputBytes must be a non-negative safe integer.");
    }
    assertCacheResult(args.cache);
    const usage = renderUsageForCompletion(args.cache);
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "done",
      phase: "complete",
      progress: 1,
      workerMessage: "Render completed.",
      outputObjectKey: args.outputObjectKey,
      manifestObjectKey: args.manifestObjectKey,
      outputBytes: args.outputBytes,
      cacheResult: args.cache,
      segmentCache: {
        segmentCount: args.cache.totalSegments,
        cacheHits: args.cache.hits,
        cacheMisses: args.cache.misses,
        bytesReused: args.cache.hitBytes,
        bytesRendered: args.cache.missBytes,
      },
      // The completion row is the authoritative render usage ledger until A3
      // adds renderMinutes/cacheHitSavingsMinutes to usageMeters. The helper
      // validates and names those deltas now so the eventual meter patch is local.
      completedAt: now,
      claimedBy: undefined,
      claimToken: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: undefined,
      error: undefined,
      failure: undefined,
    });
    return { accepted: true, cancellationRequested: false, usage };
  },
});

export const fail = internalMutation({
  args: {
    ...claimIdentityValidator,
    failure: v.object({
      code: v.string(),
      retryable: v.boolean(),
      message: v.optional(v.string()),
      detail: v.optional(v.record(v.string(), v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const workerId = normalizedWorkerId(args.workerId);
    const job = await ctx.db.get(args.jobId);
    if (
      !job
      || job.teamId !== args.teamId
      || !ownsRenderClaim(job, workerId, args.claimToken)
    ) return false;
    if (job.cancellationRequestedAt !== undefined) {
      await ctx.db.patch(
        job._id,
        cancellationPatch(Date.now(), job.cancellationRequestedByClerkId),
      );
      return true;
    }
    const code = args.failure.code.trim().slice(0, 100);
    if (!code) throw new Error("failure.code is required.");
    const detailEntries = Object.entries(args.failure.detail ?? {}).slice(0, MAX_FAILURE_DETAIL_FIELDS);
    const detail = detailEntries.length === 0
      ? undefined
      : Object.fromEntries(detailEntries.map(([key, value]) => [key.slice(0, 100), value.slice(0, 1_000)]));
    const message = optionalMessage(args.failure.message);
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "failed",
      failedAt: now,
      error: message ?? code,
      failure: {
        code,
        retryable: args.failure.retryable,
        message,
        detail,
      },
      workerMessage: message ?? "Render failed.",
      claimedBy: undefined,
      claimToken: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: undefined,
    });
    return true;
  },
});

export const release = internalMutation({
  args: {
    ...claimIdentityValidator,
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const workerId = normalizedWorkerId(args.workerId);
    const job = await ctx.db.get(args.jobId);
    if (
      !job
      || job.teamId !== args.teamId
      || !ownsRenderClaim(job, workerId, args.claimToken)
    ) return false;
    if (job.cancellationRequestedAt !== undefined) {
      await ctx.db.patch(
        job._id,
        cancellationPatch(Date.now(), job.cancellationRequestedByClerkId),
      );
      return true;
    }
    await ctx.db.patch(job._id, {
      status: "queued",
      queuedAt: Date.now(),
      claimedBy: undefined,
      claimToken: undefined,
      claimedAt: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      phase: undefined,
      progress: 0,
      workerMessage: optionalMessage(args.reason) ?? "Released back to the queue.",
    });
    return true;
  },
});

/** Internal diagnostics preserve the queue index's status, priority, queuedAt ordering. */
export const listQueue = internalQuery({
  args: {
    teamId: v.id("teams"),
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("uploading"),
      v.literal("done"),
      v.literal("failed"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 25)));
    return await ctx.db
      .query("renderJobs")
      .withIndex("by_queue", (q) => q.eq("status", args.status))
      .filter((q) => q.eq(q.field("teamId"), args.teamId))
      .take(limit);
  },
});
