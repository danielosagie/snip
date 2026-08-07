import { v } from "convex/values";
import type { GenericId } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { identityName, requireProjectAccess } from "./auth";
import {
  applyTimelineOps,
  assertTimelinePropertyValue,
  createTimelineDocument,
  parseTimelineDocumentJson,
} from "../src/lib/timeline/operations";
import { fcpxmlToTimelineDocument } from "../src/lib/timeline/otio";
import {
  TIMELINE_SEQUENCE_PROPERTIES,
  type TimelineDocument,
  type TimelineOp,
  type TimelinePropertyValue,
} from "../src/lib/timeline/types";

const MAX_OPS_PER_MUTATION = 100;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_BRANCH_LENGTH = 128;

const timelineTimeValidator = v.object({ value: v.number(), rate: v.number() });
const timelineRangeValidator = v.object({
  start: timelineTimeValidator,
  duration: timelineTimeValidator,
});
const opBase = {
  opId: v.string(),
  actorId: v.string(),
  timestamp: v.number(),
};

const timelineOpValidator = v.union(
  v.object({
    ...opBase,
    type: v.literal("setClipRange"),
    clipId: v.string(),
    timelineRange: v.optional(timelineRangeValidator),
    sourceRange: v.optional(timelineRangeValidator),
  }),
  v.object({
    ...opBase,
    type: v.literal("moveClip"),
    clipId: v.string(),
    targetTrackId: v.string(),
    timelineStart: timelineTimeValidator,
  }),
  v.object({
    ...opBase,
    type: v.literal("addClip"),
    trackId: v.string(),
    clip: v.object({
      id: v.string(),
      mediaId: v.id("videos"),
      timelineRange: timelineRangeValidator,
      sourceRange: timelineRangeValidator,
      properties: v.optional(v.record(v.string(), v.any())),
    }),
  }),
  v.object({
    ...opBase,
    type: v.literal("removeClip"),
    clipId: v.string(),
  }),
  v.object({
    ...opBase,
    type: v.literal("setClipProperty"),
    clipId: v.string(),
    property: v.string(),
    value: v.any(),
  }),
  v.object({
    ...opBase,
    type: v.literal("addTrack"),
    track: v.object({
      id: v.string(),
      kind: v.union(
        v.literal("video"),
        v.literal("audio"),
        v.literal("title"),
        v.literal("metadata"),
      ),
      name: v.optional(v.string()),
      position: v.optional(v.number()),
      properties: v.optional(v.record(v.string(), v.any())),
    }),
  }),
  v.object({
    ...opBase,
    type: v.literal("removeTrack"),
    trackId: v.string(),
  }),
  v.object({
    ...opBase,
    type: v.literal("setTrackProperty"),
    trackId: v.string(),
    property: v.string(),
    value: v.any(),
  }),
  v.object({
    ...opBase,
    type: v.literal("setSequenceProperty"),
    property: v.string(),
    value: v.any(),
  }),
);

function normalizeBranch(branch: string | undefined) {
  const normalized = (branch ?? "main").trim() || "main";
  if (normalized.length > MAX_BRANCH_LENGTH) {
    throw new Error(`Branch names must be under ${MAX_BRANCH_LENGTH} characters.`);
  }
  if (Array.from(normalized).some((character) => character.charCodeAt(0) < 32)) {
    throw new Error("Branch names cannot contain control characters.");
  }
  return normalized;
}

function validateInitialProperties(properties: Record<string, unknown> | undefined) {
  if (!properties) return {};
  for (const value of Object.values(properties)) {
    assertTimelinePropertyValue(value as TimelinePropertyValue);
  }
  return properties as Record<string, TimelinePropertyValue>;
}

async function validateVersion(
  ctx: MutationCtx,
  versionId: Id<"projectVersions"> | undefined,
  projectId: Id<"projects">,
) {
  if (!versionId) return;
  const version = await ctx.db.get(versionId);
  if (!version || version.projectId !== projectId) {
    throw new Error("Project version was not found in this project.");
  }
}

async function validateOpMedia(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  ops: readonly TimelineOp[],
) {
  const ids = Array.from(
    new Set(
      ops
        .filter((op): op is Extract<TimelineOp, { type: "addClip" }> => op.type === "addClip")
        .map((op) => op.clip.mediaId),
    ),
  );
  await Promise.all(
    ids.map(async (mediaId) => {
      const video = await ctx.db.get(mediaId as Id<"videos">);
      if (!video || video.projectId !== projectId) {
        throw new Error(`Media ${mediaId} was not found in this project.`);
      }
    }),
  );
}

async function validateDocumentMedia(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  document: TimelineDocument,
) {
  const rawIds = new Set<string>();
  for (const track of Object.values(document.sequence.tracks)) {
    for (const clip of Object.values(track.clips)) rawIds.add(clip.mediaId.value);
  }
  await Promise.all(
    Array.from(rawIds).map(async (rawId) => {
      const mediaId = ctx.db.normalizeId("videos", rawId);
      if (!mediaId) throw new Error(`Snapshot media ID ${rawId} is invalid.`);
      const video = await ctx.db.get(mediaId);
      if (!video || video.projectId !== projectId) {
        throw new Error(`Snapshot media ${rawId} was not found in this project.`);
      }
    }),
  );
}

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    branch: v.optional(v.string()),
    sequenceId: v.optional(v.string()),
    sequenceName: v.optional(v.string()),
    versionId: v.optional(v.id("projectVersions")),
    sequenceProperties: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectAccess(ctx, args.projectId, "member");
    await validateVersion(ctx, args.versionId, args.projectId);
    const branch = normalizeBranch(args.branch);
    const existing = await ctx.db
      .query("timelineDocs")
      .withIndex("by_project_branch", (q) =>
        q.eq("projectId", args.projectId).eq("branch", branch),
      )
      .first();
    if (existing) return existing._id;

    const now = Date.now();
    const sequenceProperties = validateInitialProperties(args.sequenceProperties);
    if (args.sequenceName !== undefined) {
      sequenceProperties[TIMELINE_SEQUENCE_PROPERTIES.name] = args.sequenceName;
    }
    const document = createTimelineDocument({
      sequenceId: args.sequenceId ?? `sequence:${args.projectId}:${branch}`,
      actorId: user.subject,
      timestamp: now,
      properties: sequenceProperties,
    });
    return await ctx.db.insert("timelineDocs", {
      teamId: project.teamId,
      projectId: args.projectId,
      versionId: args.versionId,
      branch,
      revision: 0,
      document,
      updatedAt: now,
      updatedBy: user.subject,
    });
  },
});

export const get = query({
  args: { timelineDocId: v.id("timelineDocs") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.timelineDocId);
    if (!doc) return null;
    await requireProjectAccess(ctx, doc.projectId, "viewer");
    return doc;
  },
});

export const list = query({
  args: { projectId: v.id("projects"), branch: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, "viewer");
    const rows = args.branch
      ? await ctx.db
          .query("timelineDocs")
          .withIndex("by_project_branch", (q) =>
            q.eq("projectId", args.projectId).eq("branch", normalizeBranch(args.branch)),
          )
          .collect()
      : await ctx.db
          .query("timelineDocs")
          .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
          .collect();
    return rows
      .map((row) => ({
        _id: row._id,
        _creationTime: row._creationTime,
        projectId: row.projectId,
        versionId: row.versionId ?? null,
        branch: row.branch,
        revision: row.revision,
        headSnapshotId: row.headSnapshotId ?? null,
        sequenceId: row.document.sequence.id,
        sequenceName:
          row.document.sequence.properties[TIMELINE_SEQUENCE_PROPERTIES.name]?.value ?? null,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  },
});

export const applyOps = mutation({
  args: {
    timelineDocId: v.id("timelineDocs"),
    ops: v.array(timelineOpValidator),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.timelineDocId);
    if (!doc) throw new Error("Timeline document not found.");
    const { user } = await requireProjectAccess(ctx, doc.projectId, "member");
    if (args.ops.length === 0 || args.ops.length > MAX_OPS_PER_MUTATION) {
      throw new Error(`Operation batches must contain 1 to ${MAX_OPS_PER_MUTATION} items.`);
    }
    const now = Date.now();
    const ops = args.ops as TimelineOp[];
    for (const op of ops) {
      if (op.actorId !== user.subject) {
        throw new Error("Operation actor must match the authenticated user.");
      }
      if (op.timestamp > now + MAX_FUTURE_CLOCK_SKEW_MS) {
        throw new Error("Operation timestamp is too far in the future.");
      }
    }
    await validateOpMedia(ctx, doc.projectId, ops);
    const result = applyTimelineOps(doc.document, ops);
    if (!result.changed) {
      return {
        revision: doc.revision,
        appliedOpIds: result.appliedOpIds,
        updatedAt: doc.updatedAt,
      };
    }
    const revision = doc.revision + 1;
    await ctx.db.patch(doc._id, {
      document: result.document,
      revision,
      updatedAt: now,
      updatedBy: user.subject,
    });
    return { revision, appliedOpIds: result.appliedOpIds, updatedAt: now };
  },
});

export const commit = mutation({
  args: {
    timelineDocId: v.id("timelineDocs"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.timelineDocId);
    if (!doc) throw new Error("Timeline document not found.");
    const { user } = await requireProjectAccess(ctx, doc.projectId, "member");
    const message = args.message.trim();
    if (!message || message.length > 500) {
      throw new Error("Commit message must contain 1 to 500 characters.");
    }
    let parentSnapshotId = doc.headSnapshotId;
    if (!parentSnapshotId) {
      const tip = await ctx.db
        .query("timelineSnapshots")
        .withIndex("by_project_branch", (q) =>
          q.eq("projectId", doc.projectId).eq("branch", doc.branch),
        )
        .order("desc")
        .first();
      parentSnapshotId = tip?._id;
    }
    const cuts = JSON.stringify(doc.document);
    const metadata = JSON.stringify({
      format: "snip.timeline.document",
      schemaVersion: doc.document.schemaVersion,
      timelineDocId: doc._id,
      revision: doc.revision,
    });
    const snapshotId = await ctx.db.insert("timelineSnapshots", {
      teamId: doc.teamId,
      projectId: doc.projectId,
      versionId: doc.versionId,
      cuts,
      color: "{}",
      audio: "{}",
      effects: "{}",
      markers: "{}",
      metadata,
      branch: doc.branch,
      parentSnapshotId,
      message,
      createdByClerkId: user.subject,
      createdByName: identityName(user),
      source: "manual",
      sizeBytes: cuts.length + metadata.length,
    });
    await ctx.db.patch(doc._id, {
      headSnapshotId: snapshotId,
      updatedAt: Date.now(),
      updatedBy: user.subject,
    });
    return { snapshotId, branch: doc.branch, revision: doc.revision };
  },
});

export const restore = mutation({
  args: {
    timelineDocId: v.id("timelineDocs"),
    snapshotId: v.id("timelineSnapshots"),
  },
  handler: async (ctx, args) => {
    const [doc, snapshot] = await Promise.all([
      ctx.db.get(args.timelineDocId),
      ctx.db.get(args.snapshotId),
    ]);
    if (!doc) throw new Error("Timeline document not found.");
    if (!snapshot || snapshot.projectId !== doc.projectId) {
      throw new Error("Timeline snapshot was not found in this project.");
    }
    const { user } = await requireProjectAccess(ctx, doc.projectId, "member");
    const document = parseTimelineDocumentJson(snapshot.cuts);
    await validateDocumentMedia(ctx, doc.projectId, document);
    const revision = doc.revision + 1;
    const now = Date.now();
    await ctx.db.patch(doc._id, {
      document,
      revision,
      headSnapshotId: snapshot._id,
      versionId: snapshot.versionId,
      updatedAt: now,
      updatedBy: user.subject,
    });
    return { revision, branch: doc.branch, snapshotId: snapshot._id };
  },
});

export const remove = mutation({
  args: { timelineDocId: v.id("timelineDocs") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.timelineDocId);
    if (!doc) return null;
    await requireProjectAccess(ctx, doc.projectId, "admin");
    await ctx.db.delete(doc._id);
    return null;
  },
});

function normalizedMediaKeys(value: string | undefined) {
  if (!value) return [];
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the raw value when a source URL contains malformed escaping.
  }
  const normalized = decoded.toLowerCase().split(/[?#]/, 1)[0];
  const base = normalized.split(/[\\/]/).at(-1) ?? normalized;
  const withoutExtension = base.replace(/\.[a-z0-9]{1,8}$/i, "");
  return Array.from(new Set([normalized, base, withoutExtension].filter(Boolean)));
}

function buildMediaLookup(videos: Array<Doc<"videos">>) {
  const lookup = new Map<string, Id<"videos"> | null>();
  for (const video of videos) {
    const values = [String(video._id), video.publicId, video.title, video.s3Key];
    for (const value of values) {
      for (const key of normalizedMediaKeys(value)) {
        if (!lookup.has(key)) {
          lookup.set(key, video._id);
        } else if (lookup.get(key) !== video._id) {
          lookup.set(key, null);
        }
      }
    }
  }
  return (values: Array<string | undefined>) => {
    for (const value of values) {
      for (const key of normalizedMediaKeys(value)) {
        const mediaId = lookup.get(key);
        if (mediaId) return mediaId;
      }
    }
    return undefined;
  };
}

export type TimelineSnapshotImportResult =
  | { status: "created" | "updated"; timelineDocId: Id<"timelineDocs"> }
  | { status: "skipped"; reason: string };

/**
 * Best-effort bridge used by the existing snapshot ingest path. Snapshot
 * insertion remains successful even when an NLE reference cannot be matched.
 */
export async function importSnapshotIntoTimelineDoc(
  ctx: MutationCtx,
  snapshotId: Id<"timelineSnapshots">,
): Promise<TimelineSnapshotImportResult> {
  try {
    const snapshot = await ctx.db.get(snapshotId);
    if (!snapshot?.fcpxml) return { status: "skipped", reason: "No FCPXML payload." };
    const videos = await ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", snapshot.projectId))
      .collect();
    const resolve = buildMediaLookup(videos);
    const timestamp = Date.now();
    const actorId = snapshot.createdByClerkId ?? `plugin:${snapshot.teamId}`;
    const document = fcpxmlToTimelineDocument(snapshot.fcpxml, {
      actorId,
      timestamp,
      resolveMediaId: (reference, clip) => {
        const metadata = reference.metadata as
          | { fcpxml?: { assetId?: string; assetName?: string; sourceUrl?: string } }
          | undefined;
        return resolve([
          reference.OTIO_SCHEMA === "ExternalReference.1"
            ? reference.target_url
            : undefined,
          clip.name,
          metadata?.fcpxml?.assetId,
          metadata?.fcpxml?.assetName,
          metadata?.fcpxml?.sourceUrl,
        ]) as GenericId<"videos"> | undefined;
      },
    });
    const existing = await ctx.db
      .query("timelineDocs")
      .withIndex("by_project_branch", (q) =>
        q.eq("projectId", snapshot.projectId).eq("branch", snapshot.branch),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        document,
        revision: existing.revision + 1,
        headSnapshotId: snapshot._id,
        versionId: snapshot.versionId,
        updatedAt: timestamp,
        updatedBy: actorId,
      });
      return { status: "updated", timelineDocId: existing._id };
    }
    const timelineDocId = await ctx.db.insert("timelineDocs", {
      teamId: snapshot.teamId,
      projectId: snapshot.projectId,
      versionId: snapshot.versionId,
      branch: snapshot.branch,
      revision: 0,
      headSnapshotId: snapshot._id,
      document,
      updatedAt: timestamp,
      updatedBy: actorId,
    });
    return { status: "created", timelineDocId };
  } catch (error) {
    return {
      status: "skipped",
      reason: error instanceof Error ? error.message : "FCPXML import failed.",
    };
  }
}

export const ingestSnapshot = internalMutation({
  args: { snapshotId: v.id("timelineSnapshots") },
  handler: async (ctx, args) => {
    return await importSnapshotIntoTimelineDoc(ctx, args.snapshotId);
  },
});
