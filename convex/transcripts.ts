"use node";

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addGeneratedSubtitles } from "./mux";

/**
 * Actual-content search — the *spoken words* of a video.
 *
 * Mux auto-transcribes each asset's audio into a WebVTT text track
 * (requested via generated_subtitles at create time, or backfilled).
 * When the track is ready the Mux webhook schedules this action: we
 * fetch the VTT, chunk it into ~45s windows, and write each window into
 * the SAME full-text index (kind:"transcript"), so searching a phrase
 * someone *said* finds the video at roughly that moment.
 *
 * Free (Mux ASR is part of the asset), accurate, timestamped — no extra
 * API, no key, complementary to the visual frame captions.
 */

const WINDOW_SECONDS = 45;
const MAX_WINDOWS = 240; // safety cap for very long videos

interface Cue {
  start: number;
  text: string;
}

function tsToSeconds(ts: string): number {
  // Accept HH:MM:SS.mmm or MM:SS.mmm
  const parts = ts.trim().replace(",", ".").split(":");
  let h = 0,
    m = 0,
    s = 0;
  if (parts.length === 3) {
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
    s = parseFloat(parts[2]);
  } else if (parts.length === 2) {
    m = parseInt(parts[0], 10);
    s = parseFloat(parts[1]);
  }
  return h * 3600 + m * 60 + (Number.isFinite(s) ? s : 0);
}

function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = vtt.replace(/\r/g, "").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    const timingLine = lines.find((l) => l.includes("-->"));
    if (!timingLine) continue;
    const start = timingLine.split("-->")[0];
    const textLines = lines
      .filter((l) => l !== timingLine && !/^WEBVTT/i.test(l) && !/^\d+$/.test(l))
      .map((l) =>
        l
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .trim(),
      )
      .filter((l) => l.length > 0);
    if (textLines.length === 0) continue;
    cues.push({ start: tsToSeconds(start), text: textLines.join(" ") });
  }
  return cues;
}

export const indexTranscript = internalAction({
  args: { videoId: v.id("videos"), trackId: v.string() },
  handler: async (ctx, args) => {
    const info = await ctx.runQuery(internal.search.getVideoForFrameCaption, {
      videoId: args.videoId,
    });
    if (!info || !info.muxPlaybackId || info.status !== "ready") return;

    const vttUrl = `https://stream.mux.com/${info.muxPlaybackId}/text/${args.trackId}.vtt`;
    const resp = await fetch(vttUrl);
    if (!resp.ok) {
      console.error("transcript: VTT fetch failed", {
        videoId: args.videoId,
        status: resp.status,
      });
      return;
    }
    const cues = parseVtt(await resp.text());
    if (cues.length === 0) return;

    // Coalesce cues into ~WINDOW_SECONDS windows so a hit maps to a
    // useful timestamp without creating thousands of tiny rows.
    let windowStart = cues[0].start;
    let buf: string[] = [];
    let windows = 0;
    const flush = async () => {
      const text = buf.join(" ").trim();
      if (text.length > 0 && windows < MAX_WINDOWS) {
        await ctx.runMutation(internal.search.indexTranscriptCue, {
          videoId: args.videoId,
          sec: windowStart,
          text,
        });
        windows++;
      }
      buf = [];
    };

    for (const cue of cues) {
      if (cue.start - windowStart >= WINDOW_SECONDS && buf.length > 0) {
        await flush();
        windowStart = cue.start;
      }
      buf.push(cue.text);
    }
    await flush();
  },
});

/**
 * Backfill — request Mux auto-subtitles for the project's already-ready
 * videos that predate generated_subtitles. Mux processes each and fires
 * video.asset.track.ready, which auto-indexes via `indexTranscript`.
 * Staggered so we don't burst the Mux API. Returns how many were queued.
 */
export const backfillProject = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<{ queued: number }> => {
    const videoIds: Id<"videos">[] = await ctx.runQuery(
      api.search.listReadyVideoIds,
      { projectId: args.projectId },
    );
    let queued = 0;
    for (const videoId of videoIds) {
      const info = await ctx.runQuery(
        internal.search.getVideoForFrameCaption,
        { videoId },
      );
      if (!info || !info.muxAssetId) continue;
      try {
        await addGeneratedSubtitles(info.muxAssetId);
        queued++;
      } catch (e) {
        // Most likely: asset already has a generated-subtitle track.
        console.error("transcript backfill: addGeneratedSubtitles failed", {
          videoId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    return { queued };
  },
});
