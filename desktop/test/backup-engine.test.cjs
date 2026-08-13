"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { afterEach, describe, expect, test } = require("bun:test");
const {
  MAX_DEPTH,
  createBackupEngine,
  destinationFolderFor,
  loadManifest,
  planUploads,
  sanitizeFolderName,
  saveManifest,
  scanSource,
} = require("../lib/backup-engine.cjs");

const temporaryDirectories = [];

async function makeTempDir(prefix = "snip-backup-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("scanSource", () => {
  test("finds files recursively and skips system junk, dotfiles, and symlinks", async () => {
    const root = await makeTempDir();
    await fs.mkdir(path.join(root, "day 1"), { recursive: true });
    await fs.mkdir(path.join(root, ".Trashes"), { recursive: true });
    await fs.writeFile(path.join(root, "a.mov"), "aaa");
    await fs.writeFile(path.join(root, "day 1", "b.mov"), "bb");
    await fs.writeFile(path.join(root, ".hidden"), "x");
    await fs.writeFile(path.join(root, ".DS_Store"), "x");
    await fs.writeFile(path.join(root, ".Trashes", "junk.mov"), "x");
    await fs.symlink(path.join(root, "a.mov"), path.join(root, "link.mov"));

    const { files, skippedLinks } = await scanSource(root);
    const paths = files.map((f) => f.relPath).sort();

    expect(paths).toEqual(["a.mov", "day 1/b.mov"]);
    expect(skippedLinks).toBe(1);
    expect(files.find((f) => f.relPath === "a.mov").size).toBe(3);
  });

  test("includes dotfiles when asked, but never OS bookkeeping folders", async () => {
    const root = await makeTempDir();
    await fs.mkdir(path.join(root, ".Spotlight-V100"), { recursive: true });
    await fs.writeFile(path.join(root, ".env"), "SECRET=1");
    await fs.writeFile(path.join(root, ".Spotlight-V100", "index"), "x");

    const { files } = await scanSource(root, { includeHidden: true });
    expect(files.map((f) => f.relPath)).toEqual([".env"]);
  });

  test("stops at the depth tripwire and names the limit", async () => {
    const root = await makeTempDir();
    let current = root;
    for (let i = 0; i <= MAX_DEPTH + 2; i += 1) {
      current = path.join(current, "d");
      await fs.mkdir(current);
    }
    await fs.writeFile(path.join(current, "deep.mov"), "x");

    const lines = [];
    const { files } = await scanSource(root, { onLog: (line) => lines.push(line) });

    expect(files).toEqual([]);
    expect(lines.some((line) => line.includes(`MAX_DEPTH=${MAX_DEPTH}`))).toBe(true);
  });
});

describe("planUploads", () => {
  const files = [
    { relPath: "a.mov", size: 10, mtimeMs: 100, absolutePath: "/a.mov" },
    { relPath: "b.mov", size: 20, mtimeMs: 200, absolutePath: "/b.mov" },
  ];

  test("uploads everything when the manifest is empty", () => {
    const plan = planUploads(files, { entries: {} });
    expect(plan.uploads).toHaveLength(2);
    expect(plan.pendingBytes).toBe(30);
    expect(plan.unchangedCount).toBe(0);
  });

  test("skips files whose size and mtime both match", () => {
    const plan = planUploads(files, {
      entries: { "a.mov": { size: 10, mtimeMs: 100 } },
    });
    expect(plan.uploads.map((f) => f.relPath)).toEqual(["b.mov"]);
    expect(plan.unchangedCount).toBe(1);
    expect(plan.unchangedBytes).toBe(10);
  });

  test("re-uploads when size changed even if mtime matches", () => {
    const plan = planUploads(files, {
      entries: {
        "a.mov": { size: 99, mtimeMs: 100 },
        "b.mov": { size: 20, mtimeMs: 200 },
      },
    });
    expect(plan.uploads.map((f) => f.relPath)).toEqual(["a.mov"]);
  });

  test("re-uploads when mtime changed even if size matches", () => {
    const plan = planUploads(files, {
      entries: {
        "a.mov": { size: 10, mtimeMs: 100 },
        "b.mov": { size: 20, mtimeMs: 999 },
      },
    });
    expect(plan.uploads.map((f) => f.relPath)).toEqual(["b.mov"]);
  });
});

describe("folder naming", () => {
  test("replaces the characters the server rejects", () => {
    expect(sanitizeFolderName('a/b:c*d?e"f<g>h|i')).toBe("a-b-c-d-e-f-g-h-i");
  });

  test("collapses whitespace and caps at 120 characters", () => {
    expect(sanitizeFolderName("  two   words  ")).toBe("two words");
    expect(sanitizeFolderName("x".repeat(200))).toHaveLength(120);
  });

  test("maps a relative path to the folder segments under the base", () => {
    expect(destinationFolderFor("2026/day 1/clip.mov", ["Rushes"])).toEqual([
      "Rushes",
      "2026",
      "day 1",
    ]);
    expect(destinationFolderFor("clip.mov", [])).toEqual([]);
  });
});

describe("manifest", () => {
  test("round-trips and survives a corrupt file by starting empty", async () => {
    const directory = await makeTempDir();
    await saveManifest(directory, "src-1", {
      version: 1,
      entries: { "a.mov": { size: 1, mtimeMs: 2, uploadedAt: 3 } },
    });
    const loaded = await loadManifest(directory, "src-1");
    expect(loaded.entries["a.mov"].size).toBe(1);

    await fs.writeFile(path.join(directory, "src-2.json"), "{not json");
    expect((await loadManifest(directory, "src-2")).entries).toEqual({});
  });
});

/** Minimal fake of the Convex desktop upload contract. */
function makeConvexRecorder({ failFileNames = new Set() } = {}) {
  const calls = [];
  return {
    calls,
    convexCall: async (kind, fnPath, args) => {
      calls.push({ kind, fnPath, args });
      if (fnPath === "desktopBrowse:createUploadForDesktop") {
        if (failFileNames.has(args.fileName)) {
          throw new Error(`refusing ${args.fileName}`);
        }
        return {
          mode: "create",
          videoId: null,
          previousS3Key: null,
          uploadUrl: `https://storage.test/${args.fileName}`,
          s3Key: `projects/t/p/originals/${args.fileName}`,
        };
      }
      return { ok: true };
    },
  };
}

const SOURCE = {
  id: "src-1",
  kind: "folder",
  path: "",
  label: "Rushes",
  destination: { teamSlug: "acme", projectName: "Spot", folderPath: ["Backup"] },
};

describe("createBackupEngine.runSource", () => {
  test("uploads new files, commits each one, and skips them on the second run", async () => {
    const root = await makeTempDir();
    await fs.mkdir(path.join(root, "day 1"), { recursive: true });
    await fs.writeFile(path.join(root, "a.mov"), "aaaa");
    await fs.writeFile(path.join(root, "day 1", "b.mov"), "bb");
    const manifestDirectory = await makeTempDir();
    const recorder = makeConvexRecorder();

    const engine = createBackupEngine({
      convexCall: recorder.convexCall,
      manifestDirectory,
      createReadStream: () => "stream",
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });

    const first = await engine.runSource({ ...SOURCE, path: root });
    expect(first).toEqual({ uploaded: 2, skipped: 0, failed: 0 });

    const commits = recorder.calls.filter(
      (c) => c.fnPath === "desktopUploadActions:commitUploadForDesktop",
    );
    expect(commits).toHaveLength(2);
    expect(commits.map((c) => c.args.fileName).sort()).toEqual(["a.mov", "b.mov"]);

    // Nested local folders become real snip folders under the base folder.
    const nested = commits.find((c) => c.args.fileName === "b.mov");
    expect(nested.args.folderPath).toEqual(["Backup", "day 1"]);
    const ensured = recorder.calls.filter(
      (c) => c.fnPath === "desktopBrowse:ensureFolderForDesktop",
    );
    expect(ensured.map((c) => c.args.folderPath)).toEqual([
      ["Backup"],
      ["Backup", "day 1"],
    ]);

    const second = await engine.runSource({ ...SOURCE, path: root });
    expect(second).toEqual({ uploaded: 0, skipped: 2, failed: 0 });
  });

  test("a changed file is picked up on the next run", async () => {
    const root = await makeTempDir();
    const file = path.join(root, "a.mov");
    await fs.writeFile(file, "aaaa");
    const manifestDirectory = await makeTempDir();
    const recorder = makeConvexRecorder();
    const engine = createBackupEngine({
      convexCall: recorder.convexCall,
      manifestDirectory,
      createReadStream: () => "stream",
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });

    await engine.runSource({ ...SOURCE, path: root });
    await fs.writeFile(file, "aaaaaaaaaaaa");
    const second = await engine.runSource({ ...SOURCE, path: root });
    expect(second.uploaded).toBe(1);
  });

  test("one failing file is counted and named without sinking the run", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "good.mov"), "aaaa");
    await fs.writeFile(path.join(root, "bad.mov"), "bb");
    const manifestDirectory = await makeTempDir();
    const recorder = makeConvexRecorder({ failFileNames: new Set(["bad.mov"]) });
    const lines = [];

    const engine = createBackupEngine({
      convexCall: recorder.convexCall,
      manifestDirectory,
      onLog: (line) => lines.push(line),
      createReadStream: () => "stream",
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });

    const result = await engine.runSource({ ...SOURCE, path: root });
    expect(result.uploaded).toBe(1);
    expect(result.failed).toBe(1);
    expect(lines.some((line) => line.includes("bad.mov") && line.includes("refusing"))).toBe(
      true,
    );

    // The failed file stays out of the manifest, so the next run retries it.
    const manifest = await loadManifest(manifestDirectory, "src-1");
    expect(Object.keys(manifest.entries)).toEqual(["good.mov"]);
  });

  test("aborts the candidate object when the bytes fail to land", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "a.mov"), "aaaa");
    const manifestDirectory = await makeTempDir();
    const recorder = makeConvexRecorder();

    const engine = createBackupEngine({
      convexCall: recorder.convexCall,
      manifestDirectory,
      createReadStream: () => "stream",
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => "nope" }),
    });

    const result = await engine.runSource({ ...SOURCE, path: root });
    expect(result.failed).toBe(1);
    expect(
      recorder.calls.filter(
        (c) => c.fnPath === "desktopUploadActions:abortUploadForDesktop",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      recorder.calls.some(
        (c) => c.fnPath === "desktopUploadActions:commitUploadForDesktop",
      ),
    ).toBe(false);
  });

  test("a missing source path fails loudly and names the path", async () => {
    const manifestDirectory = await makeTempDir();
    const engine = createBackupEngine({
      convexCall: async () => ({}),
      manifestDirectory,
    });
    await expect(
      engine.runSource({ ...SOURCE, path: "/definitely/not/here" }),
    ).rejects.toThrow("/definitely/not/here");
  });

  test("a file that changes mid-upload is left dirty for the next run", async () => {
    const root = await makeTempDir();
    const file = path.join(root, "a.mov");
    await fs.writeFile(file, "aaaa");
    const manifestDirectory = await makeTempDir();
    const recorder = makeConvexRecorder();

    const engine = createBackupEngine({
      convexCall: recorder.convexCall,
      manifestDirectory,
      createReadStream: () => "stream",
      fetchImpl: async () => ({ ok: true, status: 200 }),
      // Report a different size than the scan saw, as if the file grew.
      statFile: async () => ({ size: 9999, mtimeMs: 1 }),
    });

    const result = await engine.runSource({ ...SOURCE, path: root });
    expect(result.uploaded).toBe(1);
    const manifest = await loadManifest(manifestDirectory, "src-1");
    expect(manifest.entries).toEqual({});
  });
});
