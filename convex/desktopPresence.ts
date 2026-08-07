import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { identityName, requireProjectAccess, requireTeamAccess } from "./auth";

const WATCHER_CLIENT_SUFFIX = ":watcher";
const WATCHER_PROCESS_PREFIX = "snip-watcher:";
const WATCHER_EVENT_RETENTION_MS = 15 * 60 * 1000;
const MAX_WATCHER_EVENTS = 100;

const watcherEventValidator = v.object({
  kind: v.union(v.literal("open"), v.literal("save")),
  file: v.string(),
  root: v.string(),
  user: v.string(),
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

type WatcherEvent = {
  kind: "open" | "save";
  file: string;
  root: string;
  user: string;
  mtime: number;
  observedAt: number;
  hash: string;
  parseStatus:
    | "pending"
    | "parsed"
    | "saved_timeline_not_parsed"
    | "not_requested";
  parseError?: string;
};

async function authorizePresenceScope(
  ctx: Parameters<typeof requireProjectAccess>[0],
  projectId?: Parameters<typeof requireProjectAccess>[1],
  teamId?: Parameters<typeof requireTeamAccess>[1],
) {
  if (projectId) {
    const { project } = await requireProjectAccess(ctx, projectId);
    if (teamId && project.teamId !== teamId) {
      throw new Error("Project does not belong to the supplied team.");
    }
    return project.teamId;
  }
  if (teamId) await requireTeamAccess(ctx, teamId);
  return teamId;
}

function watcherEventKey(event: WatcherEvent) {
  return [event.kind, event.root, event.file, event.mtime, event.hash].join(":");
}

function encodeWatcherEvent(event: WatcherEvent) {
  return WATCHER_PROCESS_PREFIX + JSON.stringify(event);
}

function decodeWatcherEvent(process?: string): WatcherEvent | null {
  if (!process?.startsWith(WATCHER_PROCESS_PREFIX)) return null;
  try {
    const value = JSON.parse(process.slice(WATCHER_PROCESS_PREFIX.length)) as WatcherEvent;
    if (
      (value.kind !== "open" && value.kind !== "save") ||
      typeof value.file !== "string" ||
      typeof value.root !== "string" ||
      typeof value.user !== "string" ||
      typeof value.mtime !== "number" ||
      typeof value.observedAt !== "number" ||
      typeof value.hash !== "string"
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * The desktop app polls `lsof` against its mount path and upserts the
 * current set of open files for its `clientId`. We key by clientId
 * (not userClerkId) so the same user running snip Desktop on a laptop
 * + a workstation shows up as two presences, not one merged row.
 *
 * Authorization:
 * - Caller must be authenticated.
 * - If a projectId is supplied, the caller must have access to that
 *   project — otherwise a user could pollute a stranger's project
 *   presence by guessing its ID.
 * - Patching an existing row requires the caller to own it (matches
 *   on userClerkId). Defensive — clientId is 8 random bytes so
 *   collision is extremely unlikely, but stops one client from
 *   overwriting another's presence by reusing its clientId.
 */
export const upsertLocks = mutation({
  args: {
    clientId: v.string(),
    userName: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    teamId: v.optional(v.id("teams")),
    mountPath: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        process: v.optional(v.string()),
        pid: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    const teamId = await authorizePresenceScope(ctx, args.projectId, args.teamId);

    const existing = await ctx.db
      .query("desktopFileLocks")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .first();

    const payload = {
      clientId: args.clientId,
      userClerkId: identity.subject,
      userName: args.userName,
      projectId: args.projectId,
      teamId,
      mountPath: args.mountPath,
      files: args.files,
      lastSeen: Date.now(),
    };

    if (existing) {
      if (existing.userClerkId !== identity.subject) {
        throw new Error("Forbidden: clientId belongs to a different user.");
      }
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return ctx.db.insert("desktopFileLocks", payload);
  },
});

/**
 * Legacy watcher transport retained for explicitly flagged fallback only.
 * New desktop clients publish through desktopWatcherEvents:insert.
 */
export const publishWatcherEvents = mutation({
  args: {
    clientId: v.string(),
    userName: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    teamId: v.optional(v.id("teams")),
    mountPath: v.string(),
    events: v.array(watcherEventValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    const teamId = await authorizePresenceScope(ctx, args.projectId, args.teamId);
    const watcherClientId = `${args.clientId}${WATCHER_CLIENT_SUFFIX}`;
    const existing = await ctx.db
      .query("desktopFileLocks")
      .withIndex("by_client", (q) => q.eq("clientId", watcherClientId))
      .first();
    if (existing && existing.userClerkId !== identity.subject) {
      throw new Error("Forbidden: clientId belongs to a different user.");
    }

    const user = args.userName?.trim() || identityName(identity);
    const recent = (existing?.files ?? [])
      .map((file) => decodeWatcherEvent(file.process))
      .filter((event): event is WatcherEvent => event !== null);
    const merged = new Map(recent.map((event) => [watcherEventKey(event), event]));
    for (const incoming of args.events) {
      const event: WatcherEvent = {
        ...incoming,
        file: incoming.file.slice(0, 1024),
        root: incoming.root.slice(0, 1024),
        user,
        hash: incoming.hash.slice(0, 128),
        ...(incoming.parseError
          ? { parseError: incoming.parseError.slice(0, 500) }
          : {}),
      };
      merged.set(watcherEventKey(event), event);
    }
    const events = [...merged.values()]
      .sort((left, right) => right.observedAt - left.observedAt)
      .slice(0, MAX_WATCHER_EVENTS);
    const payload = {
      clientId: watcherClientId,
      userClerkId: identity.subject,
      userName: user,
      projectId: args.projectId,
      teamId,
      mountPath: args.mountPath.slice(0, 1024),
      files: events.map((event) => ({
        path: event.file,
        process: encodeWatcherEvent(event),
      })),
      lastSeen: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return ctx.db.insert("desktopFileLocks", payload);
  },
});

/**
 * Presence is sensitive (it leaks which files a teammate has open,
 * incl. unreleased contract drafts). Restrict reads to members of the
 * project's team — same gate as projects:get and friends.
 */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    try {
      // Throws "Project not found" or a 403-equivalent on miss.
      await requireProjectAccess(ctx, args.projectId);
    } catch {
      return [];
    }
    const cutoff = Date.now() - 30_000;
    const rows = await ctx.db
      .query("desktopFileLocks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return rows.filter((r) => r.lastSeen > cutoff);
  },
});

export const listWatcherEventsForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    try {
      await requireProjectAccess(ctx, args.projectId);
    } catch {
      return [];
    }
    const cutoff = Date.now() - WATCHER_EVENT_RETENTION_MS;
    const rows = await ctx.db
      .query("desktopFileLocks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return rows
      .filter(
        (row) =>
          row.clientId.endsWith(WATCHER_CLIENT_SUFFIX) && row.lastSeen > cutoff,
      )
      .flatMap((row) =>
        row.files.flatMap((file) => {
          const event = decodeWatcherEvent(file.process);
          return event && event.observedAt > cutoff
            ? [
                {
                  ...event,
                  clientId: row.clientId.slice(0, -WATCHER_CLIENT_SUFFIX.length),
                },
              ]
            : [];
        }),
      )
      .sort((left, right) => right.observedAt - left.observedAt);
  },
});

export const clearLocks = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    const existing = await ctx.db
      .query("desktopFileLocks")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .first();
    if (existing && existing.userClerkId === identity.subject) {
      await ctx.db.delete(existing._id);
    }
    const watcher = await ctx.db
      .query("desktopFileLocks")
      .withIndex("by_client", (q) =>
        q.eq("clientId", `${args.clientId}${WATCHER_CLIENT_SUFFIX}`),
      )
      .first();
    if (watcher && watcher.userClerkId === identity.subject) {
      await ctx.db.delete(watcher._id);
    }
  },
});
