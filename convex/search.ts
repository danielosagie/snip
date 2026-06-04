import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  MutationCtx,
} from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireUser, requireProjectAccess } from "./auth";

/**
 * Global full-text search.
 *
 * `searchableContent` is a denormalized index table. Content mutations
 * dual-write into it (best-effort) via `indexSearchable` / `removeSearchable`
 * and `reindexAll` backfills anything missed. The ⌘K palette calls
 * `globalSearch`, scoped to the teams the caller belongs to, so a word
 * *inside* a document or comment is findable — not just titles.
 *
 * Convex full-text search: relevance-ranked, typo-tolerant, prefix on the
 * last term. One `searchField` ("text"); we pack title + body into it.
 */

type Kind = "video" | "document" | "comment" | "frame" | "transcript";

export function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Upsert one searchable row, keyed by (kind, refId). Plain helper so the
 *  existing mutations can dual-write inside their own handlers. */
export async function indexSearchable(
  ctx: MutationCtx,
  args: {
    kind: Kind;
    refId: string;
    teamId: Id<"teams">;
    projectId?: Id<"projects">;
    videoId?: Id<"videos">;
    title: string;
    contextLabel: string;
    text: string;
  },
): Promise<void> {
  const team = await ctx.db.get(args.teamId);
  if (!team) return;
  // Cap stored text — search relevance doesn't need megabytes, and it
  // keeps the index lean.
  const text = `${args.title} ${args.text}`.slice(0, 12000);
  const existing = await ctx.db
    .query("searchableContent")
    .withIndex("by_ref", (q) =>
      q.eq("kind", args.kind).eq("refId", args.refId),
    )
    .unique();
  const row = {
    teamId: args.teamId,
    teamSlug: team.slug,
    projectId: args.projectId,
    videoId: args.videoId,
    kind: args.kind,
    refId: args.refId,
    title: args.title.slice(0, 300),
    contextLabel: args.contextLabel.slice(0, 200),
    text,
  };
  if (existing) {
    await ctx.db.patch(existing._id, row);
  } else {
    await ctx.db.insert("searchableContent", row);
  }
}

export async function removeSearchable(
  ctx: MutationCtx,
  kind: Kind,
  refId: string,
): Promise<void> {
  const existing = await ctx.db
    .query("searchableContent")
    .withIndex("by_ref", (q) => q.eq("kind", kind).eq("refId", refId))
    .collect();
  for (const r of existing) await ctx.db.delete(r._id);
}

/** Drop every searchable row tied to a video (the video row + its frame
 *  caption rows). Used when a video is trashed so nothing stale lingers. */
export async function removeSearchableForVideo(
  ctx: MutationCtx,
  videoId: Id<"videos">,
): Promise<void> {
  const rows = await ctx.db
    .query("searchableContent")
    .withIndex("by_video", (q) => q.eq("videoId", videoId))
    .collect();
  for (const r of rows) await ctx.db.delete(r._id);
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Internal query for the (Node) frame-caption pipeline — actions can't
 * touch the db directly. Returns just what the captioner needs plus the
 * count of frames already indexed (so it can skip re-captioning and not
 * burn the free Gemini quota).
 */
export const getVideoForFrameCaption = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.deletedAt) return null;
    const project = await ctx.db.get(video.projectId);
    if (!project) return null;
    const existingFrames = await ctx.db
      .query("searchableContent")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();
    return {
      muxPlaybackId: video.muxPlaybackId ?? null,
      muxAssetId: video.muxAssetId ?? null,
      duration: video.duration ?? null,
      status: video.status,
      title: video.title,
      projectId: video.projectId,
      teamId: project.teamId,
      projectName: project.name,
      frameCount: existingFrames.filter((r) => r.kind === "frame").length,
    };
  },
});

/** Authenticated: ready, non-deleted videos in a project — drives the
 *  frame-caption backfill. requireProjectAccess gates who can trigger it. */
export const listReadyVideoIds = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<Id<"videos">[]> => {
    await requireProjectAccess(ctx, args.projectId);
    const videos = await ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return videos
      .filter((vd) => !vd.deletedAt && vd.status === "ready" && vd.muxPlaybackId)
      .map((vd) => vd._id);
  },
});

/** Internal mutation the Node caption action calls per frame. */
export const indexFrameCaption = internalMutation({
  args: {
    videoId: v.id("videos"),
    sec: v.number(),
    caption: v.string(),
  },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.deletedAt) return;
    const project = await ctx.db.get(video.projectId);
    if (!project) return;
    await indexSearchable(ctx, {
      kind: "frame",
      refId: `${args.videoId}:${Math.round(args.sec)}`,
      teamId: project.teamId,
      projectId: video.projectId,
      videoId: args.videoId,
      title: `${video.title} @ ${mmss(args.sec)}`,
      contextLabel: `${project.name} · ${video.title} · frame ${mmss(args.sec)}`,
      text: args.caption,
    });
  },
});

/** Internal mutation the (Node) transcript action calls per ~window of
 *  spoken audio, so the actual words said in the video are searchable. */
export const indexTranscriptCue = internalMutation({
  args: {
    videoId: v.id("videos"),
    sec: v.number(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video || video.deletedAt) return;
    const project = await ctx.db.get(video.projectId);
    if (!project) return;
    await indexSearchable(ctx, {
      kind: "transcript",
      refId: `${args.videoId}:t:${Math.round(args.sec)}`,
      teamId: project.teamId,
      projectId: video.projectId,
      videoId: args.videoId,
      title: `${video.title} — said @ ${mmss(args.sec)}`,
      contextLabel: `${project.name} · ${video.title} · transcript ${mmss(args.sec)}`,
      text: args.text,
    });
  },
});

/**
 * Ordered transcript cues for a single video. The transcript action
 * writes one row per ~45s window into `searchableContent` with
 * `kind:"transcript"`; we surface them here as `[{ start, text }]`
 * for the in-app transcript panel beside the player.
 *
 * `start` is recovered from the refId pattern `${videoId}:t:${sec}`
 * written by `indexTranscriptCue`.
 */
export const getCuesForVideo = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args): Promise<Array<{ start: number; text: string }>> => {
    const user = await requireUser(ctx);
    const video = await ctx.db.get(args.videoId);
    if (!video) return [];
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userClerkId", user.subject))
      .collect();
    const project = await ctx.db.get(video.projectId);
    if (!project) return [];
    if (!memberships.some((m) => m.teamId === project.teamId)) return [];

    const rows = await ctx.db
      .query("searchableContent")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();
    const cues: Array<{ start: number; text: string }> = [];
    for (const row of rows) {
      if (row.kind !== "transcript") continue;
      const parts = row.refId.split(":t:");
      if (parts.length !== 2) continue;
      const start = Number(parts[1]);
      if (!Number.isFinite(start)) continue;
      cues.push({ start, text: row.text });
    }
    cues.sort((a, b) => a.start - b.start);
    return cues;
  },
});

function snippet(text: string, q: string): string {
  const lower = text.toLowerCase();
  const term = q.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const at = term ? lower.indexOf(term) : -1;
  if (at < 0) return text.slice(0, 160);
  const start = Math.max(0, at - 60);
  return (start > 0 ? "…" : "") + text.slice(start, start + 180).trim() + "…";
}

export const globalSearch = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const q = args.query.trim();
    if (q.length < 2) return [];
    const user = await requireUser(ctx);
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (qq) => qq.eq("userClerkId", user.subject))
      .collect();
    const allowed = new Set(memberships.map((m) => m.teamId));
    if (allowed.size === 0) return [];

    const qLower = q.toLowerCase();

    // Fuzzy: Convex full-text — relevance-ranked, typo-tolerant, prefix.
    const fuzzy = await ctx.db
      .query("searchableContent")
      .withSearchIndex("by_text", (s) => s.search("text", q))
      .take(40);

    // Exact: the fuzzy index can't reliably match exact words, filenames (with
    // _ . etc.), or multi-word phrases — so ALSO scan each team's rows and keep
    // true substring hits (title or body). Bounded so a keystroke stays cheap;
    // covers the most recent ~budget rows per team.
    const exact: typeof fuzzy = [];
    let budget = 2400;
    for (const teamId of allowed) {
      if (budget <= 0) break;
      const rows = await ctx.db
        .query("searchableContent")
        .withIndex("by_team", (qq) => qq.eq("teamId", teamId))
        .order("desc")
        .take(Math.min(budget, 1600));
      budget -= rows.length;
      for (const r of rows) {
        if (
          r.text.toLowerCase().includes(qLower) ||
          r.title.toLowerCase().includes(qLower)
        ) {
          exact.push(r);
        }
      }
    }

    // Merge exact-first (most precise), then fuzzy; dedupe by source row.
    const seen = new Set<string>();
    const hits: typeof fuzzy = [];
    for (const h of [...exact, ...fuzzy]) {
      const key = `${h.kind}:${h.refId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(h);
    }

    return hits
      .filter((h) => allowed.has(h.teamId))
      .filter((h) => {
        // Defensive: a small number of rows in `searchableContent` were
        // written by an earlier indexer that stored a contractVersion
        // (or other non-project) ID in the `projectId` column. When the
        // client clicks one, `workspace.resolveContext({ projectId })`
        // rejects on `v.id("projects")` and crashes the whole search.
        // Skip those rows so the rest of the results still render. The
        // proper cleanup is a `reindexProject` sweep — this is the
        // run-time backstop.
        if (h.projectId == null) return true;
        return ctx.db.normalizeId("projects", h.projectId) !== null;
      })
      .filter((h) => {
        if (h.videoId == null) return true;
        return ctx.db.normalizeId("videos", h.videoId) !== null;
      })
      .slice(0, 14)
      .map((h) => {
        // frame refId = `${videoId}:${sec}`, transcript = `${videoId}:t:${sec}`
        // → the trailing segment is the timestamp to deep-link to.
        let timestampSec: number | null = null;
        if (h.kind === "frame" || h.kind === "transcript") {
          const last = h.refId.split(":").pop();
          const n = last ? Number(last) : NaN;
          timestampSec = Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
        }
        return {
          kind: h.kind,
          title: h.title,
          contextLabel: h.contextLabel,
          snippet: snippet(h.text, q),
          teamSlug: h.teamSlug,
          projectId: h.projectId ?? null,
          videoId: h.videoId ?? null,
          refId: h.refId,
          timestampSec,
        };
      });
  },
});

/**
 * Backfill / rebuild the index for one project's content (video titles,
 * contract document text + clause bodies, comments). Idempotent. Run per
 * project so a single call stays within Convex mutation limits; the ⌘K
 * UI / a maintenance screen can sweep all projects the caller can access.
 */
export const reindexProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(ctx, args.projectId);
    const teamId = project.teamId;
    let indexed = 0;

    const videos = await ctx.db
      .query("videos")
      .withIndex("by_project", (qq) => qq.eq("projectId", args.projectId))
      .collect();
    for (const vid of videos) {
      if (vid.deletedAt) {
        await removeSearchable(ctx, "video", vid._id);
        continue;
      }
      await indexSearchable(ctx, {
        kind: "video",
        refId: vid._id,
        teamId,
        projectId: args.projectId,
        videoId: vid._id,
        title: vid.title,
        contextLabel: `${project.name} · ${vid.contentType ?? "file"}`,
        text: `${vid.title} ${vid.description ?? ""}`,
      });
      indexed++;
    }

    if (project.contract) {
      const clauseText = (project.contract.clauses ?? [])
        .map((c) => `${c.title} ${stripHtml(c.bodyHtml)}`)
        .join(" \n ");
      await indexSearchable(ctx, {
        kind: "document",
        refId: args.projectId,
        teamId,
        projectId: args.projectId,
        title: `${project.name} — contract`,
        contextLabel: `${project.name} · Contract`,
        text: `${stripHtml(project.contract.contentHtml)} ${clauseText}`,
      });
      indexed++;
    } else {
      await removeSearchable(ctx, "document", args.projectId);
    }

    for (const vid of videos) {
      const comments = await ctx.db
        .query("comments")
        .withIndex("by_video", (qq) => qq.eq("videoId", vid._id))
        .collect();
      for (const c of comments) {
        await indexSearchable(ctx, {
          kind: "comment",
          refId: c._id,
          teamId,
          projectId: args.projectId,
          videoId: vid._id,
          title: `Comment on ${vid.title}`,
          contextLabel: `${project.name} · ${vid.title}`,
          text: c.text,
        });
        indexed++;
      }
    }

    return { indexed };
  },
});

// Diagnostic: how much is actually indexed, by kind. Reveals an empty index
// (nothing dual-written / reindexed) or a missing visual layer (frame == 0,
// i.e. the Gemini caption pipeline never ran).
export const searchStats = internalQuery({
  args: {},
  returns: v.object({
    total: v.number(),
    video: v.number(),
    document: v.number(),
    comment: v.number(),
    frame: v.number(),
    transcript: v.number(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("searchableContent").take(20000);
    const out = {
      total: rows.length,
      video: 0,
      document: 0,
      comment: 0,
      frame: 0,
      transcript: 0,
    };
    for (const r of rows) {
      if (r.kind in out) out[r.kind as "video"]++;
    }
    return out;
  },
});
