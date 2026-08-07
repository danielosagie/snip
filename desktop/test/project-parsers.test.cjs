"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { describe, expect, test } = require("bun:test");
const {
  INTERMEDIATE_SCHEMA,
  parseFcpxmlText,
  parsePrprojBuffer,
  parseProjectBufferSoft,
} = require("../lib/project-parsers.cjs");
const { ProjectFileWatcher } = require("../lib/project-watcher.cjs");

const FIXTURES = path.join(__dirname, "fixtures");

describe("Premiere project parser", () => {
  test("gunzips a .prproj into the neutral timeline shape", async () => {
    const input = await fs.readFile(path.join(FIXTURES, "minimal.prproj"));
    const result = parsePrprojBuffer(input);

    expect(result.schema).toBe(INTERMEDIATE_SCHEMA);
    expect(result.sourceFormat).toBe("prproj");
    expect(result.projectName).toBe("Minimal Premiere Project");
    expect(result.sequences).toHaveLength(1);
    expect(result.sequences[0]).toMatchObject({
      name: "Main Cut",
      rate: 24,
      duration: { value: 240, rate: 24 },
    });
    const [video, audio] = result.sequences[0].tracks;
    expect(video).toMatchObject({ name: "V1", kind: "video", index: 0 });
    expect(video.clips[0]).toMatchObject({
      name: "Opening Shot",
      timelineIn: { value: 24, rate: 24 },
      timelineOut: { value: 72, rate: 24 },
      sourceIn: { value: 48, rate: 24 },
      sourceOut: { value: 96, rate: 24 },
    });
    expect(audio.kind).toBe("audio");
    expect(result.mediaReferences.map((ref) => ref.targetUrl)).toEqual([
      "/Volumes/Media/opening.mov",
      "/Volumes/Media/opening.wav",
    ]);
  });
});

describe("Final Cut Pro project parser", () => {
  test("parses FCPXML tracks, ranges, rate, and media references", async () => {
    const input = await fs.readFile(path.join(FIXTURES, "minimal.fcpxml"), "utf8");
    const result = parseFcpxmlText(input);

    expect(result.sourceFormat).toBe("fcpxml");
    expect(result.projectName).toBe("Minimal FCP Project");
    expect(result.sequences).toHaveLength(1);
    expect(result.sequences[0].rate).toBeCloseTo(23.976, 3);
    const video = result.sequences[0].tracks.find((track) => track.kind === "video");
    const audio = result.sequences[0].tracks.find((track) => track.kind === "audio");
    expect(video.clips[0]).toMatchObject({
      name: "Opening Interview",
      timelineIn: { value: 0, rate: 1 },
      timelineOut: { value: 48048, rate: 24000 },
      sourceIn: { value: 1001, rate: 24000 },
      sourceOut: { value: 49049, rate: 24000 },
    });
    expect(audio).toMatchObject({ kind: "audio", index: -1 });
    expect(audio.clips[0].metadata.audioRole).toBe("dialogue");
    expect(result.mediaReferences.map((ref) => ref.targetUrl)).toEqual([
      "/Volumes/Media/interview-a.mov",
      "/Volumes/Media/room-tone.wav",
    ]);
  });
});

describe("soft parse failures", () => {
  test("degrades corrupt and unsupported saves without throwing", () => {
    expect(parseProjectBufferSoft(Buffer.from("not a project"), ".prproj")).toMatchObject({
      status: "saved_timeline_not_parsed",
    });
    expect(parseProjectBufferSoft(Buffer.from("resolve"), ".drp")).toEqual({
      status: "saved_timeline_not_parsed",
      error: "No timeline parser is available for .drp.",
    });
  });

  test("publishes save activity before parsing and reports failure later", async () => {
    const events = [];
    const watcher = new ProjectFileWatcher({
      roots: ["/project"],
      user: "editor",
      transport: {
        async publish(batch) {
          events.push(...batch);
        },
      },
      statFile: async () => ({ isFile: () => true, mtimeMs: 123 }),
      hashFileFn: async () => "hash",
      readFile: async () => Buffer.from("corrupt"),
      parseProjectBufferSoft,
    });

    await watcher.emitStableEvent("save", "/project", "/project/cut.prproj");
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(events[0].parseStatus).toBe("pending");

    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      kind: "save",
      file: "cut.prproj",
      hash: "hash",
      parseStatus: "saved_timeline_not_parsed",
    });
    watcher.close();
  });
});
