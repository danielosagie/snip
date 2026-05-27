import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { identityName, identityAvatarUrl, identityEmail, requireUser } from "./auth";
import { isFeatureEnabled } from "./featureFlags";

/**
 * Demo helpers. None of these are intended for production — they bypass the
 * normal Mux/Stripe flow so the app is clickable without external services
 * configured. Each helper guards itself behind a check that the relevant
 * external service is NOT configured, so once you wire up real Stripe/Mux
 * these become no-ops.
 *
 * The point of demo mode is: a fresh fork + Convex + Clerk = a working app
 * you can navigate end-to-end, including paywalled-share unlock UX.
 */

// Mux's well-known public test asset. Anyone can stream this from the public
// Mux CDN without authentication. Used as a placeholder video so the player
// has something to render in demo mode.
const DEMO_MUX_PLAYBACK_ID = "DS00Spx1CV902MCtPj5WknGlR102V5HFkDe";
const DEMO_THUMBNAIL = `https://image.mux.com/${DEMO_MUX_PLAYBACK_ID}/thumbnail.jpg?time=1`;

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

/**
 * Status query the UI uses to decide whether to show "seed demo data" /
 * "simulate payment" affordances.
 */
export const isDemoMode = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    stripeConfigured: v.boolean(),
    muxConfigured: v.boolean(),
    storageConfigured: v.boolean(),
  }),
  handler: async () => {
    const stripeConfigured = isFeatureEnabled("stripeBilling");
    const muxConfigured = isFeatureEnabled("muxIngest");
    const storageConfigured = isFeatureEnabled("objectStorage");
    // Only flag demo mode when *nothing* is configured (fresh fork). If
    // the user has even one of stripe/mux/storage wired up, they're past
    // the "just exploring" phase — feature-specific UI elsewhere handles
    // the remaining gaps inline (storage warning on contract upload,
    // etc). The old `||` threshold yelled at users mid-setup.
    const enabled = !stripeConfigured && !muxConfigured && !storageConfigured;
    return { enabled, stripeConfigured, muxConfigured, storageConfigured };
  },
});

/**
 * One-click seed: creates a team if the user has none, one project, and two
 * sample videos that point at Mux's public test asset. Safe to call multiple
 * times — it short-circuits if data already exists.
 */
export const seedDemoData = mutation({
  args: {},
  returns: v.object({
    teamId: v.id("teams"),
    teamSlug: v.string(),
    projectId: v.id("projects"),
    createdVideos: v.number(),
    createdShareLink: v.union(v.id("shareLinks"), v.null()),
  }),
  handler: async (
    ctx,
  ): Promise<{
    teamId: Id<"teams">;
    teamSlug: string;
    projectId: Id<"projects">;
    createdVideos: number;
    createdShareLink: Id<"shareLinks"> | null;
  }> => {
    const user = await requireUser(ctx);

    // Find or create a team owned by this user.
    let team = await ctx.db
      .query("teams")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", user.subject))
      .first();

    if (!team) {
      let slug = generateSlug("Demo Studio");
      let counter = 1;
      while (
        await ctx.db
          .query("teams")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .unique()
      ) {
        slug = `${generateSlug("Demo Studio")}-${counter++}`;
      }
      const newTeamId = await ctx.db.insert("teams", {
        name: "Demo Studio",
        slug,
        ownerClerkId: user.subject,
        plan: "basic",
        billingStatus: "demo",
      });
      await ctx.db.insert("teamMembers", {
        teamId: newTeamId,
        userClerkId: user.subject,
        userEmail: normalizedEmail(identityEmail(user)),
        userName: identityName(user),
        userAvatarUrl: identityAvatarUrl(user),
        role: "owner",
      });
      team = await ctx.db.get(newTeamId);
      if (!team) throw new Error("Failed to create demo team");
    }

    // Find or create a project.
    let project = await ctx.db
      .query("projects")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .first();
    if (!project) {
      const projectId = await ctx.db.insert("projects", {
        teamId: team._id,
        name: "Brand Launch Video",
        description: "Sample project for clicking through the app.",
      });
      project = await ctx.db.get(projectId);
      if (!project) throw new Error("Failed to create demo project");
    }

    // Seed two sample videos pointing at Mux's public test asset.
    const samples = [
      {
        title: "Sample delivery v1 (rough cut)",
        description: "First-pass edit. Pretend you're reviewing this.",
      },
      {
        title: "Sample delivery v2 (final)",
        description: "Final color + audio. Locked.",
      },
    ];
    let createdVideos = 0;
    let firstVideoId: Id<"videos"> | null = null;
    for (const sample of samples) {
      const existing = await ctx.db
        .query("videos")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .filter((q) => q.eq(q.field("title"), sample.title))
        .first();
      if (existing) {
        firstVideoId = firstVideoId ?? existing._id;
        continue;
      }
      const publicId = `demo-${Math.random().toString(36).slice(2, 12)}`;
      const videoId = await ctx.db.insert("videos", {
        projectId: project._id,
        uploadedByClerkId: user.subject,
        uploaderName: identityName(user),
        title: sample.title,
        description: sample.description,
        visibility: "public",
        publicId,
        muxPlaybackId: DEMO_MUX_PLAYBACK_ID,
        muxAssetId: `demo-asset-${publicId}`,
        muxAssetStatus: "ready",
        thumbnailUrl: DEMO_THUMBNAIL,
        duration: 596, // Big Buck Bunny test asset, ~10min
        fileSize: 1024 * 1024 * 100,
        contentType: "video/mp4",
        status: "ready",
        workflowStatus: "review",
      });
      firstVideoId = firstVideoId ?? videoId;
      createdVideos++;
    }

    // Create a paywalled share link on the first video so the user can see
    // the preview/paid swap. Skip if any share link already exists for that
    // video to keep this idempotent.
    let createdShareLink: Id<"shareLinks"> | null = null;
    if (firstVideoId) {
      const existingLink = await ctx.db
        .query("shareLinks")
        .withIndex("by_video", (q) => q.eq("videoId", firstVideoId!))
        .first();
      if (!existingLink) {
        const token = Array.from({ length: 32 }, () =>
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
            Math.floor(Math.random() * 62),
          ),
        ).join("");
        createdShareLink = await ctx.db.insert("shareLinks", {
          videoId: firstVideoId,
          token,
          createdByClerkId: user.subject,
          createdByName: identityName(user),
          allowDownload: true,
          viewCount: 0,
          paywall: {
            priceCents: 50000,
            currency: "usd",
            description: "Final delivery — paywalled demo",
          },
          clientLabel: "demo client",
          clientEmail: "client@example.com",
        });
        // For demo: pretend the preview asset is the same as the public one
        // and signed playback uses the same public ID. Real flow creates a
        // separate Mux asset with watermark + signed policy.
        await ctx.db.patch(firstVideoId, {
          muxPreviewPlaybackId: DEMO_MUX_PLAYBACK_ID,
          muxPreviewAssetId: `demo-preview-${firstVideoId}`,
          muxPreviewAssetStatus: "ready",
          muxSignedPlaybackId: DEMO_MUX_PLAYBACK_ID,
        });
      }
    }

    return {
      teamId: team._id,
      teamSlug: team.slug,
      projectId: project._id,
      createdVideos,
      createdShareLink,
    };
  },
});

/**
 * Inverse of seedDemoData. Wipes every Demo Studio team owned by the
 * current user along with its projects, videos, folders, share
 * links, and timeline snapshots. Cautious: only touches teams whose
 * slug starts with `demo-studio` (the slugifier output for "Demo
 * Studio"), so user-created data is never collateral damage.
 *
 * Intended for the dev-mode toggle on the home page so reviewers can
 * test the seed → clear loop without leaving the UI.
 */
export const clearDemoData = mutation({
  args: {},
  returns: v.object({
    deletedTeams: v.number(),
    deletedProjects: v.number(),
    deletedVideos: v.number(),
  }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const ownedTeams = await ctx.db
      .query("teams")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", user.subject))
      .collect();
    const demoTeams = ownedTeams.filter(
      (t) =>
        t.slug.startsWith("demo-studio") ||
        t.name.toLowerCase() === "demo studio",
    );

    let deletedProjects = 0;
    let deletedVideos = 0;

    for (const team of demoTeams) {
      // Projects → videos, folders, comments, share grants, snapshots.
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_team", (q) => q.eq("teamId", team._id))
        .collect();
      for (const project of projects) {
        const videos = await ctx.db
          .query("videos")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();
        for (const video of videos) {
          // Comments
          const comments = await ctx.db
            .query("comments")
            .withIndex("by_video", (q) => q.eq("videoId", video._id))
            .collect();
          for (const c of comments) await ctx.db.delete(c._id);
          // Share links
          const links = await ctx.db
            .query("shareLinks")
            .withIndex("by_video", (q) => q.eq("videoId", video._id))
            .collect();
          for (const l of links) await ctx.db.delete(l._id);
          await ctx.db.delete(video._id);
          deletedVideos++;
        }
        const folders = await ctx.db
          .query("folders")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();
        for (const f of folders) await ctx.db.delete(f._id);
        await ctx.db.delete(project._id);
        deletedProjects++;
      }

      // Team members + invites.
      const members = await ctx.db
        .query("teamMembers")
        .withIndex("by_team", (q) => q.eq("teamId", team._id))
        .collect();
      for (const m of members) await ctx.db.delete(m._id);
      const invites = await ctx.db
        .query("teamInvites")
        .withIndex("by_team", (q) => q.eq("teamId", team._id))
        .collect();
      for (const i of invites) await ctx.db.delete(i._id);

      await ctx.db.delete(team._id);
    }

    return {
      deletedTeams: demoTeams.length,
      deletedProjects,
      deletedVideos,
    };
  },
});

/**
 * Simulates a successful payment without going through Stripe. Sets paidAt
 * on the grant and returns immediately. Guarded — only works when Stripe
 * isn't configured.
 */
/**
 * Demo-mode simulator for the Canva-style per-video paywall. Inserts a
 * succeeded `payments` row keyed on (videoId, clientEmail) without going
 * through Stripe. Guarded — only works when Stripe isn't configured.
 */
export const simulatePaymentForVideo = mutation({
  args: {
    videoId: v.id("videos"),
    clientEmail: v.optional(v.string()),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("stripeIsConfigured"),
      v.literal("noPaywall"),
      v.literal("videoNotFound"),
      v.literal("alreadyPaid"),
    ),
  }),
  handler: async (ctx, args) => {
    if (isFeatureEnabled("stripeConnect")) {
      return { status: "stripeIsConfigured" as const };
    }
    const video = await ctx.db.get(args.videoId);
    if (!video) return { status: "videoNotFound" as const };
    if (!video.paywall) return { status: "noPaywall" as const };
    const project = await ctx.db.get(video.projectId);
    if (!project) return { status: "videoNotFound" as const };

    const user = await ctx.auth.getUserIdentity();
    const email =
      args.clientEmail?.trim().toLowerCase() ||
      (typeof user?.email === "string"
        ? (user.email as string).toLowerCase()
        : "demo@example.com");

    const existing = await ctx.db
      .query("payments")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();
    const dup = existing.find(
      (p) =>
        p.status === "succeeded" &&
        p.clientEmail &&
        p.clientEmail.toLowerCase() === email,
    );
    if (dup) return { status: "alreadyPaid" as const };

    const now = Date.now();
    await ctx.db.insert("payments", {
      teamId: project.teamId,
      videoId: args.videoId,
      clientEmail: email,
      amountCents: video.paywall.priceCents,
      currency: video.paywall.currency,
      stripeCheckoutSessionId: `demo_${args.videoId}_${now}`,
      stripeConnectAccountId: "demo-account",
      status: "succeeded",
      paidAt: now,
    });
    return { status: "ok" as const };
  },
});
