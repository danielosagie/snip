const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { start } = require("./electron-webdav.cjs");

const execFileAsync = promisify(execFile);

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function withDav(convexCall, fn) {
  const dav = await start({ convexCall, pushLog: () => {} });
  try {
    await fn(`http://127.0.0.1:${dav.port}/webdav`);
  } finally {
    await dav.stop();
  }
}

test("advertises and routes Finder mutation methods", async () => {
  const calls = [];
  const convexCall = async (kind, name, args) => {
    calls.push({ kind, name, args });
    if (name.endsWith("deletePathForDesktop")) return { type: "file" };
    if (name.endsWith("movePathForDesktop")) return { type: "file", overwritten: true };
    if (name.endsWith("copyPathForDesktop")) return { videoId: "v1", overwritten: false };
    throw new Error(`Unexpected ${kind} ${name}`);
  };
  await withDav(convexCall, async (base) => {
    const options = await fetch(`${base}/team/project/file.mov`, { method: "OPTIONS" });
    assert.match(options.headers.get("allow"), /DELETE/);
    assert.match(options.headers.get("allow"), /MOVE/);
    assert.match(options.headers.get("allow"), /COPY/);

    const deleted = await fetch(`${base}/team/project/file.mov`, { method: "DELETE" });
    assert.equal(deleted.status, 204);

    const moved = await fetch(`${base}/team/project/file.mov`, {
      method: "MOVE",
      headers: { Destination: `${base}/team/project/replaced.mov`, Overwrite: "T" },
    });
    assert.equal(moved.status, 204);

    const copied = await fetch(`${base}/team/project/replaced.mov`, {
      method: "COPY",
      headers: { Destination: `${base}/team/project/copy.mov`, Overwrite: "F" },
    });
    assert.equal(copied.status, 201);
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      "desktopBrowse:deletePathForDesktop",
      "desktopBrowse:movePathForDesktop",
      "desktopUploadActions:copyPathForDesktop",
    ],
  );
  assert.equal(calls[1].args.overwrite, true);
  assert.equal(calls[2].args.overwrite, false);
});

test("uploads legitimate dotfiles and commits only after storage succeeds", async () => {
  let storedBody = null;
  const storage = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      storedBody = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200);
      res.end();
    });
  });
  const storagePort = await listen(storage);
  const calls = [];
  const convexCall = async (kind, name, args) => {
    calls.push({ kind, name, args });
    if (name.endsWith("createUploadForDesktop")) {
      return {
        mode: "create",
        videoId: null,
        previousS3Key: null,
        s3Key: "projects/team/p/originals/desktop-pending/dotfile",
        uploadUrl: `http://127.0.0.1:${storagePort}/candidate`,
      };
    }
    if (name.endsWith("commitUploadForDesktop")) {
      assert.equal(storedBody, "SECRET=ok");
      return { videoId: "v1", processingPending: false };
    }
    throw new Error(`Unexpected ${kind} ${name}`);
  };
  try {
    await withDav(convexCall, async (base) => {
      const response = await fetch(`${base}/team/project/.env`, {
        method: "PUT",
        headers: { "content-type": "text/plain", "content-length": "9" },
        body: "SECRET=ok",
      });
      assert.equal(response.status, 201);
    });
  } finally {
    await close(storage);
  }
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      "desktopBrowse:createUploadForDesktop",
      "desktopUploadActions:commitUploadForDesktop",
    ],
  );
});

test("accepts zero-byte files and still commits them", async () => {
  const storage = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end();
  });
  const storagePort = await listen(storage);
  let committedSize = null;
  const convexCall = async (_kind, name, args) => {
    if (name.endsWith("createUploadForDesktop")) {
      return {
        mode: "create",
        videoId: null,
        previousS3Key: null,
        s3Key: "projects/team/p/originals/desktop-pending/empty",
        uploadUrl: `http://127.0.0.1:${storagePort}/candidate`,
      };
    }
    if (name.endsWith("commitUploadForDesktop")) {
      committedSize = args.size;
      return { videoId: "v1", processingPending: false };
    }
    throw new Error(`Unexpected ${name}`);
  };
  try {
    await withDav(convexCall, async (base) => {
      const response = await fetch(`${base}/team/project/empty.txt`, {
        method: "PUT",
        headers: { "content-type": "text/plain", "content-length": "0" },
      });
      assert.equal(response.status, 201);
    });
  } finally {
    await close(storage);
  }
  assert.equal(committedSize, 0);
});

test("failed storage PUT aborts the candidate and never commits", async () => {
  const storage = http.createServer((_req, res) => {
    res.writeHead(500);
    res.end("nope");
  });
  const storagePort = await listen(storage);
  const names = [];
  const convexCall = async (_kind, name) => {
    names.push(name);
    if (name.endsWith("createUploadForDesktop")) {
      return {
        mode: "overwrite",
        videoId: "existing",
        previousS3Key: "old-key",
        s3Key: "projects/team/p/originals/desktop-pending/replacement",
        uploadUrl: `http://127.0.0.1:${storagePort}/candidate`,
      };
    }
    if (name.endsWith("abortUploadForDesktop")) return { ok: true };
    throw new Error(`Unexpected ${name}`);
  };
  try {
    await withDav(convexCall, async (base) => {
      const response = await fetch(`${base}/team/project/file.mov`, {
        method: "PUT",
        headers: { "content-type": "video/quicktime", "content-length": "1" },
        body: "x",
      });
      assert.equal(response.status, 403);
    });
  } finally {
    await close(storage);
  }
  assert.deepEqual(names, [
    "desktopBrowse:createUploadForDesktop",
    "desktopUploadActions:abortUploadForDesktop",
  ]);
});

test("filters Finder metadata but not arbitrary dotfiles", async () => {
  await withDav(async () => {
    throw new Error("metadata should be rejected before Convex");
  }, async (base) => {
    const response = await fetch(`${base}/team/project/.DS_Store`, {
      method: "PUT",
      headers: { "content-length": "1" },
      body: "x",
    });
    assert.equal(response.status, 404);
  });
});

test("real rclone performs same-size replace, rename, and delete", async (t) => {
  try {
    await execFileAsync("/opt/homebrew/bin/rclone", ["version"]);
  } catch {
    t.skip("rclone is not installed");
    return;
  }

  const candidates = new Map();
  const files = new Map();
  const storage = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.slice(1));
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      candidates.set(key, Buffer.concat(chunks));
      res.writeHead(200);
      res.end();
    });
  });
  const storagePort = await listen(storage);
  let candidateCounter = 0;
  const convexCall = async (_kind, name, args) => {
    if (name.endsWith("listTeamsForDesktop")) {
      return [{ slug: "team", name: "Team", role: "owner", updatedAt: 1 }];
    }
    if (name.endsWith("listProjectsForDesktop")) {
      return [{
        projectId: "p",
        displayName: "project",
        rawName: "project",
        updatedAt: 1,
        videoCount: files.size,
        role: "owner",
      }];
    }
    if (name.endsWith("browsePathForDesktop")) {
      const itemPath = args.folderPath || [];
      if (itemPath.length === 0) {
        return {
          type: "folder",
          folders: [],
          videos: [...files.entries()].map(([displayName, file]) => ({
            displayName,
            ext: displayName.split(".").pop() || "",
            size: file.body.length,
            contentType: "text/plain",
            updatedAt: file.updatedAt,
            etag: `"${displayName}-${file.version}"`,
            isReady: true,
          })),
        };
      }
      const file = files.get(itemPath[0]);
      return file
        ? {
            type: "file",
            displayName: itemPath[0],
            size: file.body.length,
            contentType: "text/plain",
            updatedAt: file.updatedAt,
            etag: `"${itemPath[0]}-${file.version}"`,
          }
        : null;
    }
    if (name.endsWith("createUploadForDesktop")) {
      const current = files.get(args.fileName);
      const s3Key = `candidate-${++candidateCounter}`;
      return {
        mode: current ? "overwrite" : "create",
        videoId: current ? args.fileName : null,
        previousS3Key: current?.s3Key || null,
        s3Key,
        uploadUrl: `http://127.0.0.1:${storagePort}/${encodeURIComponent(s3Key)}`,
      };
    }
    if (name.endsWith("commitUploadForDesktop")) {
      const body = candidates.get(args.s3Key);
      assert.ok(body, "candidate bytes exist before commit");
      const previous = files.get(args.fileName);
      files.set(args.fileName, {
        body,
        s3Key: args.s3Key,
        version: (previous?.version || 0) + 1,
        updatedAt: Date.now(),
      });
      return { videoId: args.fileName, processingPending: false };
    }
    if (name.endsWith("movePathForDesktop")) {
      const sourceName = args.itemPath.at(-1);
      const destinationName = args.destinationPath.at(-1);
      const file = files.get(sourceName);
      if (!file) throw new Error("Source not found.");
      const overwritten = files.has(destinationName);
      if (overwritten && !args.overwrite) throw new Error("Destination already exists.");
      files.set(destinationName, { ...file, version: file.version + 1, updatedAt: Date.now() });
      files.delete(sourceName);
      return { type: "file", overwritten };
    }
    if (name.endsWith("deletePathForDesktop")) {
      const fileName = args.itemPath.at(-1);
      if (!files.delete(fileName)) throw new Error("File not found.");
      return { type: "file" };
    }
    throw new Error(`Unexpected ${name}`);
  };

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "snip-rclone-test-"));
  const first = path.join(tempDir, "first.txt");
  const second = path.join(tempDir, "second.txt");
  await fs.writeFile(first, "AAAA");
  await fs.writeFile(second, "BBBB");
  const dav = await start({ convexCall, pushLog: () => {} });
  const env = {
    ...process.env,
    RCLONE_CONFIG_SNIPTEST_TYPE: "webdav",
    RCLONE_CONFIG_SNIPTEST_URL: `http://127.0.0.1:${dav.port}/webdav`,
    RCLONE_CONFIG_SNIPTEST_VENDOR: "other",
  };
  const rclone = (args) =>
    execFileAsync("/opt/homebrew/bin/rclone", args, { env, timeout: 20_000 });
  try {
    await rclone(["copyto", first, "sniptest:team/project/same.txt", "--ignore-times"]);
    await rclone(["copyto", second, "sniptest:team/project/same.txt", "--ignore-times"]);
    assert.equal(files.get("same.txt").body.toString(), "BBBB");
    assert.equal(files.get("same.txt").version, 2);

    await rclone([
      "moveto",
      "sniptest:team/project/same.txt",
      "sniptest:team/project/renamed.txt",
    ]);
    assert.equal(files.has("same.txt"), false);
    assert.equal(files.get("renamed.txt").body.toString(), "BBBB");

    await rclone(["deletefile", "sniptest:team/project/renamed.txt"]);
    assert.equal(files.has("renamed.txt"), false);
  } finally {
    await dav.stop();
    await close(storage);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
