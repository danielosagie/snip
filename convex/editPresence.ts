import { Presence } from "@convex-dev/presence";
import { ConvexError, v } from "convex/values";

import type { TimelinePresencePayload } from "../src/lib/timeline/types";
import {
  isTimelinePresencePayload,
  normalizeTimelinePresencePayload,
} from "../src/components/presence/model";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  identityAvatarUrl,
  identityName,
  requireProjectAccess,
} from "./auth";

const presence = new Presence(components.presence);

const DEFAULT_HEARTBEAT_INTERVAL_MS = 12_000;
const MIN_HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CLIENT_ID_LENGTH = 128;

const timelineTimeValidator = v.object({
  value: v.number(),
  rate: v.number(),
});

const timelineRangeValidator = v.object({
  start: timelineTimeValidator,
  duration: timelineTimeValidator,
});

const softLockClaimValidator = v.object({
  target: v.union(
    v.object({ kind: v.literal("sequence"), sequenceId: v.string() }),
    v.object({ kind: v.literal("file"), path: v.string() }),
  ),
  holder: v.string(),
  claimedAt: v.number(),
});

const timelinePresencePayloadValidator = v.object({
  playheadPosition: timelineTimeValidator,
  selectedClipIds: v.array(v.string()),
  viewportRange: timelineRangeValidator,
  softLocks: v.array(softLockClaimValidator),
});

const participantValidator = v.object({
  userId: v.string(),
  actorId: v.string(),
  displayName: v.string(),
  avatarUrl: v.optional(v.string()),
  online: v.boolean(),
  lastDisconnected: v.number(),
  updatedAt: v.number(),
  payload: timelinePresencePayloadValidator,
});

type EditPresenceData = {
  actorId: string;
  displayName: string;
  avatarUrl?: string;
  updatedAt: number;
  payload: TimelinePresencePayload;
};

function roomIdForTimelineDoc(timelineDocId: string) {
  return `timeline-doc:${timelineDocId}`;
}

function boundedHeartbeatInterval(interval: number | undefined) {
  return Math.min(
    Math.max(interval ?? DEFAULT_HEARTBEAT_INTERVAL_MS, MIN_HEARTBEAT_INTERVAL_MS),
    MAX_HEARTBEAT_INTERVAL_MS,
  );
}

function normalizedClientId(clientId: string) {
  const normalized = clientId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!normalized || normalized.length > MAX_CLIENT_ID_LENGTH) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Invalid presence client.",
    });
  }
  return normalized;
}

async function getActor(
  ctx: MutationCtx,
  timelineDocId: Id<"timelineDocs">,
  clientId: string,
) {
  const doc = await ctx.db.get(timelineDocId);
  if (!doc) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Timeline not found.",
    });
  }

  const { user } = await requireProjectAccess(ctx, doc.projectId, "viewer");
  const actorId = `clerk:${user.subject}`;
  const presenceUserId = `${actorId}:${normalizedClientId(clientId)}`;

  return {
    actorId,
    presenceUserId,
    displayName: identityName(user),
    avatarUrl: identityAvatarUrl(user),
  };
}

function parseEditPresenceData(value: unknown): EditPresenceData | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  if (
    typeof data.actorId !== "string" ||
    typeof data.displayName !== "string" ||
    (data.avatarUrl !== undefined && typeof data.avatarUrl !== "string") ||
    typeof data.updatedAt !== "number" ||
    !Number.isFinite(data.updatedAt) ||
    !isTimelinePresencePayload(data.payload)
  ) {
    return null;
  }

  return {
    actorId: data.actorId,
    displayName: data.displayName,
    avatarUrl:
      typeof data.avatarUrl === "string" ? data.avatarUrl : undefined,
    updatedAt: data.updatedAt,
    payload: data.payload,
  };
}

async function writePresenceData(
  ctx: MutationCtx,
  input: {
    timelineDocId: string;
    roomId: string;
    presenceUserId: string;
    actorId: string;
    displayName: string;
    avatarUrl?: string;
    payload: TimelinePresencePayload;
  },
) {
  const now = Date.now();
  const payload = normalizeTimelinePresencePayload(
    input.payload,
    input.actorId,
    now,
  );
  if (!payload) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Invalid timeline presence.",
    });
  }

  await presence.updateRoomUser(ctx, input.roomId, input.presenceUserId, {
    actorId: input.actorId,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    updatedAt: now,
    payload,
  } satisfies EditPresenceData);
}

export const heartbeat = mutation({
  args: {
    timelineDocId: v.id("timelineDocs"),
    sessionId: v.string(),
    clientId: v.string(),
    interval: v.optional(v.number()),
    payload: timelinePresencePayloadValidator,
  },
  returns: v.object({
    roomToken: v.string(),
    sessionToken: v.string(),
    actorId: v.string(),
    userId: v.string(),
  }),
  handler: async (ctx, args) => {
    const actor = await getActor(ctx, args.timelineDocId, args.clientId);
    const roomId = roomIdForTimelineDoc(args.timelineDocId);
    const result = await presence.heartbeat(
      ctx,
      roomId,
      actor.presenceUserId,
      args.sessionId,
      boundedHeartbeatInterval(args.interval),
    );
    await writePresenceData(ctx, {
      timelineDocId: args.timelineDocId,
      roomId,
      ...actor,
      payload: args.payload,
    });

    return {
      ...result,
      actorId: actor.actorId,
      userId: actor.presenceUserId,
    };
  },
});

export const update = mutation({
  args: {
    timelineDocId: v.id("timelineDocs"),
    clientId: v.string(),
    payload: timelinePresencePayloadValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await getActor(ctx, args.timelineDocId, args.clientId);
    await writePresenceData(ctx, {
      timelineDocId: args.timelineDocId,
      roomId: roomIdForTimelineDoc(args.timelineDocId),
      ...actor,
      payload: args.payload,
    });
    return null;
  },
});

export const list = query({
  args: { roomToken: v.string() },
  returns: v.array(participantValidator),
  handler: async (ctx, args) => {
    const state = await presence.list(ctx, args.roomToken);
    const participants = [];

    for (const entry of state) {
      const data = parseEditPresenceData(entry.data);
      if (!data) continue;
      participants.push({
        userId: entry.userId,
        online: entry.online,
        lastDisconnected: entry.lastDisconnected,
        ...data,
      });
    }

    return participants;
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await presence.disconnect(ctx, args.sessionToken);
    return null;
  },
});
