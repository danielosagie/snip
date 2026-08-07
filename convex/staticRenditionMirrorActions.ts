"use node";

import { randomBytes } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  buildMuxRenditionDownloadUrl,
  createSignedPlaybackId,
  signPlaybackToken,
} from "./mux";

const SOURCE_TTL_MS = 15 * 60 * 1_000;

type StaticRenditionClaimContext = {
  projectId: Id<"projects">;
  muxAssetId?: string;
  muxSignedPlaybackId?: string;
  renditionName: string;
  destinationKey: string;
  expectedBytes?: number;
  contentType: string;
  r2Key?: string;
};

const getClaimContextRef = makeFunctionReference<
  "query",
  {
    teamId: Id<"teams">;
    videoId: Id<"videos">;
    renditionName: string;
  },
  StaticRenditionClaimContext
>("staticRenditionMirrorJobs:getClaimContext");

export const prepareClaim = internalAction({
  args: {
    teamId: v.id("teams"),
    videoId: v.id("videos"),
    renditionName: v.string(),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(getClaimContextRef, args);
    if (context.r2Key) return context;
    if (!context.muxAssetId) throw new Error("Video has no Mux asset.");

    let playbackId = context.muxSignedPlaybackId;
    if (!playbackId) {
      const created = await createSignedPlaybackId(context.muxAssetId);
      playbackId = created.id;
      await ctx.runMutation(internal.videos.setMuxSignedPlaybackId, {
        videoId: args.videoId,
        muxSignedPlaybackId: playbackId,
      });
    }
    const token = await signPlaybackToken(playbackId, "15m");
    return {
      ...context,
      claimToken: randomBytes(32).toString("hex"),
      sourceUrl: buildMuxRenditionDownloadUrl(
        playbackId,
        context.renditionName,
        token,
      ),
      sourceExpiresAt: Date.now() + SOURCE_TTL_MS,
    };
  },
});
