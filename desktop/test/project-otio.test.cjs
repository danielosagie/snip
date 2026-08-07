"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { describe, expect, test } = require("bun:test");
const {
  parseFcpxmlText,
  parsePrprojBuffer,
} = require("../lib/project-parsers.cjs");
const { intermediateToOtio } = require("../lib/project-otio.cjs");

const FIXTURES = path.join(__dirname, "fixtures");

describe("project intermediate to OTIO", () => {
  test("maps Premiere ranges, tracks, gaps, and media references", async () => {
    const intermediate = parsePrprojBuffer(
      await fs.readFile(path.join(FIXTURES, "minimal.prproj")),
    );
    const otio = intermediateToOtio(intermediate);

    expect(otio).toMatchObject({
      OTIO_SCHEMA: "Timeline.1",
      name: "Main Cut",
      global_start_time: {
        OTIO_SCHEMA: "RationalTime.1",
        value: 0,
        rate: 24,
      },
      tracks: { OTIO_SCHEMA: "Stack.1" },
    });
    expect(otio.tracks.children.map((track) => track.kind)).toEqual([
      "Video",
      "Audio",
    ]);
    const [gap, clip] = otio.tracks.children[0].children;
    expect(gap).toMatchObject({
      OTIO_SCHEMA: "Gap.1",
      source_range: { duration: { value: 24, rate: 24 } },
    });
    expect(clip).toMatchObject({
      OTIO_SCHEMA: "Clip.2",
      name: "Opening Shot",
      source_range: {
        start_time: { value: 48, rate: 24 },
        duration: { value: 48, rate: 24 },
      },
      media_reference: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: "/Volumes/Media/opening.mov",
      },
      metadata: {
        snip: {
          timelineStart: { value: 24, rate: 24 },
          timelineDuration: { value: 48, rate: 24 },
        },
      },
    });
  });

  test("preserves FCP rational times without a seconds round trip", async () => {
    const intermediate = parseFcpxmlText(
      await fs.readFile(path.join(FIXTURES, "minimal.fcpxml"), "utf8"),
    );
    const otio = intermediateToOtio(intermediate);
    const opening = otio.tracks.children
      .flatMap((track) => track.children)
      .find((child) => child.name === "Opening Interview");

    expect(opening).toMatchObject({
      OTIO_SCHEMA: "Clip.2",
      source_range: {
        start_time: { value: 1001, rate: 24000 },
        duration: { value: 48048, rate: 24000 },
      },
      media_reference: { target_url: "/Volumes/Media/interview-a.mov" },
    });
  });
});
