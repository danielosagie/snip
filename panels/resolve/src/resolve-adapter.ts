import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ResolveContext,
  ResolveTimelineInventory,
  ResolveTimelineItemInventory,
  ResolveTrackInventory,
  ResolveTrackKind,
} from "./model";
import { parseResolveFrameRate, timecodeToFrames } from "./protocol";
import type {
  ResolveApi,
  ResolveProject,
  ResolveTimeline,
  ResolveTimelineItem,
} from "./resolve-api";

export class ResolveUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveUnavailableError";
  }
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function callOr<T>(call: () => T, fallback: T): T {
  try {
    const value = call();
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function serializable(value: unknown, depth = 0): unknown {
  if (depth > 5 || value == null) return value ?? null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => serializable(entry, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = serializable(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}

function itemList(
  value: ResolveTimelineItem[] | Record<string, ResolveTimelineItem> | undefined,
): ResolveTimelineItem[] {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

function snapshotName(branch: string, message: string, snapshotId: string): string {
  const base = `${branch} ${message}`
    .replace(/^\s*live:\s*/i, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  const suffix = snapshotId.replace(/[^a-zA-Z0-9]/g, "").slice(-6) || "copy";
  return `Snip ${base || "Snapshot"} ${suffix}`;
}

export class ResolveAdapter {
  constructor(private readonly resolve: ResolveApi) {}

  private current(): {
    project: ResolveProject;
    timeline: ResolveTimeline;
  } {
    const manager = callOr(() => this.resolve.GetProjectManager(), undefined);
    const project = manager ? callOr(() => manager.GetCurrentProject(), undefined) : undefined;
    if (!project) throw new ResolveUnavailableError("Open a Resolve project.");
    const timeline = callOr(() => project.GetCurrentTimeline(), undefined);
    if (!timeline) throw new ResolveUnavailableError("Open a timeline.");
    return { project, timeline };
  }

  getContext(): ResolveContext {
    const { project, timeline } = this.current();
    const projectName = safeString(callOr(() => project.GetName(), ""), "Resolve Project");
    const timelineName = safeString(callOr(() => timeline.GetName(), ""), "Timeline");
    const sourceProjectId = safeString(
      callOr(() => project.GetUniqueId?.(), ""),
      projectName,
    );
    const sourceTimelineId = safeString(
      callOr(() => timeline.GetUniqueId?.(), ""),
      `${sourceProjectId}:${timelineName}`,
    );
    const frameRate = parseResolveFrameRate(
      callOr(
        () => timeline.GetSetting?.("timelineFrameRate"),
        callOr(() => project.GetSetting?.("timelineFrameRate"), 24),
      ),
    );
    const startFrame = finiteNumber(callOr(() => timeline.GetStartFrame(), 0));
    const endFrame = Math.max(
      startFrame,
      finiteNumber(callOr(() => timeline.GetEndFrame(), startFrame), startFrame),
    );
    const startTimecode = safeString(
      callOr(() => timeline.GetStartTimecode?.(), "00:00:00:00"),
      "00:00:00:00",
    );
    const timecode = safeString(
      callOr(() => timeline.GetCurrentTimecode?.(), startTimecode),
      startTimecode,
    );
    const offset = timecodeToFrames(timecode, frameRate) - timecodeToFrames(startTimecode, frameRate);
    const playheadFrame = Math.min(endFrame, Math.max(startFrame, startFrame + offset));
    const selected = callOr(() => timeline.GetCurrentVideoItem?.(), undefined);
    const selectedId = selected
      ? safeString(callOr(() => selected.GetUniqueId?.(), ""), "")
      : "";

    return {
      projectName,
      sourceProjectId,
      timelineName,
      sourceTimelineId,
      frameRate,
      startFrame,
      endFrame,
      playheadFrame,
      timecode,
      selectedClipIds: selectedId ? [selectedId] : [],
    };
  }

  inspectTimeline(): ResolveTimelineInventory {
    const { timeline } = this.current();
    const context = this.getContext();
    const tracks: ResolveTrackInventory[] = [];
    const kinds: ResolveTrackKind[] = ["video", "audio", "subtitle"];

    for (const kind of kinds) {
      const count = Math.max(0, finiteNumber(callOr(() => timeline.GetTrackCount(kind), 0)));
      for (let index = 1; index <= count; index += 1) {
        const items: ResolveTimelineItemInventory[] = itemList(
          callOr(() => timeline.GetItemListInTrack(kind, index), undefined),
        ).map((item, itemIndex) => this.inspectItem(item, `${kind}-${index}-${itemIndex}`));
        tracks.push({
          kind,
          index,
          name: safeString(callOr(() => timeline.GetTrackName?.(kind, index), ""), `${kind} ${index}`),
          enabled: callOr(() => timeline.GetIsTrackEnabled?.(kind, index) ?? true, true),
          locked: callOr(() => timeline.GetIsTrackLocked?.(kind, index) ?? false, false),
          items,
        });
      }
    }

    const markers = serializable(
      callOr(() => timeline.GetMarkers?.(), {}),
    ) as Record<string, unknown>;
    const signatureInput = {
      project: context.sourceProjectId,
      timeline: context.sourceTimelineId,
      name: context.timelineName,
      start: context.startFrame,
      end: context.endFrame,
      tracks,
      markers,
    };
    const signature = createHash("sha256")
      .update(JSON.stringify(signatureInput))
      .digest("hex")
      .slice(0, 24);

    return { context, tracks, markers, signature };
  }

  private inspectItem(item: ResolveTimelineItem, fallbackId: string): ResolveTimelineItemInventory {
    const name = safeString(callOr(() => item.GetName(), ""), "Clip");
    const id = safeString(callOr(() => item.GetUniqueId?.(), ""), `${fallbackId}:${name}`);
    const mediaPoolItem = callOr(() => item.GetMediaPoolItem?.(), undefined);
    const mediaId = mediaPoolItem
      ? safeString(callOr(() => mediaPoolItem.GetUniqueId?.(), ""), "")
      : "";
    return {
      id,
      name,
      start: finiteNumber(callOr(() => item.GetStart(), 0)),
      end: finiteNumber(callOr(() => item.GetEnd(), 0)),
      duration: finiteNumber(callOr(() => item.GetDuration(), 0)),
      ...(mediaId ? { mediaId } : {}),
      enabled: callOr(() => item.GetClipEnabled?.() ?? true, true),
    };
  }

  async exportCurrentTimeline(): Promise<string> {
    const { project, timeline } = this.current();
    const directory = await mkdtemp(join(tmpdir(), "snip-resolve-export-"));
    const path = join(directory, "timeline.fcpxml");
    try {
      const exportType = this.resolve.EXPORT_FCPXML_1_10 ?? 9;
      const exported = timeline.Export
        ? timeline.Export(path, exportType, this.resolve.EXPORT_NONE ?? 0)
        : project.ExportCurrentTimelineToFile?.(path, exportType);
      if (!exported) throw new Error("Resolve could not export FCPXML.");
      return await readFile(path, "utf8");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async importSnapshot(input: {
    branch: string;
    fcpxml: string;
    message: string;
    snapshotId: string;
  }): Promise<string> {
    const { project } = this.current();
    const mediaPool = callOr(() => project.GetMediaPool(), undefined);
    if (!mediaPool) throw new Error("Resolve media pool is unavailable.");
    const directory = await mkdtemp(join(tmpdir(), "snip-resolve-pull-"));
    const path = join(directory, "snapshot.fcpxml");
    const timelineName = snapshotName(input.branch, input.message, input.snapshotId);
    try {
      await writeFile(path, input.fcpxml, { encoding: "utf8", mode: 0o600 });
      const imported = mediaPool.ImportTimelineFromFile(path, {
        timelineName,
        importSourceClips: true,
      });
      if (!imported || typeof imported === "boolean") {
        throw new Error("Resolve could not create the timeline.");
      }
      project.SetCurrentTimeline?.(imported);
      return safeString(callOr(() => imported.GetName(), timelineName), timelineName);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
