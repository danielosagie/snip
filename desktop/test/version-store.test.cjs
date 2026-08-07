"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { afterEach, describe, expect, test } = require("bun:test");
const {
  createLocalVersionStore,
  sha256,
} = require("../lib/version-store.cjs");

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("local version store", () => {
  test("evicts oldest entries and unreferenced blobs first", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "snip-versions-"));
    temporaryDirectories.push(directory);
    const store = createLocalVersionStore({
      baseDirectory: directory,
      maxEntries: 2,
      maxBytes: 1024,
    });
    const first = Buffer.from("first");

    await store.snapshot({
      content: first,
      file: "cut.prproj",
      observedAt: 1,
      mtime: 1,
    });
    await store.snapshot({
      content: Buffer.from("second"),
      file: "cut.prproj",
      observedAt: 2,
      mtime: 2,
    });
    await store.snapshot({
      content: Buffer.from("third"),
      file: "cut.prproj",
      observedAt: 3,
      mtime: 3,
    });

    const history = await store.list();
    expect(history.map((entry) => entry.observedAt)).toEqual([3, 2]);
    const evictedHash = sha256(first);
    await expect(
      fs.stat(path.join(directory, "blobs", evictedHash.slice(0, 2), evictedHash)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
