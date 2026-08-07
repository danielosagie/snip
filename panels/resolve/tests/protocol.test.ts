import { afterEach, describe, expect, test } from "bun:test";
import type { PanelConfig, ResolveContext, ResolveTimelineInventory } from "../src/model";
import {
  buildAuthHeaders,
  buildPresencePayload,
  buildPresenceRequest,
  buildSnapshotPayload,
  createDebouncedTask,
  normalizeServerUrl,
  parseResolveFrameRate,
  timecodeToFrames,
} from "../src/protocol";

const config: PanelConfig = {
  serverUrl: "https://example.convex.site",
  pluginToken: "snip_secret",
  projectId: "project_123",
  displayName: "Morgan",
  branch: "main",
};

const context: ResolveContext = {
  projectName: "Launch",
  sourceProjectId: "resolve-project",
  timelineName: "Cut 4",
  sourceTimelineId: "resolve-timeline",
  frameRate: 24,
  startFrame: 86_400,
  endFrame: 88_800,
  playheadFrame: 87_000,
  timecode: "01:00:25:00",
  selectedClipIds: ["clip-a"],
};

describe("protocol auth", () => {
  test("builds JSON bearer headers without leaking whitespace", () => {
    expect(buildAuthHeaders("  snip_secret  ")).toEqual({
      accept: "application/json",
      authorization: "Bearer snip_secret",
      "content-type": "application/json",
    });
  });

  test("rejects empty and injected tokens", () => {
    expect(() => buildAuthHeaders(" ")).toThrow("invalid");
    expect(() => buildAuthHeaders("token\r\nx: bad")).toThrow("invalid");
  });

  test("requires TLS away from localhost", () => {
    expect(normalizeServerUrl("https://snip.example/ ")).toBe("https://snip.example");
    expect(normalizeServerUrl("http://localhost:3210/")).toBe("http://localhost:3210");
    expect(() => normalizeServerUrl("http://snip.example")).toThrow("HTTPS");
  });
});

describe("presence payload", () => {
  test("uses project-relative frame time", () => {
    expect(buildPresencePayload(context)).toEqual({
      playheadPosition: { value: 600, rate: 24 },
      selectedClipIds: ["clip-a"],
      viewportRange: {
        start: { value: 0, rate: 24 },
        duration: { value: 2_400, rate: 24 },
      },
      softLocks: [],
    });
  });

  test("targets the configured document branch", () => {
    const request = buildPresenceRequest(config, context, "session-1");
    expect(request.branch).toBe("main");
    expect(request.surface).toBe("resolve");
    expect(request.sourceTimelineId).toBe("resolve-timeline");
  });

  test("normalizes NTSC rates and drop-frame timecode", () => {
    const rate = parseResolveFrameRate("29.97 DF");
    expect(rate).toBeCloseTo(30_000 / 1_001, 8);
    expect(timecodeToFrames("01:00:00;00", rate)).toBe(107_892);
  });
});

describe("snapshot payload", () => {
  test("splits tracks while keeping FCPXML as the source", () => {
    const inventory: ResolveTimelineInventory = {
      context,
      markers: { 24: { name: "Beat" } },
      signature: "abc123",
      tracks: [
        { kind: "video", index: 1, name: "V1", enabled: true, locked: false, items: [] },
        { kind: "audio", index: 1, name: "A1", enabled: true, locked: false, items: [] },
      ],
    };
    const payload = buildSnapshotPayload(config, inventory, "<fcpxml />");

    expect(payload.source).toBe("resolve");
    expect(payload.fcpxml).toBe("<fcpxml />");
    expect(payload.sourceTimelineId).toBe("resolve-timeline");
    expect(JSON.parse(payload.cuts).tracks).toHaveLength(1);
    expect(JSON.parse(payload.audio).tracks).toHaveLength(1);
  });
});

describe("debounce", () => {
  const timers = new Set<ReturnType<typeof setTimeout>>();

  afterEach(() => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });

  test("coalesces rapid calls into one task", async () => {
    let calls = 0;
    const debounce = createDebouncedTask(() => {
      calls += 1;
    }, 20);

    debounce.trigger();
    debounce.trigger();
    debounce.trigger();
    expect(debounce.pending()).toBe(true);
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 35);
      timers.add(timer);
    });

    expect(calls).toBe(1);
    expect(debounce.pending()).toBe(false);
  });

  test("flushes a pending task", async () => {
    let calls = 0;
    const debounce = createDebouncedTask(() => {
      calls += 1;
    }, 1_000);
    debounce.trigger();
    await debounce.flush();
    expect(calls).toBe(1);
  });
});
