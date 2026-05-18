import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
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

type Kind = "video" | "document" | "comment" | "frame";

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

    const hits = await ctx.db
      .query("searchableContent")
      .withSearchIndex("by_text", (s) => s.search("text", q))
      .take(40);

    return hits
      .filter((h) => allowed.has(h.teamId))
      .slice(0, 14)
      .map((h) => ({
        kind: h.kind,
        title: h.title,
        contextLabel: h.contextLabel,
        snippet: snippet(h.text, q),
        teamSlug: h.teamSlug,
        projectId: h.projectId ?? null,
        videoId: h.videoId ?? null,
        refId: h.refId,
      }));
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
