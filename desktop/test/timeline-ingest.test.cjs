"use strict";

const { describe, expect, test } = require("bun:test");
const {
  buildTimelineIngestPayload,
  convexSiteUrl,
  postTimelineIngest,
  timelineIngestIdempotencyKey,
} = require("../lib/timeline-ingest.cjs");

const event = {
  kind: "save",
  file: "edits/cut.prproj",
  root: "/projects",
  mtime: 100,
  observedAt: 200,
  hash: "a".repeat(64),
};

const intermediate = {
  version: 1,
  sourceFormat: "prproj",
  projectName: "Launch",
  warnings: [],
  sequences: [{ id: "sequence:main", name: "Main", tracks: [] }],
};

const otio = {
  OTIO_SCHEMA: "Timeline.1",
  name: "Main",
  global_start_time: { OTIO_SCHEMA: "RationalTime.1", value: 0, rate: 24 },
  tracks: { OTIO_SCHEMA: "Stack.1", name: "Tracks", children: [], metadata: {} },
  metadata: {},
};

describe("timeline ingest protocol", () => {
  test("builds Agent A's payload and project-hash idempotency key", () => {
    const payload = buildTimelineIngestPayload({
      projectId: "project_123",
      branch: "main",
      event,
      intermediate,
      otio,
      createdByName: "Editor",
    });

    expect(payload).toMatchObject({
      projectId: "project_123",
      branch: "main",
      sourceFileHash: event.hash,
      sourceFile: "edits/cut.prproj",
      sourceFormat: {
        name: "prproj",
        version: "1",
        extension: ".prproj",
        mimeType: "application/octet-stream",
      },
      sourceMetadata: {
        root: "/projects",
        mtime: 100,
        observedAt: 200,
        projectName: "Launch",
        sequenceCount: 1,
      },
      otio,
      sourceTimelineId: "sequence:main",
      createdByName: "Editor",
    });
    expect(timelineIngestIdempotencyKey(payload.projectId, payload.sourceFileHash)).toBe(
      `desktop-timeline:project_123:${event.hash}`,
    );
  });

  test("posts to the Convex site endpoint with the same key", async () => {
    const calls = [];
    const payload = buildTimelineIngestPayload({
      projectId: "project_123",
      event,
      intermediate,
      otio,
    });
    await postTimelineIngest({
      siteUrl: "https://example.convex.cloud",
      pluginToken: "snip_secret",
      payload,
      fetchFn: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ ok: true, status: "created" }));
      },
    });

    expect(convexSiteUrl("https://example.convex.cloud")).toBe(
      "https://example.convex.site",
    );
    expect(calls[0].url).toBe(
      "https://example.convex.site/desktop/timelines/ingest",
    );
    expect(calls[0].init.headers["Idempotency-Key"]).toBe(
      `desktop-timeline:project_123:${event.hash}`,
    );
    expect(JSON.parse(calls[0].init.body)).toEqual(payload);
  });
});
