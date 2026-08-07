import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const CLAIM_LEASE_MS = 10 * 60 * 1_000;
const MAX_WORKER_ID_LENGTH = 128;
const MAX_ERROR_LENGTH = 1_000;

function assertRenditionName(name: string) {
  const normalized = name.trim();
  if (
    !normalized ||
    normalized.length > 255 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\")
  ) {
    throw new Error("Rendition name is invalid.");
  }
  return normalized;
}

function proxyDestinationKey(
  teamSlug: string,
  projectId: Id<"projects">,
  videoId: Id<"videos">,
  renditionName: string,
) {
  return `projects/${teamSlug}/${projectId}/proxies/${videoId}/${assertRenditionName(renditionName)}`;
}

function findReadyRendition(video: Doc<"videos">, renditionName: string) {
  const rendition = (video.staticRenditions ?? []).find(
    (candidate) => candidate.name === renditionName,
  );
  if (!rendition || rendition.status !== "ready") {
    throw new Error("Static rendition is not ready.");
  }
  return rendition;
}

export const getClaimContext = internalQuery({
  args: {
    teamId: v.id("teams"),
    videoId: v.id("videos"),
    renditionName: v.string(),
  },
  handler: async (ctx, args) => {
    const renditionName = assertRenditionName(args.renditionName);
    const video = await ctx.db.get(args.videoId);
    if (!video) throw new Error("Video not found.");
    const project = await ctx.db.get(video.projectId);
    if (!project || project.teamId !== args.teamId) {
      throw new Error("Video not found for this team.");
    }
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found.");
    const rendition = findReadyRendition(video, renditionName);
    return {
      projectId: video.projectId,
      muxAssetId: video.muxAssetId,
      muxSignedPlaybackId: video.muxSignedPlaybackId,
      renditionName,
      destinationKey: proxyDestinationKey(
        team.slug,
        video.projectId,
        video._id,
        renditionName,
      ),
      expectedBytes: rendition.filesizeBytes,
      contentType: rendition.ext === "m4a" ? "audio/mp4" : "video/mp4",
      r2Key: rendition.r2Key,
    };
  },
});

export type StaticRenditionClaimResult =
  | { status: "already_mirrored"; r2Key: string }
  | { status: "busy"; retryAfterMs: number }
  | {
      status: "claimed";
      jobId: Id<"staticRenditionMirrorJobs">;
      claimToken: string;
      leaseExpiresAt: number;
      destinationKey: string;
    };

export const claim = internalMutation({
  args: {
    teamId: v.id("teams"),
    videoId: v.id("videos"),
    renditionName: v.string(),
    workerId: v.string(),
    claimToken: v.string(),
  },
  handler: async (ctx, args): Promise<StaticRenditionClaimResult> => {
    const workerId = args.workerId.trim();
    if (!workerId || workerId.length > MAX_WORKER_ID_LENGTH) {
      throw new Error("Worker ID must contain 1 to 128 characters.");
    }
    if (args.claimToken.length < 32 || args.claimToken.length > 256) {
      throw new Error("Claim token is invalid.");
    }
    const renditionName = assertRenditionName(args.renditionName);
    const video = await ctx.db.get(args.videoId);
    if (!video) throw new Error("Video not found.");
    const project = await ctx.db.get(video.projectId);
    if (!project || project.teamId !== args.teamId) {
      throw new Error("Video not found for this team.");
    }
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found.");
    const rendition = findReadyRendition(video, renditionName);
    if (rendition.r2Key) {
      return { status: "already_mirrored", r2Key: rendition.r2Key };
    }

    const destinationKey = proxyDestinationKey(
      team.slug,
      video.projectId,
      video._id,
      renditionName,
    );
    const existing = await ctx.db
      .query("staticRenditionMirrorJobs")
      .withIndex("by_video_rendition", (q) =>
        q.eq("videoId", video._id).eq("renditionName", renditionName),
      )
      .first();
    const now = Date.now();
    if (
      existing?.status === "claimed" &&
      (existing.leaseExpiresAt ?? 0) > now
    ) {
      return {
        status: "busy",
        retryAfterMs: (existing.leaseExpiresAt ?? now) - now,
      };
    }
    const leaseExpiresAt = now + CLAIM_LEASE_MS;
    let jobId: Id<"staticRenditionMirrorJobs">;
    if (existing) {
      jobId = existing._id;
      await ctx.db.patch(existing._id, {
        status: "claimed",
        destinationKey,
        claimedAt: now,
        claimedBy: workerId,
        claimToken: args.claimToken,
        leaseExpiresAt,
        failedAt: undefined,
        error: undefined,
        updatedAt: now,
      });
    } else {
      jobId = await ctx.db.insert("staticRenditionMirrorJobs", {
        teamId: args.teamId,
        projectId: video.projectId,
        videoId: video._id,
        renditionName,
        status: "claimed",
        destinationKey,
        queuedAt: now,
        claimedAt: now,
        claimedBy: workerId,
        claimToken: args.claimToken,
        leaseExpiresAt,
        updatedAt: now,
      });
    }
    await ctx.db.patch(video._id, {
      staticRenditions: (video.staticRenditions ?? []).map((candidate) =>
        candidate.name === renditionName
          ? {
              ...candidate,
              mirrorStatus: "claimed" as const,
              mirrorError: undefined,
              mirrorUpdatedAt: now,
            }
          : candidate,
      ),
      staticRenditionsUpdatedAt: now,
    });
    return {
      status: "claimed",
      jobId,
      claimToken: args.claimToken,
      leaseExpiresAt,
      destinationKey,
    };
  },
});

export const complete = internalMutation({
  args: {
    teamId: v.id("teams"),
    jobId: v.id("staticRenditionMirrorJobs"),
    workerId: v.string(),
    claimToken: v.string(),
    outcome: v.union(v.literal("completed"), v.literal("failed")),
    r2Key: v.optional(v.string()),
    outputBytes: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.teamId !== args.teamId) {
      throw new Error("Mirror job not found for this team.");
    }
    const now = Date.now();
    if (
      job.status !== "claimed" ||
      job.claimedBy !== args.workerId ||
      job.claimToken !== args.claimToken ||
      (job.leaseExpiresAt ?? 0) <= now
    ) {
      throw new Error("Mirror job claim is no longer valid.");
    }
    const video = await ctx.db.get(job.videoId);
    if (!video) throw new Error("Mirror job video was not found.");
    findReadyRendition(video, job.renditionName);

    if (args.outcome === "completed") {
      if (args.r2Key !== job.destinationKey) {
        throw new Error("Completed mirror key does not match the scoped destination.");
      }
      if (
        args.outputBytes !== undefined &&
        (!Number.isFinite(args.outputBytes) || args.outputBytes < 0)
      ) {
        throw new Error("Output byte count is invalid.");
      }
      await ctx.db.patch(video._id, {
        staticRenditions: (video.staticRenditions ?? []).map((candidate) =>
          candidate.name === job.renditionName
            ? {
                ...candidate,
                r2Key: job.destinationKey,
                mirrorStatus: "ready" as const,
                mirrorError: undefined,
                mirrorUpdatedAt: now,
              }
            : candidate,
        ),
        staticRenditionsUpdatedAt: now,
      });
      await ctx.db.patch(job._id, {
        status: "completed",
        completedAt: now,
        outputBytes: args.outputBytes,
        leaseExpiresAt: undefined,
        error: undefined,
        updatedAt: now,
      });
      return { status: "completed" as const, r2Key: job.destinationKey };
    }

    const error = args.error?.trim().slice(0, MAX_ERROR_LENGTH) || "Mirror failed.";
    await ctx.db.patch(video._id, {
      staticRenditions: (video.staticRenditions ?? []).map((candidate) =>
        candidate.name === job.renditionName
          ? {
              ...candidate,
              mirrorStatus: "errored" as const,
              mirrorError: error,
              mirrorUpdatedAt: now,
            }
          : candidate,
      ),
      staticRenditionsUpdatedAt: now,
    });
    await ctx.db.patch(job._id, {
      status: "failed",
      failedAt: now,
      leaseExpiresAt: undefined,
      error,
      updatedAt: now,
    });
    return { status: "failed" as const, error };
  },
});
