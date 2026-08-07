import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { identityName, requireProjectAccess } from "./auth";

const MAX_EVENTS_PER_INSERT = 100;
const MAX_PATH_LENGTH = 1_024;
const MAX_HASH_LENGTH = 128;
const MAX_PARSE_ERROR_LENGTH = 500;

const watcherEventValidator = v.object({
  kind: v.union(v.literal("open"), v.literal("save")),
  file: v.string(),
  root: v.string(),
  mtime: v.number(),
  observedAt: v.number(),
  hash: v.string(),
  parseStatus: v.union(
    v.literal("pending"),
    v.literal("parsed"),
    v.literal("saved_timeline_not_parsed"),
    v.literal("not_requested"),
  ),
  parseError: v.optional(v.string()),
});

/**
 * Insert a bounded batch from one authenticated desktop client. Project,
 * team, and user scope are resolved on the server and cannot be supplied by
 * the caller.
 */
export const insert = mutation({
  args: {
    projectId: v.id("projects"),
    clientId: v.string(),
    userName: v.optional(v.string()),
    events: v.array(watcherEventValidator),
  },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    const clientId = args.clientId.trim();
    if (!clientId || clientId.length > 128) {
      throw new Error("Watcher client ID must contain 1 to 128 characters.");
    }
    if (args.events.length === 0 || args.events.length > MAX_EVENTS_PER_INSERT) {
      throw new Error(
        `Watcher batches must contain 1 to ${MAX_EVENTS_PER_INSERT} events.`,
      );
    }

    const userName = args.userName?.trim() || identityName(user);
    const ids = [];
    for (const event of args.events) {
      const file = event.file.trim().slice(0, MAX_PATH_LENGTH);
      const root = event.root.trim().slice(0, MAX_PATH_LENGTH);
      const hash = event.hash.trim().slice(0, MAX_HASH_LENGTH);
      if (!file || !root || !hash) {
        throw new Error("Watcher file, root, and hash are required.");
      }
      if (
        !Number.isFinite(event.mtime) ||
        !Number.isFinite(event.observedAt) ||
        event.mtime < 0 ||
        event.observedAt < 0
      ) {
        throw new Error("Watcher timestamps must be non-negative finite numbers.");
      }
      ids.push(
        await ctx.db.insert("desktopWatcherEvents", {
          projectId: args.projectId,
          teamId: project.teamId,
          clientId,
          userClerkId: user.subject,
          userName,
          kind: event.kind,
          file,
          root,
          mtime: event.mtime,
          observedAt: event.observedAt,
          hash,
          parseStatus: event.parseStatus,
          parseError: event.parseError
            ?.trim()
            .slice(0, MAX_PARSE_ERROR_LENGTH),
        }),
      );
    }
    return { ids };
  },
});

export const listForProject = query({
  args: {
    projectId: v.id("projects"),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, "viewer");
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 100)));
    const since = args.since ?? 0;
    return await ctx.db
      .query("desktopWatcherEvents")
      .withIndex("by_project_time", (q) =>
        q.eq("projectId", args.projectId).gte("observedAt", since),
      )
      .order("desc")
      .take(limit);
  },
});
