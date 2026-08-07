"use strict";

const { describe, expect, test } = require("bun:test");
const {
  createSaveDebouncer,
  normalizeExtensions,
} = require("../lib/project-watcher.cjs");
const {
  BufferedWatcherTransport,
  createConvexWatcherTransport,
} = require("../lib/watcher-transport.cjs");

describe("project watcher", () => {
  test("normalizes defaults and configured project extensions", () => {
    expect([...normalizeExtensions(["AEP", ".veg", "  aep  "])].sort()).toEqual([
      ".aep",
      ".drp",
      ".fcpxml",
      ".prproj",
      ".veg",
    ]);
  });

  test("debounces saves independently by file", () => {
    let nextTimer = 0;
    const timers = new Map();
    const ready = [];
    const debouncer = createSaveDebouncer({
      delayMs: 750,
      onReady: (file) => ready.push(file),
      setTimer(callback, delay) {
        const id = ++nextTimer;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimer(id) {
        timers.delete(id);
      },
    });

    debouncer.schedule("cut.prproj");
    const firstCutTimer = nextTimer;
    debouncer.schedule("notes.fcpxml");
    const notesTimer = nextTimer;
    debouncer.schedule("cut.prproj");
    const finalCutTimer = nextTimer;

    expect(timers.has(firstCutTimer)).toBe(false);
    expect(timers.get(notesTimer).delay).toBe(750);
    timers.get(notesTimer).callback();
    timers.get(finalCutTimer).callback();
    expect(ready).toEqual(["notes.fcpxml", "cut.prproj"]);
    expect(debouncer.pendingCount).toBe(0);
  });
});

describe("buffered watcher transport", () => {
  test("keeps events from different watched roots distinct", async () => {
    const batches = [];
    const transport = new BufferedWatcherTransport({
      flushMs: 60_000,
      send: async (events) => batches.push(events),
    });
    const event = {
      kind: "save",
      file: "cut.prproj",
      mtime: 42,
      hash: "abc",
    };
    await transport.publish([
      { ...event, root: "/project-a" },
      { ...event, root: "/project-b" },
    ]);
    await transport.flush();

    expect(batches).toHaveLength(1);
    expect(batches[0].map((item) => item.root)).toEqual([
      "/project-a",
      "/project-b",
    ]);
    transport.close();
  });

  test("publishes durable events without the legacy user field", async () => {
    const calls = [];
    const transport = createConvexWatcherTransport({
      flushMs: 60_000,
      convexCall: async (...args) => calls.push(args),
      getContext: async () => ({
        clientId: "client-1",
        projectId: "project-1",
        mountPath: "/project",
      }),
    });
    await transport.publish([
      {
        kind: "save",
        file: "cut.prproj",
        root: "/project",
        user: "local-user",
        mtime: 42,
        observedAt: 43,
        hash: "abc",
        parseStatus: "parsed",
      },
    ]);
    await transport.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe("desktopWatcherEvents:insert");
    expect(calls[0][2].events[0]).not.toHaveProperty("user");
    transport.close();
  });

  test("uses the legacy transport only when its fallback flag is set", async () => {
    const calls = [];
    const transport = createConvexWatcherTransport({
      convexCall: async (_kind, fnPath) => {
        calls.push(fnPath);
        if (fnPath === "desktopWatcherEvents:insert") throw new Error("offline");
      },
      getContext: async () => ({
        clientId: "client-1",
        projectId: "project-1",
        teamId: "team-1",
        mountPath: "/project",
      }),
      legacyPresenceFallback: true,
    });
    await transport.publish([
      {
        kind: "open",
        file: "cut.prproj",
        root: "/project",
        user: "local-user",
        mtime: 42,
        observedAt: 43,
        hash: "abc",
        parseStatus: "not_requested",
      },
    ]);
    await transport.flush();

    expect(calls).toEqual([
      "desktopWatcherEvents:insert",
      "desktopPresence:publishWatcherEvents",
    ]);
    transport.close();
  });
});
