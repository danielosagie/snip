"use node";

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Visual search, Part B — "describe a person/scene → find the frame".
 *
 * Fast / accurate / free:
 *   - frames come from Mux thumbnails (Mux already hosts the video; the
 *     public playback id serves `image.mux.com/{id}/thumbnail.jpg?time=`
 *     tokenless — no ffmpeg, no storage, no extraction infra)
 *   - captions come from Google Gemini Flash (genuinely free tier, fast,
 *     accurate, zero GPU/infra — just one API key)
 *   - captions are written into the SAME full-text index as Part A
 *     (kind:"frame"), so a description query finds the timestamped frame
 *
 * Key-gated and non-breaking: with no GOOGLE_GENERATIVE_AI_API_KEY this
 * no-ops (same pattern as the Stripe/Mux demo-mode fallbacks), so it can
 * ship now and activate the moment the free key is added. The free tier
 * is rate-limited, so we cap frames/video and pace requests.
 */

const MODEL = "gemini-2.0-flash";
const MAX_FRAMES = 8;
const PACE_MS = 350; // stay comfortably under the free RPM ceiling

const PROMPT =
  "Describe this single video frame in one dense, concrete sentence so it " +
  "is searchable: people (count, appearance, clothing, what they're doing), " +
  "key objects, the setting/location, notable actions, and any visible text " +
  "or logos. No preamble, just the description.";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickTimestamps(duration: number | null): number[] {
  if (!duration || duration <= 1) return [0];
  const n = Math.min(
    MAX_FRAMES,
    Math.max(3, Math.floor(duration / 12)),
  );
  return Array.from({ length: n }, (_, i) =>
    Math.max(0, Math.round(duration * ((i + 0.5) / n))),
  );
}

async function captionFrame(
  apiKey: string,
  playbackId: string,
  sec: number,
): Promise<string | null> {
  const thumbUrl = `https://image.mux.com/${playbackId}/thumbnail.jpg?time=${sec}&width=512&fit_mode=preserve`;
  const img = await fetch(thumbUrl);
  if (!img.ok) {
    console.error("frame captions: thumbnail fetch failed", {
      sec,
      status: img.status,
    });
    return null;
  }
  const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: "image/jpeg", data: b64 } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 160 },
      }),
    },
  );

  if (resp.status === 429) {
    // Free-tier rate limit — signal the caller to back off.
    throw new Error("RATE_LIMIT");
  }
  if (!resp.ok) {
    console.error("frame captions: Gemini error", {
      sec,
      status: resp.status,
      body: (await resp.text()).slice(0, 300),
    });
    return null;
  }
  const json = (await resp.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return text && text.length > 0 ? text : null;
}

export const captionVideo = internalAction({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      console.log(
        "frame captions: GOOGLE_GENERATIVE_AI_API_KEY not set — skipping",
        { videoId: args.videoId },
      );
      return;
    }

    const info = await ctx.runQuery(
      internal.search.getVideoForFrameCaption,
      { videoId: args.videoId },
    );
    if (!info || !info.muxPlaybackId || info.status !== "ready") return;
    // Idempotent / quota-safe: asset.ready can fire more than once.
    if (info.frameCount > 0) return;

    const timestamps = pickTimestamps(info.duration);
    for (const sec of timestamps) {
      try {
        const caption = await captionFrame(apiKey, info.muxPlaybackId, sec);
        if (caption) {
          await ctx.runMutation(internal.search.indexFrameCaption, {
            videoId: args.videoId,
            sec,
            caption,
          });
        }
      } catch (e) {
        if (e instanceof Error && e.message === "RATE_LIMIT") {
          console.warn(
            "frame captions: hit free-tier rate limit, stopping early",
            { videoId: args.videoId, doneUpToSec: sec },
          );
          break;
        }
        console.error("frame captions: frame failed", { sec, error: e });
      }
      await sleep(PACE_MS);
    }
  },
});

/**
 * Backfill — caption the already-ready videos in a project (new uploads
 * are captioned automatically off the Mux asset.ready webhook). Schedules
 * one captionVideo per video, lightly staggered so a big library doesn't
 * slam the free tier. Returns how many were queued.
 */
export const backfillProject = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<{ queued: number }> => {
    const videoIds: Id<"videos">[] = await ctx.runQuery(
      api.search.listReadyVideoIds,
      { projectId: args.projectId },
    );
    let i = 0;
    for (const videoId of videoIds) {
      await ctx.scheduler.runAfter(
        i * 15_000,
        internal.frameCaptions.captionVideo,
        { videoId },
      );
      i++;
    }
    return { queued: videoIds.length };
  },
});
