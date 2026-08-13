"use strict";

const { describe, expect, test } = require("bun:test");
const {
  createVolumeWatcher,
  listWindowsVolumes,
  volumeRootsFor,
} = require("../lib/volume-watcher.cjs");

describe("volumeRootsFor", () => {
  test("macOS mounts removable media under /Volumes", () => {
    expect(volumeRootsFor("darwin", "/Users/dan")).toEqual(["/Volumes"]);
  });

  test("linux checks both /media and the per-user run directory", () => {
    expect(volumeRootsFor("linux", "/home/dan")).toEqual([
      "/media",
      "/media/dan",
      "/run/media/dan",
    ]);
  });

  test("windows has no mount directory", () => {
    expect(volumeRootsFor("win32", "C:\\Users\\dan")).toEqual([]);
  });
});

describe("listWindowsVolumes", () => {
  test("probes drive letters and never reports the system disk", async () => {
    const mounted = new Set(["C:\\", "E:\\", "F:\\"]);
    const volumes = await listWindowsVolumes({
      access: async (root) => {
        if (!mounted.has(root)) throw new Error("ENOENT");
      },
    });
    expect(volumes).toEqual([
      { path: "E:\\", name: "E:" },
      { path: "F:\\", name: "F:" },
    ]);
  });
});

/** Drives a watcher through a scripted sequence of poll results. */
function scriptedWatcher(sequence, handlers = {}) {
  let index = 0;
  const attached = [];
  const detached = [];
  const watcher = createVolumeWatcher({
    onAttached: (v) => attached.push(v.name),
    onDetached: (v) => detached.push(v.name),
    list: async () => sequence[Math.min(index, sequence.length - 1)],
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {},
    ...handlers,
  });
  return {
    watcher,
    attached,
    detached,
    advance: async () => {
      index += 1;
      await watcher.poll();
    },
  };
}

describe("createVolumeWatcher", () => {
  const DISK = { path: "/Volumes/SSD", name: "SSD" };
  const CARD = { path: "/Volumes/CARD", name: "CARD" };

  test("volumes already mounted at launch are not reported as newly attached", async () => {
    const run = scriptedWatcher([[DISK], [DISK]]);
    await run.watcher.start();
    expect(run.attached).toEqual([]);
    expect(run.watcher.list()).toEqual([DISK]);
  });

  test("reports a drive plugged in after the baseline", async () => {
    const run = scriptedWatcher([[DISK], [DISK, CARD]]);
    await run.watcher.start();
    await run.advance();
    expect(run.attached).toEqual(["CARD"]);
    expect(run.detached).toEqual([]);
  });

  test("reports a drive being unplugged", async () => {
    const run = scriptedWatcher([[DISK, CARD], [DISK]]);
    await run.watcher.start();
    await run.advance();
    expect(run.detached).toEqual(["CARD"]);
  });

  test("a replug at the same path attaches again", async () => {
    const run = scriptedWatcher([[DISK], [], [DISK]]);
    await run.watcher.start();
    await run.advance();
    await run.advance();
    expect(run.detached).toEqual(["SSD"]);
    expect(run.attached).toEqual(["SSD"]);
  });

  test("a failing poll is logged and does not throw", async () => {
    const lines = [];
    const watcher = createVolumeWatcher({
      onAttached: () => {},
      list: async () => {
        throw new Error("permission denied");
      },
      setTimer: () => ({ unref() {} }),
      clearTimer: () => {},
      onLog: (line) => lines.push(line),
    });
    await watcher.start();
    expect(lines.some((line) => line.includes("permission denied"))).toBe(true);
  });
});
