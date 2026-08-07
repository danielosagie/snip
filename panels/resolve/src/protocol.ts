import type { TimelinePresencePayload, TimelineTime } from "../../../src/lib/timeline/types";
import type {
  PanelConfig,
  PresenceHeartbeatRequest,
  ResolveContext,
  ResolveTimelineInventory,
  TimelineSnapshotPush,
} from "./model";

const JSON_HEADERS = Object.freeze({
  accept: "application/json",
  "content-type": "application/json",
});

export function normalizeServerUrl(value: string): string {
  const url = new URL(value.trim());
  const localHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("Use HTTPS, or HTTP on localhost.");
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizeBranch(value: string): string {
  return value.trim() || "main";
}

export function buildAuthHeaders(token: string): Record<string, string> {
  const normalized = token.trim();
  if (!normalized || /[\r\n]/.test(normalized)) {
    throw new Error("Plugin token is invalid.");
  }

  return {
    ...JSON_HEADERS,
    authorization: `Bearer ${normalized}`,
  };
}

export function parseResolveFrameRate(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "").replace(/\s*DF$/i, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return 24;

  const ntscRates: Array<[number, number]> = [
    [23.976, 24_000 / 1_001],
    [29.97, 30_000 / 1_001],
    [47.952, 48_000 / 1_001],
    [59.94, 60_000 / 1_001],
    [119.88, 120_000 / 1_001],
  ];
  const match = ntscRates.find(([displayRate]) => Math.abs(parsed - displayRate) < 0.001);
  return match?.[1] ?? parsed;
}

export function timecodeToFrames(timecode: string, rate: number): number {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})([:;])(\d{2})$/.exec(timecode.trim());
  if (!match) return 0;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frames = Number(match[5]);
  const nominalRate = Math.round(rate);
  const totalSeconds = hours * 3_600 + minutes * 60 + seconds;
  let result = totalSeconds * nominalRate + frames;

  if (match[4] === ";" && nominalRate >= 30) {
    const dropFrames = Math.round(nominalRate * 0.066_666_666_7);
    const totalMinutes = hours * 60 + minutes;
    result -= dropFrames * (totalMinutes - Math.floor(totalMinutes / 10));
  }

  return result;
}

export function frameTime(frame: number, rate: number): TimelineTime {
  return {
    value: Math.max(0, Math.round(frame)),
    rate,
  };
}

export function buildPresencePayload(context: ResolveContext): TimelinePresencePayload {
  const duration = Math.max(0, context.endFrame - context.startFrame);
  const playhead = Math.min(
    duration,
    Math.max(0, context.playheadFrame - context.startFrame),
  );

  return {
    playheadPosition: frameTime(playhead, context.frameRate),
    selectedClipIds: [...context.selectedClipIds],
    viewportRange: {
      start: frameTime(0, context.frameRate),
      duration: frameTime(duration, context.frameRate),
    },
    softLocks: [],
  };
}

export function buildPresenceRequest(
  config: PanelConfig,
  context: ResolveContext,
  sessionId: string,
): PresenceHeartbeatRequest {
  return {
    projectId: config.projectId,
    branch: normalizeBranch(config.branch),
    sessionId,
    sourceProjectId: context.sourceProjectId,
    sourceTimelineId: context.sourceTimelineId,
    timelineName: context.timelineName,
    displayName: config.displayName,
    surface: "resolve",
    payload: buildPresencePayload(context),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

export function buildSnapshotPayload(
  config: PanelConfig,
  inventory: ResolveTimelineInventory,
  fcpxml: string,
): TimelineSnapshotPush {
  const videoTracks = inventory.tracks.filter((track) => track.kind !== "audio");
  const audioTracks = inventory.tracks.filter((track) => track.kind === "audio");

  return {
    projectId: config.projectId,
    cuts: json({
      schemaVersion: 1,
      timeline: inventory.context,
      tracks: videoTracks,
    }),
    color: "{}",
    audio: json({ schemaVersion: 1, tracks: audioTracks }),
    effects: "{}",
    markers: json(inventory.markers),
    metadata: json({
      schemaVersion: 1,
      signature: inventory.signature,
      frameRate: inventory.context.frameRate,
      exportedAt: Date.now(),
    }),
    fcpxml,
    branch: normalizeBranch(config.branch),
    message: `Live: ${inventory.context.timelineName}`,
    sourceProjectId: inventory.context.sourceProjectId,
    sourceTimelineId: inventory.context.sourceTimelineId,
    createdByName: config.displayName,
    source: "resolve",
  };
}

export interface DebouncedTask {
  cancel(): void;
  flush(): Promise<void>;
  pending(): boolean;
  trigger(): void;
}

interface DebounceOptions {
  maxWaitMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  now?: () => number;
}

export function createDebouncedTask(
  task: () => void | Promise<void>,
  delayMs: number,
  options: DebounceOptions = {},
): DebouncedTask {
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstTriggeredAt: number | undefined;
  let running: Promise<void> | undefined;

  const run = async () => {
    if (timer) clearTimer(timer);
    timer = undefined;
    firstTriggeredAt = undefined;
    if (!running) {
      running = Promise.resolve(task()).finally(() => {
        running = undefined;
      });
    }
    await running;
  };

  return {
    cancel() {
      if (timer) clearTimer(timer);
      timer = undefined;
      firstTriggeredAt = undefined;
    },
    async flush() {
      if (timer) await run();
      else if (running) await running;
    },
    pending() {
      return Boolean(timer || running);
    },
    trigger() {
      const triggeredAt = now();
      firstTriggeredAt ??= triggeredAt;
      if (timer) clearTimer(timer);
      const maxWaitRemaining =
        options.maxWaitMs == null
          ? delayMs
          : Math.max(0, options.maxWaitMs - (triggeredAt - firstTriggeredAt));
      timer = setTimer(() => void run(), Math.min(delayMs, maxWaitRemaining));
    },
  };
}
