import { Presence } from "@convex-dev/presence";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query, MutationCtx } from "./_generated/server";
import {
  identityAvatarUrl,
  identityName,
  requireProjectAccess,
  requireVideoAccess,
} from "./auth";
import { findShareLinkByToken } from "./shareAccess";

const presence = new Presence(components.presence);
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const WATCH_HEARTBEAT_INTERVAL_MS = 4_000;
const MIN_WATCH_HEARTBEAT_INTERVAL_MS = 2_000;
const MAX_WATCH_HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_WATCH_PLAYHEAD_SECONDS = 48 * 60 * 60;

const watcherDataValidator = v.object({
  kind: v.union(v.literal("member"), v.literal("guest")),
  displayName: v.string(),
  avatarUrl: v.optional(v.string()),
});

const watchPresenceDataValidator = v.object({
  kind: v.union(v.literal("member"), v.literal("guest")),
  displayName: v.string(),
  avatarUrl: v.optional(v.string()),
  joinedAt: v.number(),
  updatedAt: v.number(),
  playheadSeconds: v.number(),
  playing: v.boolean(),
});

function roomIdForVideo(videoId: string) {
  return `video:${videoId}`;
}

function watchRoomIdForVideo(videoId: string) {
  return `video-watch:${videoId}`;
}

function guestDisplayName(clientId: string) {
  const suffix = clientId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
  return `Guest ${suffix || "USER"}`;
}

async function hasShareTokenAccess(
  ctx: MutationCtx,
  shareToken: string | undefined,
  videoId: string,
) {
  if (!shareToken) return false;

  const shareLink = await findShareLinkByToken(ctx, shareToken);
  if (!shareLink) return false;
  if (shareLink.expiresAt && shareLink.expiresAt <= Date.now()) return false;

  return shareLink.videoId === videoId;
}

async function requireVideoPresenceAccess(
  ctx: MutationCtx,
  videoId: Id<"videos">,
  shareToken: string | undefined,
) {
  const identity = await ctx.auth.getUserIdentity();
  let hasVideoAccess = false;
  if (identity) {
    try {
      await requireVideoAccess(ctx, videoId, "viewer");
      hasVideoAccess = true;
    } catch {
      hasVideoAccess = false;
    }
  }

  const hasTokenAccess = await hasShareTokenAccess(ctx, shareToken, videoId);
  if (!hasVideoAccess && !hasTokenAccess) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "You do not have access to this video.",
    });
  }

  return identity;
}

function normalizedWatchClientId(clientId: string) {
  const normalized = clientId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!normalized || normalized.length > 128) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Invalid presence client.",
    });
  }
  return normalized;
}

function watchIdentity(
  identity: Awaited<ReturnType<MutationCtx["auth"]["getUserIdentity"]>>,
  clientId: string,
) {
  const normalizedClientId = normalizedWatchClientId(clientId);
  if (identity) {
    return {
      userId: `clerk:${identity.subject}:${normalizedClientId}`,
      kind: "member" as const,
      displayName: identityName(identity),
      avatarUrl: identityAvatarUrl(identity),
    };
  }
  return {
    userId: `guest:${normalizedClientId}`,
    kind: "guest" as const,
    displayName: guestDisplayName(normalizedClientId),
  };
}

function boundedWatchInterval(interval: number | undefined) {
  return Math.min(
    Math.max(
      interval ?? WATCH_HEARTBEAT_INTERVAL_MS,
      MIN_WATCH_HEARTBEAT_INTERVAL_MS,
    ),
    MAX_WATCH_HEARTBEAT_INTERVAL_MS,
  );
}

function boundedPlayhead(playheadSeconds: number) {
  if (!Number.isFinite(playheadSeconds)) return 0;
  return Math.min(Math.max(playheadSeconds, 0), MAX_WATCH_PLAYHEAD_SECONDS);
}

function boundedJoinedAt(joinedAt: number, now: number) {
  const maxFutureSkew = 5 * 60 * 1_000;
  if (
    !Number.isFinite(joinedAt) ||
    joinedAt <= 0 ||
    joinedAt > now + maxFutureSkew
  ) {
    return now;
  }
  return joinedAt;
}

export const heartbeat = mutation({
  args: {
    videoId: v.id("videos"),
    sessionId: v.string(),
    clientId: v.string(),
    interval: v.optional(v.number()),
    shareToken: v.optional(v.string()),
  },
  returns: v.object({
    roomToken: v.string(),
    sessionToken: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    let hasVideoAccess = false;
    if (identity) {
      try {
        await requireVideoAccess(ctx, args.videoId, "viewer");
        hasVideoAccess = true;
      } catch {
        hasVideoAccess = false;
      }
    }

    const hasTokenAccess = await hasShareTokenAccess(
      ctx,
      args.shareToken,
      args.videoId,
    );

    if (!hasVideoAccess && !hasTokenAccess) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "You do not have access to this video.",
      });
    }

    const roomId = roomIdForVideo(args.videoId);
    let userId: string;
    let data: {
      kind: "member" | "guest";
      displayName: string;
      avatarUrl?: string;
    };

    if (identity) {
      userId = `clerk:${identity.subject}`;
      data = {
        kind: "member",
        displayName: identityName(identity),
        avatarUrl: identityAvatarUrl(identity),
      };
    } else {
      const clientId = args.clientId.trim();
      if (!clientId) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Missing client identifier.",
        });
      }

      userId = `guest:${clientId}`;
      data = {
        kind: "guest",
        displayName: guestDisplayName(clientId),
      };
    }

    const result = await presence.heartbeat(
      ctx,
      roomId,
      userId,
      args.sessionId,
      args.interval ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    );
    await presence.updateRoomUser(ctx, roomId, userId, data);
    return result;
  },
});

export const list = query({
  args: {
    roomToken: v.string(),
  },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      data: v.optional(watcherDataValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const state = await presence.list(ctx, args.roomToken);

    return state.map((entry) => {
      const raw = entry.data;
      const parsed =
        raw &&
        typeof raw === "object" &&
        ("kind" in raw || "displayName" in raw) &&
        (raw as { kind?: string }).kind &&
        (raw as { displayName?: string }).displayName
          ? (raw as {
              kind: "member" | "guest";
              displayName: string;
              avatarUrl?: string;
            })
          : undefined;

      if (parsed) {
        return {
          userId: entry.userId,
          online: entry.online,
          lastDisconnected: entry.lastDisconnected,
          data: parsed,
        };
      }

      if (entry.userId.startsWith("guest:")) {
        const clientId = entry.userId.slice("guest:".length);
        return {
          userId: entry.userId,
          online: entry.online,
          lastDisconnected: entry.lastDisconnected,
          data: {
            kind: "guest" as const,
            displayName: guestDisplayName(clientId),
          },
        };
      }

      return {
        userId: entry.userId,
        online: entry.online,
        lastDisconnected: entry.lastDisconnected,
        data: {
          kind: "member" as const,
          displayName: "Member",
        },
      };
    });
  },
});

export const disconnect = mutation({
  args: {
    sessionToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await presence.disconnect(ctx, args.sessionToken);
    return null;
  },
});

/** Separate high-frequency room for close-enough share-player sync. */
export const watchHeartbeat = mutation({
  args: {
    videoId: v.id("videos"),
    sessionId: v.string(),
    clientId: v.string(),
    interval: v.optional(v.number()),
    shareToken: v.optional(v.string()),
    joinedAt: v.number(),
    playheadSeconds: v.number(),
    playing: v.boolean(),
  },
  returns: v.object({
    roomToken: v.string(),
    sessionToken: v.string(),
    userId: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireVideoPresenceAccess(
      ctx,
      args.videoId,
      args.shareToken,
    );
    const watcher = watchIdentity(identity, args.clientId);
    const roomId = watchRoomIdForVideo(args.videoId);
    const result = await presence.heartbeat(
      ctx,
      roomId,
      watcher.userId,
      args.sessionId,
      boundedWatchInterval(args.interval),
    );
    const now = Date.now();
    await presence.updateRoomUser(ctx, roomId, watcher.userId, {
      kind: watcher.kind,
      displayName: watcher.displayName,
      avatarUrl: watcher.avatarUrl,
      joinedAt: boundedJoinedAt(args.joinedAt, now),
      updatedAt: now,
      playheadSeconds: boundedPlayhead(args.playheadSeconds),
      playing: args.playing,
    });
    return { ...result, userId: watcher.userId };
  },
});

export const updateWatchPlayback = mutation({
  args: {
    videoId: v.id("videos"),
    clientId: v.string(),
    shareToken: v.optional(v.string()),
    joinedAt: v.number(),
    playheadSeconds: v.number(),
    playing: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireVideoPresenceAccess(
      ctx,
      args.videoId,
      args.shareToken,
    );
    const watcher = watchIdentity(identity, args.clientId);
    const now = Date.now();
    await presence.updateRoomUser(
      ctx,
      watchRoomIdForVideo(args.videoId),
      watcher.userId,
      {
        kind: watcher.kind,
        displayName: watcher.displayName,
        avatarUrl: watcher.avatarUrl,
        joinedAt: boundedJoinedAt(args.joinedAt, now),
        updatedAt: now,
        playheadSeconds: boundedPlayhead(args.playheadSeconds),
        playing: args.playing,
      },
    );
    return null;
  },
});

export const listWatch = query({
  args: { roomToken: v.string() },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      data: watchPresenceDataValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const state = await presence.list(ctx, args.roomToken);
    const watchers = [];

    for (const entry of state) {
      const raw = entry.data;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const data = raw as Record<string, unknown>;
      if (
        (data.kind !== "member" && data.kind !== "guest") ||
        typeof data.displayName !== "string" ||
        (data.avatarUrl !== undefined && typeof data.avatarUrl !== "string") ||
        typeof data.joinedAt !== "number" ||
        typeof data.updatedAt !== "number" ||
        typeof data.playheadSeconds !== "number" ||
        typeof data.playing !== "boolean"
      ) {
        continue;
      }
      watchers.push({
        userId: entry.userId,
        online: entry.online,
        lastDisconnected: entry.lastDisconnected,
        data: {
          kind: data.kind === "member" ? "member" as const : "guest" as const,
          displayName: data.displayName,
          avatarUrl: data.avatarUrl,
          joinedAt: data.joinedAt,
          updatedAt: data.updatedAt,
          playheadSeconds: data.playheadSeconds,
          playing: data.playing,
        },
      });
    }

    return watchers;
  },
});

export const listProjectOnlineCounts = query({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.object({
    counts: v.record(v.string(), v.number()),
  }),
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, "viewer");

    const videos = await ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const counts: Record<string, number> = {};

    await Promise.all(
      videos.map(async (video) => {
        const onlineUsers = await presence.listRoom(
          ctx,
          roomIdForVideo(video._id),
          true,
        );
        counts[video._id] = onlineUsers.length;
      }),
    );

    return { counts };
  },
});
