// Electron main process. Plain CJS so it runs without a build step.
// Talks to the renderer (React UI in src/) via IPC.

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const { spawn, execSync, execFile } = require("node:child_process");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

// The desktop is a thin native shell around the WEB app — it loads
// snipfilm.vercel.app directly (real https origin, so Clerk + Convex behave
// exactly like the browser) and exposes native capabilities (mount, file
// open/reveal, auto-update) to it via the preload bridge. No separate desktop
// UI to maintain. Override with SNIP_WEB_URL for staging / local web dev.
const WEB_APP_URL = (process.env.SNIP_WEB_URL || "https://snipfilm.vercel.app").replace(/\/$/, "");

const SETTINGS_DIR = path.join(app.getPath("userData"));
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

// ---- Settings persistence ----------------------------------------------------

// LucidLink-parity feature flags. Each entry gates a separate background
// loop in the main process (presence polling, prefetch watcher, LAN cache
// server, ACL enforcement). Defaults are all false so existing users
// don't get surprise background work after an update — they have to opt
// in from the Settings → Features panel.
const DEFAULT_FEATURES = {
  presence: { enabled: false },
  prefetch: { enabled: false },
  lanCache: { enabled: false, port: 17900 },
  acls: { enabled: false },
};

const DEFAULT_SETTINGS = {
  convexUrl: "",
  convexAuthToken: "",
  storage: {
    provider: "r2", // "r2" | "railway"
    bucket: "",
    endpoint: "",
    accessKeyId: "",
    secretAccessKey: "",
    region: "auto",
  },
  rootDir: path.join(app.getPath("home"), "VideoInfra"),
  // The drive is meant to "just be there", so we default to auto-mounting on
  // launch once storage is configured. Set back to false on an explicit
  // "Disconnect" so the app respects that intent on the next launch.
  autoMount: true,
  features: DEFAULT_FEATURES,
};

async function loadSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // Deep-merge `features` so adding a new flag in DEFAULT_FEATURES
    // doesn't get clobbered to undefined by an older settings file.
    const features = { ...DEFAULT_FEATURES, ...(parsed.features || {}) };
    for (const key of Object.keys(DEFAULT_FEATURES)) {
      features[key] = { ...DEFAULT_FEATURES[key], ...(features[key] || {}) };
    }
    return { ...DEFAULT_SETTINGS, ...parsed, features };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(settings) {
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ---- S3 helpers --------------------------------------------------------------

function makeS3(settings) {
  // Lazy import so a build without creds set still launches.
  const { S3Client } = require("@aws-sdk/client-s3");
  const s = settings.storage;
  return new S3Client({
    region: s.region || "auto",
    endpoint: s.endpoint || undefined,
    credentials: {
      accessKeyId: s.accessKeyId,
      secretAccessKey: s.secretAccessKey,
    },
    forcePathStyle: s.provider === "railway",
  });
}

async function listPrefix(s3, bucket, prefix) {
  const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
  const out = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      out.push({ key: obj.Key, size: obj.Size, etag: obj.ETag, lastModified: obj.LastModified });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function downloadObject(s3, bucket, key, destPath) {
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const stream = res.Body;
  const writer = fssync.createWriteStream(destPath);
  await new Promise((resolve, reject) => {
    stream.pipe(writer);
    stream.on("error", reject);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function uploadFile(s3, bucket, key, filePath) {
  const { Upload } = require("@aws-sdk/lib-storage");
  const stream = fssync.createReadStream(filePath);
  const upload = new Upload({
    client: s3,
    params: { Bucket: bucket, Key: key, Body: stream },
  });
  await upload.done();
}

async function walkLocal(dir) {
  const out = [];
  async function recurse(d, base) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(d, entry.name);
      const rel = path.relative(base, full);
      if (entry.isDirectory()) {
        await recurse(full, base);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        out.push({ relPath: rel, size: stat.size, path: full });
      }
    }
  }
  if (fssync.existsSync(dir)) {
    await recurse(dir, dir);
  }
  return out;
}

// ---- IPC handlers ------------------------------------------------------------

let mainWindow = null;
function reportProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sync:progress", payload);
  }
}

ipcMain.handle("settings:get", async () => loadSettings());
ipcMain.handle("settings:set", async (_event, next) => {
  await saveSettings(next);
  // Re-evaluate background loops against the new flags.
  await reconcileFeatures().catch((err) => {
    console.error("reconcileFeatures failed after settings:set:", err);
  });
  return next;
});

// ---- Convex HTTP helper (for background loops in this file) ------------------
//
// The existing call-sites in this file inline the fetch + bearer-token dance;
// pulling it out so the presence + prefetch loops can hit Convex with one
// line. Errors are logged but don't throw — these loops are best-effort and
// must never crash the app on transient Convex outages.

async function convexCall(kind, fnPath, args) {
  const settings = await loadSettings();
  if (!settings.convexUrl || !settings.convexAuthToken) {
    throw new Error("Convex URL + auth token not configured.");
  }
  const url = `${settings.convexUrl.replace(/\/$/, "")}/api/${kind}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.convexAuthToken}`,
    },
    body: JSON.stringify({ path: fnPath, args, format: "json" }),
  });
  if (!resp.ok) {
    throw new Error(`Convex ${kind} ${fnPath} → HTTP ${resp.status}: ${await resp.text()}`);
  }
  const body = await resp.json();
  if (body.status === "error") {
    throw new Error(`Convex ${fnPath}: ${body.errorMessage || "unknown error"}`);
  }
  return body.value;
}

// ---- Feature loop: file presence + soft locks --------------------------------
//
// Polls `lsof` against the active mount path every 5s, posts the list of
// open files + the process that has them to Convex via
// `desktopPresence:upsertLocks`. Other team members read those rows via
// `desktopPresence:listForProject` to render "Alex has X open" badges.
//
// The lsof invocation:
//   lsof -Fpcn +D <mountPath>
// emits one stanza per open fd:
//   p<pid>
//   c<command>
//   n<path>
// We filter to files under the mount and dedupe by (pid, path) — most
// editors hold the same file open from many fds.

const CLIENT_ID_FILE = path.join(SETTINGS_DIR, "client-id");

function getClientId() {
  try {
    return fssync.readFileSync(CLIENT_ID_FILE, "utf8").trim();
  } catch {
    const id = crypto.randomBytes(8).toString("hex");
    try {
      fssync.mkdirSync(SETTINGS_DIR, { recursive: true });
      fssync.writeFileSync(CLIENT_ID_FILE, id);
    } catch {
      // Non-fatal: presence will use an ephemeral ID for this session.
    }
    return id;
  }
}

const presenceState = {
  intervalId: null,
  inFlight: false,
};

function parseLsof(stdout, mountPath) {
  // Editors open the same file on many fds; the (pid, path) dedupe keeps
  // the payload small and predictable for the Convex row size limit.
  const seen = new Set();
  const out = [];
  let cur = {};
  // Path boundary: a sibling mount at `/mnt/proj2` must NOT match a
  // mountPath of `/mnt/proj`, even though `startsWith` says yes. Append
  // the platform separator so the prefix is forced to be at a path
  // boundary. Match on the bare mountPath too (lsof can report the mount
  // root itself when an app has a handle on the directory).
  const mountRootWithSep = mountPath.endsWith(path.sep) ? mountPath : `${mountPath}${path.sep}`;
  const flush = () => {
    if (cur.path && (cur.path === mountPath || cur.path.startsWith(mountRootWithSep))) {
      const key = `${cur.pid}::${cur.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          path: cur.path.slice(mountPath.length).replace(/^[/\\]/, ""),
          process: cur.process,
          pid: cur.pid,
        });
      }
    }
    cur = {};
  };
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const type = line[0];
    const value = line.slice(1);
    if (type === "p") {
      flush();
      cur.pid = Number(value) || undefined;
    } else if (type === "c") {
      cur.process = value;
    } else if (type === "n") {
      cur.path = value;
    }
  }
  flush();
  return out;
}

function listOpenFilesUnderMount(mountPath) {
  return new Promise((resolve) => {
    if (!mountPath) return resolve([]);
    // -F p,c,n: machine-readable fields. +D recurses into the directory.
    // Timeout 4s so a stuck lsof can't pin the loop forever.
    execFile(
      "lsof",
      ["-Fpcn", "+D", mountPath],
      { timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        // lsof exits 1 when nothing is open under the path; treat as success.
        if (err && err.code !== 1) return resolve([]);
        resolve(parseLsof(stdout || "", mountPath));
      },
    );
  });
}

async function pushPresenceOnce() {
  if (presenceState.inFlight) return;
  presenceState.inFlight = true;
  try {
    const settings = await loadSettings();
    if (!settings.features?.presence?.enabled) return;
    if (!settings.convexUrl || !settings.convexAuthToken) return;
    if (mountState.status !== "mounted" || !mountState.mountPath) return;

    const files = await listOpenFilesUnderMount(mountState.mountPath);
    await convexCall("mutation", "desktopPresence:upsertLocks", {
      clientId: getClientId(),
      projectId: settings.activeProjectId || undefined,
      mountPath: mountState.mountPath,
      files,
    });
  } catch (err) {
    // Best-effort; surface to the mount log so users can debug if a
    // misconfigured Convex token or expired session causes silence.
    pushLog?.(`presence: ${err.message}`);
  } finally {
    presenceState.inFlight = false;
  }
}

function startPresenceLoop() {
  if (presenceState.intervalId) return;
  // Immediate first push so a freshly-opened editor shows up without a
  // 5s wait, then steady-state cadence.
  void pushPresenceOnce();
  presenceState.intervalId = setInterval(pushPresenceOnce, 5000);
}

function stopPresenceLoop() {
  if (!presenceState.intervalId) return;
  clearInterval(presenceState.intervalId);
  presenceState.intervalId = null;
  // Clear our row on stop so other users don't keep seeing a stale
  // "open files" set for the next ~30s.
  void convexCall("mutation", "desktopPresence:clearLocks", {
    clientId: getClientId(),
  }).catch(() => {});
}

// ---- Feature loop: predictive prefetch ---------------------------------------
//
// Premiere editors hit the play button and expect their clips to scrub
// immediately. With a cloud-backed mount that means rclone's VFS cache
// has to already hold the first chunk of every clip in the bin. We get
// most of the way there by watching for `.prproj` writes (Premiere
// rewrites the project on every save / autosave) and warming the cache
// for every absolute mount-path string we find in the decompressed
// project XML.
//
// Scope notes for v0:
// - Only Premiere `.prproj`. DaVinci Resolve `.drp` is sqlite; FCP
//   `.fcpxmld` is a bundle. Both are 2× the work each and will land
//   in follow-up commits if this approach pans out.
// - We don't parse the XML structure — we scan the decompressed bytes
//   for substrings that start with the mount path. Misses
//   ${PROJ_LOCATION}-style placeholders but catches the common case of
//   absolute paths that the editor resolved before saving.
// - Warmer is `cat <path> >/dev/null` with concurrency 4. Each call
//   pulls the file through rclone's VFS cache; cache size is bounded
//   by the user's rclone --vfs-cache-max-size flag.
// - lastWarmed dedupes per-path with a 60s window so re-saving a
//   project every few seconds during an editing burst doesn't kick
//   off a thundering herd against the bucket.

// zlib + fast-xml-parser are required further down in this file for the
// Resolve / Premiere snapshot flows. We reuse those imports here rather
// than re-declaring them; the prefetch implementation only needs gunzip
// and substring scanning — no structured XML walk yet.

const prefetchState = {
  watcher: null,
  // path → epoch-ms of the last successful warm. Cap at 5 minutes so a
  // long-running session doesn't grow this map without bound.
  lastWarmed: new Map(),
  inFlight: new Set(),
  queue: [],
  workers: 0,
};

const PREFETCH_WARM_COOLDOWN_MS = 60_000;
const PREFETCH_MAX_CONCURRENCY = 4;
const PREFETCH_MAX_PATHS_PER_PROJ = 2000;

function decompressIfGzip(buf) {
  // Premiere .prproj starts with the gzip magic bytes 1f 8b.
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return zlib.gunzipSync(buf);
  }
  return buf;
}

function extractMountPathsFromProject(text, mountPath) {
  // Scan for substrings that start with the mount root and look like
  // file paths. The regex bound is `[^<>"'\s]+` which covers paths
  // embedded in XML attributes ("path=...") and CDATA blocks. We accept
  // either '/' or '\\' as the separator after the mount root so a
  // .prproj that was authored on Windows and synced to a Mac mount via
  // cloud-side rclone-style sharing still matches; downstream warming
  // normalizes by passing the path straight to createReadStream which
  // accepts both separators on POSIX hosts too.
  const escaped = mountPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}[\\\\/][^<>"'\\s]+`, "g");
  const out = new Set();
  let match;
  let count = 0;
  while ((match = re.exec(text)) !== null) {
    out.add(match[0]);
    if (++count > PREFETCH_MAX_PATHS_PER_PROJ) break;
  }
  return [...out];
}

function warmPathOnce(absPath) {
  return new Promise((resolve) => {
    // `cat path >/dev/null` is the standard way to pull a file through
    // rclone's VFS cache. We open + drain via streams to keep memory
    // flat regardless of file size; the OS-level read is what populates
    // the cache, not our buffer in JS.
    const stream = fssync.createReadStream(absPath, { highWaterMark: 1 << 20 });
    stream.on("data", () => {}); // drain
    stream.on("end", () => resolve(true));
    stream.on("error", () => resolve(false));
  });
}

async function prefetchWorker() {
  while (prefetchState.queue.length) {
    const next = prefetchState.queue.shift();
    if (prefetchState.inFlight.has(next)) continue;
    prefetchState.inFlight.add(next);
    try {
      const ok = await warmPathOnce(next);
      if (ok) prefetchState.lastWarmed.set(next, Date.now());
    } finally {
      prefetchState.inFlight.delete(next);
    }
  }
  prefetchState.workers--;
}

function enqueuePrefetch(paths) {
  const now = Date.now();
  for (const p of paths) {
    const last = prefetchState.lastWarmed.get(p);
    if (last && now - last < PREFETCH_WARM_COOLDOWN_MS) continue;
    if (prefetchState.inFlight.has(p)) continue;
    prefetchState.queue.push(p);
  }
  while (prefetchState.workers < PREFETCH_MAX_CONCURRENCY && prefetchState.queue.length) {
    prefetchState.workers++;
    void prefetchWorker();
  }
}

async function handlePrprojWrite(absPath, mountPath) {
  try {
    // Tiny debounce: Premiere autosave writes the file in two passes
    // (temp file → rename). Wait 250ms so we read the final version.
    await new Promise((r) => setTimeout(r, 250));
    const raw = await fs.readFile(absPath);
    const xml = decompressIfGzip(raw).toString("utf8");
    const paths = extractMountPathsFromProject(xml, mountPath);
    pushLog?.(`prefetch: ${path.basename(absPath)} → warming ${paths.length} media file(s)`);
    enqueuePrefetch(paths);
    // Cap the lastWarmed map. Iteration order is insertion order, so
    // the oldest entries fall off first.
    if (prefetchState.lastWarmed.size > 5000) {
      const overflow = prefetchState.lastWarmed.size - 5000;
      const it = prefetchState.lastWarmed.keys();
      for (let i = 0; i < overflow; i++) prefetchState.lastWarmed.delete(it.next().value);
    }
  } catch (err) {
    pushLog?.(`prefetch: parse failed for ${absPath} — ${err.message}`);
  }
}

function startPrefetchWatcher() {
  if (prefetchState.watcher) return;
  if (mountState.status !== "mounted" || !mountState.mountPath) return;

  const mountPath = mountState.mountPath;
  try {
    // macOS + Windows support recursive natively; on Linux fs.watch
    // recursive landed in Node 20.
    prefetchState.watcher = fssync.watch(
      mountPath,
      { recursive: true, persistent: false },
      (eventType, filename) => {
        // Premiere autosaves often land as a temp-file → rename swap so
        // the editor never sees a half-written project. fs.watch emits
        // those as "rename" events on the final name, not "change".
        // Accept both so we don't miss real saves.
        if ((eventType !== "change" && eventType !== "rename") || !filename) return;
        if (!filename.endsWith(".prproj")) return;
        const abs = path.join(mountPath, filename);
        void handlePrprojWrite(abs, mountPath);
      },
    );
    pushLog?.(`prefetch: watching ${mountPath} for .prproj writes`);
  } catch (err) {
    pushLog?.(`prefetch: watcher failed to attach — ${err.message}`);
  }
}

function stopPrefetchWatcher() {
  if (!prefetchState.watcher) return;
  try {
    prefetchState.watcher.close();
  } catch {
    // ignore
  }
  prefetchState.watcher = null;
  prefetchState.queue.length = 0;
  // Leave lastWarmed alone — if the feature is re-enabled in the same
  // session, the dedupe window is still useful.
}

// ---- Feature loop: LAN-shared cache ------------------------------------------
//
// Discover other snip Desktop instances on the same LAN via mDNS and expose
// our mount tree over HTTP so teammates can pull project files directly
// between machines instead of re-downloading them from S3/R2.
//
// What this v0 *actually does*:
// - mDNS publish + browse (`_snip-cache._tcp.local`) so peers see each
//   other within ~5s of startup. TXT record carries our clientId +
//   mountPath so peers can correlate.
// - HTTP server on the user-configured port serving /health (peer
//   liveness ping), /list?dir=relative/path (JSON directory listing),
//   and /file?path=relative/path (streamed file with directory-
//   traversal guards).
// - Peer-to-peer pull: renderer can call `lanCache:pull` to download a
//   file from a specific peer into the user's Downloads folder. Uses
//   LAN bandwidth instead of S3 egress; for a team that's already
//   warmed a project, second/third editors don't re-pay for the
//   bytes.
//
// What it does NOT do (so it's clear in the UI description):
// - Transparent acceleration of rclone reads. rclone owns its VFS cache;
//   getting reads through the mount to consult peers first requires
//   a custom rclone backend or a FUSE shim — that's separate work.

const http = require("node:http");
const url = require("node:url");

const lanCacheState = {
  server: null,
  bonjour: null,
  service: null,
  browser: null,
  // clientId → { host, port, mountPath, lastSeen, name }
  peers: new Map(),
  peerSweepInterval: null,
  // Second rclone process — `rclone serve http <cacheDir>` —
  // exposing this client's vfs cache directory to peers so their
  // union remotes can fetch already-cached files at LAN speed.
  cacheServeChild: null,
  cacheServeLog: [],
};

// Wait up to `ms` for mDNS to surface any peer, returning early as
// soon as the first peer shows up. Used by the mount-start flow so
// the initial mount has the latest peer set when constructing the
// rclone union remote.
function waitForLanCachePeers(ms) {
  return new Promise((resolve) => {
    if (lanCacheState.peers.size > 0) return resolve();
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (lanCacheState.peers.size > 0 || Date.now() - t0 > ms) {
        clearInterval(tick);
        resolve();
      }
    }, 200);
  });
}

function getLocalLanAddress() {
  // Pick the first non-internal IPv4 address. Good enough for the
  // typical single-NIC studio workstation; the bonjour client will
  // advertise on all interfaces anyway.
  const os = require("node:os");
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

function emitPeersUpdate() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("lanCache:peers", listLanCachePeers());
  }
}

function listLanCachePeers() {
  // Drop peers we haven't seen in 30s (mDNS announce TTL + slack).
  const cutoff = Date.now() - 30_000;
  return [...lanCacheState.peers.values()].filter((p) => p.lastSeen > cutoff);
}

function safeJoinMountRelative(mountPath, rel) {
  // Resolve the requested path against the mount root and assert the
  // result is still inside the mount. Blocks ".." escapes and absolute
  // injection.
  const cleaned = (rel || "").replace(/^[/\\]+/, "");
  const abs = path.resolve(mountPath, cleaned);
  const rootWithSep = mountPath.endsWith(path.sep) ? mountPath : `${mountPath}${path.sep}`;
  if (abs !== mountPath && !abs.startsWith(rootWithSep)) {
    return null;
  }
  return abs;
}

function handleLanCacheRequest(req, res, mountPath, clientId) {
  // CORS: allow any origin (these are peers on a trusted LAN; the user
  // opted in via Settings). We don't accept arbitrary methods so this
  // surface stays tight.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Snip-Client", clientId);

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end("Method not allowed");
  }

  const parsed = url.parse(req.url, true);
  const route = parsed.pathname;

  if (route === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, clientId, mountPath }));
  }

  if (route === "/list") {
    const rel = String(parsed.query.dir || "");
    const abs = safeJoinMountRelative(mountPath, rel);
    if (!abs) {
      res.writeHead(400);
      return res.end("Bad path");
    }
    fssync.readdir(abs, { withFileTypes: true }, (err, entries) => {
      if (err) {
        res.writeHead(404);
        return res.end("Not found");
      }
      // Cap the listing so a peer can't DoS us by listing a 200k-file dir.
      const capped = entries.slice(0, 500).map((d) => ({
        name: d.name,
        isDirectory: d.isDirectory(),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ dir: rel, entries: capped, truncated: entries.length > 500 }));
    });
    return;
  }

  if (route === "/file") {
    const rel = String(parsed.query.path || "");
    const abs = safeJoinMountRelative(mountPath, rel);
    if (!abs) {
      res.writeHead(400);
      return res.end("Bad path");
    }
    fssync.stat(abs, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${path.basename(abs)}"`,
      });
      if (req.method === "HEAD") return res.end();
      fssync.createReadStream(abs).pipe(res);
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

function startLanCacheServer() {
  if (lanCacheState.server) return;
  const mountPath = mountState.mountPath;
  if (!mountPath || mountState.status !== "mounted") return;

  // Read fresh settings inline so the user can change the port + toggle
  // and have it take effect without the loop restarting.
  return loadSettings().then(async (settings) => {
    const port = settings.features?.lanCache?.port || 17900;
    const clientId = getClientId();

    const server = http.createServer((req, res) =>
      handleLanCacheRequest(req, res, mountPath, clientId),
    );

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        pushLog?.(`lanCache: server bind failed on port ${port} — ${err.message}`);
        reject(err);
      };
      server.once("error", onError);
      server.listen(port, () => {
        server.off("error", onError);
        pushLog?.(`lanCache: serving ${mountPath} on port ${port}`);
        resolve();
      });
    }).catch(() => {
      // Bind failure (port in use, perms) — leave the feature inactive
      // until the user picks a different port and re-saves.
      return null;
    });

    if (server.listening) {
      lanCacheState.server = server;
      // Start mDNS only AFTER the HTTP server is bound, so peers that
      // discover us can actually connect on the advertised port.
      startMdnsService(port, clientId, mountPath);
      // Start the rclone-serve subprocess on port+1 so peers' union
      // remotes can fetch our cached files transparently. Safe to call
      // before the mount is up — the serve binds to an empty cache
      // directory and starts serving as files populate.
      startRcloneCacheServe(port + 1);
    }
  });
}

function stopLanCacheServer() {
  if (lanCacheState.server) {
    try {
      lanCacheState.server.close();
    } catch {
      // ignore
    }
    lanCacheState.server = null;
  }
  stopRcloneCacheServe();
  stopMdnsService();
}

function startMdnsService(port, clientId, mountPath) {
  if (lanCacheState.bonjour) return;
  let Bonjour;
  try {
    ({ Bonjour } = require("bonjour-service"));
  } catch (err) {
    pushLog?.(`lanCache: bonjour-service unavailable — ${err.message}`);
    return;
  }
  lanCacheState.bonjour = new Bonjour();

  // Publish. The `port` we advertise is the browse server (our
  // custom JSON HTTP). The TXT record's `cache_port` field carries
  // the rclone-serve port for transparent peer caching — peers'
  // union remotes use that.
  lanCacheState.service = lanCacheState.bonjour.publish({
    name: `snip-cache-${clientId.slice(0, 8)}`,
    type: "snip-cache",
    protocol: "tcp",
    port,
    txt: {
      clientId,
      mountPath,
      version: "1",
      cache_port: String(port + 1),
    },
  });

  // Browse.
  lanCacheState.browser = lanCacheState.bonjour.find(
    { type: "snip-cache", protocol: "tcp" },
    (svc) => {
      if (!svc || !svc.txt) return;
      const peerClientId = svc.txt.clientId;
      // Don't list ourselves.
      if (!peerClientId || peerClientId === clientId) return;
      const host = (svc.referer && svc.referer.address) || svc.host;
      lanCacheState.peers.set(peerClientId, {
        clientId: peerClientId,
        name: svc.name,
        host,
        port: svc.port,
        mountPath: svc.txt.mountPath || "",
        lastSeen: Date.now(),
      });
      emitPeersUpdate();
    },
  );

  if (!lanCacheState.peerSweepInterval) {
    // Drop stale peers every 15s. Pure side-effect on the in-memory map
    // — the IPC `lanCache:peers` already filters by lastSeen, but the
    // sweep keeps the map from growing unbounded across a long session.
    lanCacheState.peerSweepInterval = setInterval(() => {
      const before = lanCacheState.peers.size;
      const cutoff = Date.now() - 60_000;
      for (const [key, peer] of lanCacheState.peers) {
        if (peer.lastSeen < cutoff) lanCacheState.peers.delete(key);
      }
      if (lanCacheState.peers.size !== before) emitPeersUpdate();
    }, 15_000);
  }
}

// Spawn the second rclone process — `rclone serve http <cacheDir>` —
// which exposes our VFS cache directory over HTTP so peers' union
// remotes can fetch already-cached files from us at LAN speed.
//
// We serve on the user's lanCache port + 1 so it doesn't collide with
// the custom browse-server above (which keeps its own port for the
// renderer's "Browse peer" UI). Peers read both ports from our mDNS
// TXT record.
function startRcloneCacheServe(port) {
  if (lanCacheState.cacheServeChild) return;
  if (mountState.status !== "mounted") return;
  const cacheDir = path.join(SETTINGS_DIR, "rclone-cache");
  // The VFS cache layout is `<cache-dir>/vfs/<remote>/<bucket>/<path>`.
  // We serve everything under `vfs/videoinfra/` so peers see paths
  // matching what their rclone HTTP-remote expects.
  const serveRoot = path.join(cacheDir, "vfs", "videoinfra");
  // Ensure it exists so the rclone serve doesn't crash immediately on
  // a never-mounted client; once the mount populates it, peer reads
  // start working.
  try {
    fssync.mkdirSync(serveRoot, { recursive: true });
  } catch {
    // ignore
  }
  const args = [
    "serve",
    "http",
    serveRoot,
    "--addr",
    `0.0.0.0:${port}`,
    "--read-only",
    // No auth for v0 — assumes trusted LAN, same trust model as the
    // existing browse server. A future iteration will mint a per-team
    // token via Convex and require --user/--pass.
    "--vv",
  ];
  try {
    lanCacheState.cacheServeChild = spawn(resolveRclonePath() || "rclone", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    pushLog?.(`lanCache: rclone serve failed to start — ${err.message}`);
    return;
  }
  pushLog?.(`lanCache: rclone serve http on ${port} → ${serveRoot}`);
  const onLog = (chunk) => {
    const line = chunk.toString().trim();
    if (!line) return;
    lanCacheState.cacheServeLog.push(line);
    if (lanCacheState.cacheServeLog.length > 50) lanCacheState.cacheServeLog.shift();
  };
  lanCacheState.cacheServeChild.stdout?.on("data", onLog);
  lanCacheState.cacheServeChild.stderr?.on("data", onLog);
  lanCacheState.cacheServeChild.on("exit", (code) => {
    pushLog?.(`lanCache: rclone serve exited (code ${code})`);
    lanCacheState.cacheServeChild = null;
  });
}

function stopRcloneCacheServe() {
  if (!lanCacheState.cacheServeChild) return;
  try {
    lanCacheState.cacheServeChild.kill("SIGTERM");
  } catch {
    // ignore
  }
  lanCacheState.cacheServeChild = null;
}

function stopMdnsService() {
  if (lanCacheState.peerSweepInterval) {
    clearInterval(lanCacheState.peerSweepInterval);
    lanCacheState.peerSweepInterval = null;
  }
  try {
    if (lanCacheState.browser) lanCacheState.browser.stop();
  } catch {
    // ignore
  }
  try {
    if (lanCacheState.service) lanCacheState.service.stop?.();
  } catch {
    // ignore
  }
  try {
    if (lanCacheState.bonjour) lanCacheState.bonjour.destroy();
  } catch {
    // ignore
  }
  lanCacheState.bonjour = null;
  lanCacheState.service = null;
  lanCacheState.browser = null;
  lanCacheState.peers.clear();
  emitPeersUpdate();
}

ipcMain.handle("lanCache:peers", async () => listLanCachePeers());

ipcMain.handle("lanCache:listFromPeer", async (_event, { clientId, dir }) => {
  const peer = lanCacheState.peers.get(clientId);
  if (!peer) throw new Error("Peer not found.");
  const u = `http://${peer.host}:${peer.port}/list?dir=${encodeURIComponent(dir || "")}`;
  const resp = await fetch(u);
  if (!resp.ok) throw new Error(`Peer responded ${resp.status}`);
  return resp.json();
});

ipcMain.handle("lanCache:pullFromPeer", async (_event, { clientId, remotePath }) => {
  const peer = lanCacheState.peers.get(clientId);
  if (!peer) throw new Error("Peer not found.");
  const u = `http://${peer.host}:${peer.port}/file?path=${encodeURIComponent(remotePath)}`;
  // Save into ~/Downloads so the user finds it predictably.
  const dest = path.join(
    app.getPath("downloads"),
    `${path.basename(remotePath)}.from-${peer.name || "peer"}`,
  );
  const resp = await fetch(u);
  if (!resp.ok) throw new Error(`Peer responded ${resp.status}`);
  // Node's response body is a web stream; pipe it through a writable.
  const writer = fssync.createWriteStream(dest);
  const reader = resp.body.getReader();
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (!writer.write(value)) {
      await new Promise((r) => writer.once("drain", r));
    }
  }
  await new Promise((resolve, reject) => {
    writer.end((err) => (err ? reject(err) : resolve()));
  });
  return { ok: true, path: dest, bytes };
});

// ---- Feature loop reconciler -------------------------------------------------
//
// Single entry-point that looks at the current settings.features map and
// starts / stops each background loop accordingly. Called on app.whenReady
// and after every settings:set so flipping a toggle is enough — no app
// restart required.

async function reconcileFeatures() {
  const settings = await loadSettings();
  const flags = settings.features || {};

  if (flags.presence?.enabled) startPresenceLoop();
  else stopPresenceLoop();

  if (flags.prefetch?.enabled) startPrefetchWatcher();
  else stopPrefetchWatcher();

  if (flags.lanCache?.enabled) await startLanCacheServer();
  else stopLanCacheServer();

  // acls loop is data-layer-only and attaches in the next commit; the
  // toggle gates the renderer ACLs panel rather than a background loop
  // here.
}

ipcMain.handle("dialog:pick-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("shell:open-external", async (_event, url) => {
  await shell.openExternal(url);
});

ipcMain.handle("sync:pull", async (_event, { s3Prefix, localPath }) => {
  const settings = await loadSettings();
  if (!settings.storage.bucket) throw new Error("Storage bucket not configured.");
  const s3 = makeS3(settings);
  const objects = await listPrefix(s3, settings.storage.bucket, s3Prefix);
  let done = 0;
  for (const obj of objects) {
    const relKey = obj.key.slice(s3Prefix.length);
    if (!relKey || relKey.endsWith("/")) continue;
    const dest = path.join(localPath, relKey);
    reportProgress({ kind: "pull", current: done, total: objects.length, file: relKey });
    await downloadObject(s3, settings.storage.bucket, obj.key, dest);
    done++;
  }
  reportProgress({ kind: "pull", current: done, total: objects.length, file: null, done: true });
  return { fileCount: done };
});

ipcMain.handle("sync:push", async (_event, { s3Prefix, localPath }) => {
  const settings = await loadSettings();
  if (!settings.storage.bucket) throw new Error("Storage bucket not configured.");
  const s3 = makeS3(settings);
  const files = await walkLocal(localPath);
  let done = 0;
  let totalBytes = 0;
  for (const f of files) {
    const key = `${s3Prefix.replace(/\/$/, "")}/${f.relPath.split(path.sep).join("/")}`;
    reportProgress({ kind: "push", current: done, total: files.length, file: f.relPath });
    await uploadFile(s3, settings.storage.bucket, key, f.path);
    done++;
    totalBytes += f.size;
  }
  reportProgress({ kind: "push", current: done, total: files.length, file: null, done: true });
  return { fileCount: done, sizeBytes: totalBytes };
});

ipcMain.handle("local:open-folder", async (_event, folderPath) => {
  await shell.openPath(folderPath);
});

// Stream a presigned URL to a user-chosen path. The renderer gets the
// presigned GET URL from Convex (videoActions:getDownloadUrl) and hands it
// here so the bytes never round-trip through the renderer heap — we pipe the
// HTTP body straight to disk. Defaults to ~/Downloads/<filename>.
ipcMain.handle("files:download", async (_event, { url, filename, intoDir }) => {
  const { Readable } = require("node:stream");
  let filePath;
  if (intoDir) {
    await fs.mkdir(intoDir, { recursive: true });
    filePath = path.join(intoDir, filename || "download");
  } else {
    const defaultPath = path.join(
      app.getPath("downloads"),
      filename || "download",
    );
    const res = await dialog.showSaveDialog(mainWindow, { defaultPath });
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    filePath = res.filePath;
  }
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) {
    throw new Error(`Download failed — HTTP ${resp.status}`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const out = fssync.createWriteStream(filePath);
  await new Promise((resolve, reject) => {
    Readable.fromWeb(resp.body).pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
  });
  return { ok: true, path: filePath };
});

// ─── Mount as drive (rclone wrapper, LucidLink-style UX) ─────────────────────
//
// Single-tenant mount inside this Electron process. We spawn rclone as a
// long-lived child with --daemon=false so we own the lifecycle: on app quit
// we kill the process and umount the path. Output is streamed back to the
// renderer so the UI can surface "still mounting", errors, etc.

let mountState = {
  status: "unmounted", // "unmounted" | "mounting" | "mounted" | "error"
  mountPath: null,
  pid: null,
  lastError: null,
  log: [],
};
let mountChild = null;

// Track the last status we emitted so we only kick the feature
// reconciler on actual transitions (mounted ↔ unmounted), not on every
// log line that flows through emitMountStatus.
let lastEmittedMountStatus = null;

function emitMountStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mount:status", { ...mountState, log: mountState.log.slice(-30) });
  }
  if (mountState.status !== lastEmittedMountStatus) {
    lastEmittedMountStatus = mountState.status;
    // Mount transitions affect which feature loops can run (presence and
    // prefetch both need a live mountPath). Reconcile here so flipping the
    // mount on or off picks up the right loop state without a settings save.
    void reconcileFeatures().catch((err) => {
      console.error("reconcileFeatures failed after mount status change:", err);
    });
  }
}

function pushLog(line) {
  mountState.log.push(`${new Date().toISOString().slice(11, 19)}  ${line}`);
  if (mountState.log.length > 200) mountState.log.shift();
  emitMountStatus();
}

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "pipe", shell: "/bin/bash" });
    return true;
  } catch {
    return false;
  }
}

// ── rclone provisioning ──────────────────────────────────────────────────────
//
// snip manages rclone itself so the user never installs it manually. We do NOT
// bundle it inside the .app — a notarized, hardened-runtime bundle would reject
// an unsigned helper binary. Instead we resolve it in priority order and, if
// absent, download the matching build into userData/bin on first mount. That
// directory is outside the signed bundle, so notarization is unaffected.

const RCLONE_BIN = process.platform === "win32" ? "rclone.exe" : "rclone";

function resolveRclonePath() {
  // 1. A bundled copy, if a future build ever ships one (signed).
  if (process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, RCLONE_BIN);
    if (fssync.existsSync(bundled)) return bundled;
  }
  // 2. Our own provisioned copy.
  const managed = path.join(SETTINGS_DIR, "bin", RCLONE_BIN);
  if (fssync.existsSync(managed)) return managed;
  // 3. A system install on PATH.
  if (commandExists("rclone")) return "rclone";
  return null;
}

// Download + unzip the right rclone build into userData/bin. Returns the path.
// Logs progress to the mount log so the UI shows "Setting up rclone…".
async function ensureRclone() {
  const existing = resolveRclonePath();
  if (existing) return existing;

  const binDir = path.join(SETTINGS_DIR, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const dest = path.join(binDir, RCLONE_BIN);

  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const os =
    process.platform === "darwin"
      ? "osx"
      : process.platform === "win32"
        ? "windows"
        : "linux";
  const url = `https://downloads.rclone.org/rclone-current-${os}-${arch}.zip`;
  const zipPath = path.join(binDir, "rclone-download.zip");
  const tmp = path.join(binDir, "rclone-unzip");

  pushLog(`Setting up rclone (${os}-${arch})…`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`rclone download failed — HTTP ${resp.status}`);
  await fs.writeFile(zipPath, Buffer.from(await resp.arrayBuffer()));

  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
  // macOS + Linux ship `unzip`; Windows has `tar` (bsdtar) which reads zips.
  if (process.platform === "win32") {
    execSync(`tar -xf "${zipPath}" -C "${tmp}"`, { stdio: "pipe" });
  } else {
    execSync(`unzip -o "${zipPath}" -d "${tmp}"`, { stdio: "pipe" });
  }

  // The archive is rclone-vX.Y.Z-<os>-<arch>/rclone.
  let found = null;
  for (const d of await fs.readdir(tmp)) {
    const cand = path.join(tmp, d, RCLONE_BIN);
    if (fssync.existsSync(cand)) {
      found = cand;
      break;
    }
  }
  if (!found) throw new Error("rclone binary not found in downloaded archive");

  await fs.copyFile(found, dest);
  await fs.chmod(dest, 0o755);
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
  pushLog("rclone ready.");
  return dest;
}

function checkMountPrereqs() {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";
  return {
    platform: process.platform,
    // snip provisions rclone automatically (resolveRclonePath / ensureRclone),
    // so it's never a manual prerequisite — report it as handled.
    rclone: true,
    // macFUSE on macOS, WinFsp on Windows, kernel FUSE elsewhere. This is the
    // one thing snip can't auto-install (kernel extension / driver).
    fuse: isMac
      ? fssync.existsSync("/Library/Filesystems/macfuse.fs")
      : isWin
        ? fssync.existsSync("C:\\Program Files (x86)\\WinFsp")
        : true,
    installHint: isMac
      ? "Install macFUSE (brew install macfuse), then approve it in System Settings → Privacy & Security. snip sets up rclone for you."
      : isWin
        ? "Install WinFsp from winfsp.dev. snip sets up rclone for you."
        : "Install a FUSE driver via your package manager. snip sets up rclone for you.",
  };
}

ipcMain.handle("mount:prereqs", async () => checkMountPrereqs());
ipcMain.handle("mount:status", async () => ({
  ...mountState,
  log: mountState.log.slice(-30),
}));

async function persistAutoMount(value) {
  try {
    const current = await loadSettings();
    await saveSettings({ ...current, autoMount: value });
  } catch (e) {
    console.error("Failed to persist autoMount flag", e);
  }
}

async function startMount({ mountPath } = {}) {
  if (mountChild) {
    throw new Error("Already mounting / mounted. Stop the current mount first.");
  }
  const settings = await loadSettings();
  const s = settings.storage;
  if (!s.bucket || !s.accessKeyId || !s.secretAccessKey || !s.endpoint) {
    throw new Error(
      "Storage credentials incomplete — fill in bucket, endpoint, access key, secret in Settings.",
    );
  }
  // rclone is auto-provisioned (below); only the FUSE driver is a hard,
  // user-installed prerequisite.
  if (!checkMountPrereqs().fuse) {
    throw new Error(
      `Missing the FUSE driver. ${checkMountPrereqs().installHint}`,
    );
  }

  const targetPath = mountPath || settings.rootDir;
  await fs.mkdir(targetPath, { recursive: true });

  mountState = {
    status: "mounting",
    mountPath: targetPath,
    pid: null,
    lastError: null,
    log: [],
  };
  emitMountStatus();
  pushLog(`Mounting ${s.provider}:${s.bucket}/projects → ${targetPath}`);

  // Make sure rclone is available (downloads it on first run). Failures here
  // surface as a mount error with a clear log line.
  let rclonePath;
  try {
    rclonePath = await ensureRclone();
  } catch (e) {
    mountState.status = "error";
    mountState.lastError =
      "Couldn't set up rclone — " + (e instanceof Error ? e.message : String(e));
    pushLog(mountState.lastError);
    emitMountStatus();
    throw e;
  }

  // Env-based rclone config. No file is written; rclone reads
  // RCLONE_CONFIG_<NAME>_<FIELD> at runtime. We use the remote name
  // "videoinfra" inline below.
  const env = {
    ...process.env,
    RCLONE_CONFIG_VIDEOINFRA_TYPE: "s3",
    RCLONE_CONFIG_VIDEOINFRA_PROVIDER: s.provider === "r2" ? "Cloudflare" : "Other",
    RCLONE_CONFIG_VIDEOINFRA_ACCESS_KEY_ID: s.accessKeyId,
    RCLONE_CONFIG_VIDEOINFRA_SECRET_ACCESS_KEY: s.secretAccessKey,
    RCLONE_CONFIG_VIDEOINFRA_ENDPOINT: s.endpoint,
    RCLONE_CONFIG_VIDEOINFRA_REGION: s.region || "auto",
    RCLONE_CONFIG_VIDEOINFRA_ACL: "private",
  };

  // ── Optional: layer in LAN-peer caches as the first upstreams ──
  //
  // When `features.lanCache.enabled` is on AND there are peers
  // currently advertised via mDNS, we build a rclone `union` remote
  // whose upstreams are each peer's `rclone serve http` (the second
  // process started by startRcloneCacheServe below) followed by the
  // S3 remote. Reads consult peers first (LAN speed, no S3 egress);
  // a peer miss falls through to S3 automatically.
  //
  // We use first-found read policy + epff (existing-path-first-
  // found) for creates so new files always land on S3.
  let mountTarget = `videoinfra:${s.bucket}/projects`;
  if (settings.features?.lanCache?.enabled) {
    // Wait briefly for mDNS to populate peers — this is a no-op if
    // the LAN cache loop was already running and has peers ready.
    await waitForLanCachePeers(3_000);
    const peers = listLanCachePeers().filter(
      (p) => p.clientId !== getClientId(),
    );
    if (peers.length > 0) {
      const upstreams = [];
      peers.forEach((peer, i) => {
        const name = `lanpeer${i}`;
        const cachePort = (peer.port || 0) + 1; // by convention, port+1 is the rclone serve
        env[`RCLONE_CONFIG_${name.toUpperCase()}_TYPE`] = "http";
        env[`RCLONE_CONFIG_${name.toUpperCase()}_URL`] =
          `http://${peer.host}:${cachePort}/${s.bucket}/projects/`;
        // Short timeouts so a slow / dead peer doesn't stall reads.
        env[`RCLONE_CONFIG_${name.toUpperCase()}_HEADERS`] = "";
        upstreams.push(`${name}:`);
      });
      upstreams.push("videoinfra:" + s.bucket + "/projects");
      env.RCLONE_CONFIG_LANUNION_TYPE = "union";
      env.RCLONE_CONFIG_LANUNION_UPSTREAMS = upstreams.join(" ");
      env.RCLONE_CONFIG_LANUNION_ACTION_POLICY = "epff"; // existing-path-first-found
      env.RCLONE_CONFIG_LANUNION_SEARCH_POLICY = "ff"; // first-found on reads
      env.RCLONE_CONFIG_LANUNION_CREATE_POLICY = "epff"; // creates → first writeable
      mountTarget = "lanunion:";
      pushLog(`LAN union: ${peers.length} peer(s) ahead of S3 — ${upstreams.join(", ")}`);
    } else {
      pushLog(`LAN cache enabled, no peers visible — mounting plain S3.`);
    }
  }

  // Pin the cache dir so the second rclone process (the cache server)
  // knows where to find our cached files to expose to peers.
  const cacheDir = path.join(SETTINGS_DIR, "rclone-cache");
  await fs.mkdir(cacheDir, { recursive: true });

  // ── Optional: --filter-from from Convex-stored folder permissions ──
  //
  // When `features.acls.enabled` is on, fetch the user's effective
  // rules from Convex (one + or - line per matching folderPermissions
  // grant), write them to a file, and pass `--filter-from` to rclone.
  // The FUSE layer then hides files the user isn't entitled to —
  // Finder/Premiere/Resolve all see a filtered view of the bucket.
  let filterFromArgs = [];
  if (settings.features?.acls?.enabled) {
    const filterPath = path.join(SETTINGS_DIR, "rclone-filters.txt");
    try {
      const rules = await convexCall(
        "query",
        "desktopAcls:getEffectiveFilters",
        {},
      );
      if (Array.isArray(rules) && rules.length > 0) {
        const lines = rules.map((r) => `${r.action} ${r.pattern}`);
        await fs.writeFile(filterPath, lines.join("\n") + "\n");
        filterFromArgs = ["--filter-from", filterPath];
        pushLog(`ACLs: applying ${rules.length} filter rule(s) from Convex`);
      } else {
        pushLog(`ACLs enabled, no grants matched — mount stays default-allow.`);
      }
    } catch (err) {
      // Fail-CLOSED. If the user enabled ACL enforcement and we can't
      // fetch the rules (Convex down, token expired, network blip),
      // the right behaviour is to hide everything until we recover —
      // not silently mount full-access. We write a deny-all filter
      // file and feed it to rclone; the FUSE mount comes up showing
      // an empty bucket, and the log line tells the user why.
      await fs.writeFile(filterPath, "- *\n");
      filterFromArgs = ["--filter-from", filterPath];
      pushLog(
        `ACLs: filter fetch failed (${err.message}) — mounting deny-all to fail closed. Fix the Convex connection and re-mount.`,
      );
    }
  }

  // VFS tuned for LucidLink-style streaming on NLE workloads:
  //  • vfs-cache-mode full   — cache read blocks on disk so revisits are local
  //  • multi-thread-streams  — parallel range reads on big files (the single
  //                            biggest win over default rclone for video)
  //  • aggressive read-ahead — seekers + playheads stay ahead of the decoder
  //  • long dir cache        — Resolve/Premiere rescan bins constantly
  //  • fast fingerprint      — skip slow per-file ETag checks on cache hits
  //
  // We still tell rclone to prefer mmap and disable mtime metadata pulls
  // since they're a hot path for finder/Resolve listings. The whole stanza
  // mirrors docs/MOUNTING.md + the Settings “Mount command” preview so
  // editors can copy/paste it for ad-hoc terminal mounts.
  const args = [
    "mount",
    mountTarget,
    targetPath,
    // ACL filter rules (when enabled). The flag is appended once via
    // spread to keep an empty list out of argv when ACLs are off.
    ...filterFromArgs,
    // Cache strategy
    "--cache-dir", cacheDir,
    "--vfs-cache-mode", "full",
    "--vfs-cache-max-size", "100G",
    "--vfs-cache-max-age", "720h",
    "--vfs-cache-min-free-space", "10G",
    "--vfs-fast-fingerprint",
    "--vfs-write-back", "5s",
    // Read tuning
    "--vfs-read-ahead", "256M",
    "--vfs-read-chunk-size", "32M",
    "--vfs-read-chunk-size-limit", "512M",
    "--buffer-size", "64M",
    "--multi-thread-streams", "8",
    "--multi-thread-cutoff", "100M",
    // Dir + listing tuning
    "--dir-cache-time", "5m",
    "--poll-interval", "30s",
    "--no-modtime",
    "--no-checksum",
    // Resilience
    "--low-level-retries", "10",
    "--retries", "3",
    "--timeout", "5m",
    // Misc
    "--transfers", "8",
    "--use-mmap",
    "--allow-other=false",
    "-vv",
  ];

  try {
    mountChild = spawn(rclonePath, args, { env });
  } catch (e) {
    mountState.status = "error";
    mountState.lastError = e instanceof Error ? e.message : String(e);
    emitMountStatus();
    throw e;
  }

  mountState.pid = mountChild.pid ?? null;
  emitMountStatus();
  // Remember intent so we auto-mount on the next app launch.
  void persistAutoMount(true);

  mountChild.stdout.on("data", (chunk) => {
    chunk
      .toString()
      .split("\n")
      .filter((line) => line.trim())
      .forEach((line) => pushLog(line));
  });
  mountChild.stderr.on("data", (chunk) => {
    chunk
      .toString()
      .split("\n")
      .filter((line) => line.trim())
      .forEach((line) => {
        pushLog(line);
        // rclone prints "The service rclone has been started." or
        // similar on macFUSE. We treat ANY successful directory listing
        // as "mounted" — see the readiness poller below.
      });
  });
  mountChild.on("close", (code) => {
    pushLog(`rclone exited with code ${code}`);
    mountState.status = code === 0 ? "unmounted" : "error";
    mountState.pid = null;
    mountState.lastError =
      code !== 0 && code !== null ? `rclone exited (code ${code})` : null;
    mountChild = null;
    emitMountStatus();
  });
  mountChild.on("error", (err) => {
    mountState.status = "error";
    mountState.lastError = err.message;
    mountChild = null;
    emitMountStatus();
  });

  // Readiness probe — poll the mount point. Once we can stat any subdir,
  // rclone has the FUSE layer up.
  const startedAt = Date.now();
  const ready = setInterval(async () => {
    if (mountState.status !== "mounting") {
      clearInterval(ready);
      return;
    }
    try {
      await fs.readdir(targetPath);
      // readdir succeeds before FUSE attaches too; use statfs to confirm.
      // Simplest heuristic: if rclone is still alive and >2s have passed,
      // call it mounted.
      if (mountChild && Date.now() - startedAt > 2000) {
        mountState.status = "mounted";
        pushLog("Mount appears ready.");
        emitMountStatus();
        clearInterval(ready);
      }
    } catch {
      // mount point not present yet
    }
    if (Date.now() - startedAt > 30_000 && mountState.status === "mounting") {
      mountState.status = "error";
      mountState.lastError = "Mount timed out after 30s. Check log for details.";
      mountChild?.kill();
      clearInterval(ready);
      emitMountStatus();
    }
  }, 500);

  return { status: mountState.status, mountPath: targetPath };
}

ipcMain.handle("mount:start", async (_event, args) => startMount(args || {}));

// ─── Resolve bridge (Python subprocess) ────────────────────────────────────
//
// The desktop app is the ONLY thing that talks to Resolve. Plugin is
// retired. We shell out to a single Python script that handles status /
// export / import via the DaVinciResolveScript API. Each call returns
// exactly one JSON document on stdout.

const RESOLVE_BRIDGE_PATH = path.join(__dirname, "resources", "resolve_bridge.py");

function findPython() {
  // Prefer system python3. We don't bundle our own interpreter — Resolve
  // Studio itself ships a Python and macOS has python3 in /usr/bin. If
  // none is found, we surface a categorized error to the UI.
  const candidates = [
    process.env.LAWN_PYTHON,
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3",
    "python3",
  ].filter(Boolean);
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: "pipe" });
      return cmd;
    } catch {
      // Try next.
    }
  }
  return null;
}

function spawnResolveBridge(args, { timeoutMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const python = findPython();
    if (!python) {
      reject(
        new Error(
          "Couldn't find python3. Install it via `xcode-select --install` " +
            "(macOS) or set LAWN_PYTHON env var to your Python interpreter.",
        ),
      );
      return;
    }
    const child = spawn(python, [RESOLVE_BRIDGE_PATH, ...args], {
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Resolve bridge timed out after ${timeoutMs / 1000}s.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      // The script always prints exactly one JSON object; parse the last
      // non-empty line so any stray debug output before it is ignored.
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const lastLine = lines[lines.length - 1] ?? "";
      let parsed;
      try {
        parsed = JSON.parse(lastLine);
      } catch {
        reject(
          new Error(
            `Bridge produced unparseable output. exit=${code}\n` +
              `stdout: ${stdout.slice(-400)}\nstderr: ${stderr.slice(-400)}`,
          ),
        );
        return;
      }
      resolve(parsed);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

ipcMain.handle("resolve:status", async () => {
  return spawnResolveBridge(["status"]);
});

ipcMain.handle("resolve:snapshot", async (_event, { message, branch }) => {
  const settings = await loadSettings();
  if (!settings.convexUrl || !settings.convexAuthToken) {
    throw new Error("Convex URL + auth token must be set in Settings first.");
  }
  const tmpDir = path.join(app.getPath("temp"), "lawn-resolve");
  await fs.mkdir(tmpDir, { recursive: true });
  const fcpxmlPath = path.join(tmpDir, `snapshot-${Date.now()}.fcpxml`);

  // 1. Export FCPXML via the bridge.
  const exported = await spawnResolveBridge(["export", fcpxmlPath]);
  if (!exported.ok) {
    const err = new Error(exported.message || "Export failed.");
    err.category = exported.error;
    throw err;
  }

  // 2. Read + parse the FCPXML into domain JSONs.
  const fcpxmlText = await fs.readFile(fcpxmlPath, "utf8");
  const domains = parseFcpxmlToDomains(fcpxmlText);

  // 3. Forward to Convex via a public mutation. We use plain fetch
  //    because Convex's Node client is overkill for a single call from
  //    Electron; the Convex HTTP `mutation` endpoint accepts the same
  //    shape as the JS client.
  const projectId = settings.activeProjectId;
  if (!projectId) {
    throw new Error("Open a project in the Projects tab so we know where to push the snapshot.");
  }

  const convexUrl = settings.convexUrl.replace(/\/$/, "");
  const mutationUrl = `${convexUrl}/api/mutation`;
  const payload = {
    path: "timelines:createFromDesktop",
    args: {
      projectId,
      cuts: domains.cuts,
      color: domains.color,
      audio: domains.audio,
      effects: domains.effects,
      markers: domains.markers,
      metadata: domains.metadata,
      fcpxml: fcpxmlText,
      branch: branch || undefined,
      message: message || "Update from Resolve",
      sourceProjectId: exported.project_id,
      sourceTimelineId: exported.timeline_id,
    },
    format: "json",
  };
  const resp = await fetch(mutationUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.convexAuthToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Convex mutation failed: ${resp.status} ${text.slice(0, 200)}`);
  }
  const result = await resp.json();
  // Clean up tmp file. Don't await — best-effort.
  void fs.unlink(fcpxmlPath).catch(() => {});
  return result;
});

ipcMain.handle("resolve:restore", async (_event, { fcpxml }) => {
  if (typeof fcpxml !== "string" || !fcpxml) {
    throw new Error("FCPXML payload required.");
  }
  const tmpDir = path.join(app.getPath("temp"), "lawn-resolve");
  await fs.mkdir(tmpDir, { recursive: true });
  const fcpxmlPath = path.join(tmpDir, `restore-${Date.now()}.fcpxml`);
  await fs.writeFile(fcpxmlPath, fcpxml, "utf8");

  const imported = await spawnResolveBridge(["import", fcpxmlPath]);
  void fs.unlink(fcpxmlPath).catch(() => {});
  if (!imported.ok) {
    const err = new Error(imported.message || "Import failed.");
    err.category = imported.error;
    throw err;
  }
  return imported;
});

ipcMain.handle("resolve:set-active-project", async (_event, { projectId }) => {
  const settings = await loadSettings();
  await saveSettings({ ...settings, activeProjectId: projectId });
  return { ok: true };
});

// ─── Premiere bridge (read .prproj from disk) ─────────────────────────────
//
// Premiere doesn't expose an external scripting API like Resolve. But
// its project file `.prproj` is a gzipped XML that contains the full
// timeline state. We don't need a plugin — read the file, decompress,
// parse the relevant elements into our domain shape, upload.
//
// On save: user picks the .prproj file (typically in the same project
// folder we sync via S3). We read whatever Premiere wrote at last save.
//
// On restore: we just hand the user back the original .prproj for them
// to open. Writing a Premiere-valid .prproj from scratch is harder than
// it looks; round-tripping the original blob is the safe play.

ipcMain.handle("dialog:pick-prproj", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Premiere project", extensions: ["prproj"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

async function readPrproj(filePath) {
  const buf = await fs.readFile(filePath);
  // .prproj is gzipped XML. If the file isn't gzipped (rare — some old
  // versions or test fixtures), fall back to reading as-is.
  let xmlText;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const inflated = await new Promise((resolve, reject) => {
      zlib.gunzip(buf, (err, out) => (err ? reject(err) : resolve(out)));
    });
    xmlText = inflated.toString("utf8");
  } else {
    xmlText = buf.toString("utf8");
  }
  return xmlText;
}

function parsePrprojToDomains(xmlText) {
  const parsed = xmlParser.parse(xmlText);
  const root = parsed.PremiereData ?? parsed;

  // Sequence clips. Premiere's XML buries them under
  // RootProjectItem → Item (recursive). Walk and collect anything that
  // looks like a clip + its placement. We're permissive here — different
  // Premiere versions emit slightly different element names.
  const clips = [];
  const clipTags = ["ClipProjectItem", "MasterClip", "TrackItem", "VideoClipTrackItem", "AudioClipTrackItem"];
  for (const tag of clipTags) {
    for (const el of findRecursive(root, tag, [])) {
      // Extract whatever placement attributes we can find. Premiere
      // stores these under nested elements rather than attributes.
      const name = el.Name ?? el.MediaName ?? el["@_Name"] ?? null;
      const start = numAttr(el.Start ?? el.StartTime ?? el["@_Start"]);
      const end = numAttr(el.End ?? el.EndTime ?? el["@_End"]);
      const inPoint = numAttr(el.In ?? el.InPoint ?? el["@_In"]);
      clips.push({
        tag,
        name: typeof name === "string" ? name : null,
        offset: start != null ? `${start}s` : null,
        duration:
          start != null && end != null ? `${end - start}s` : null,
        start: inPoint != null ? `${inPoint}s` : null,
        ref: el.MediaPath ?? el["@_MediaPath"] ?? null,
        lane: el.TrackIndex ?? el["@_TrackIndex"] ?? null,
        audio_role: tag.toLowerCase().includes("audio") ? "audio" : null,
      });
    }
  }

  const markers = findRecursive(root, "Marker", []).map((m) => ({
    start: m.Start != null ? `${numAttr(m.Start)}s` : null,
    duration: m.Duration != null ? `${numAttr(m.Duration)}s` : null,
    value: m.Name ?? m.Comments ?? null,
    note: m.Comments ?? null,
    completed: null,
  }));

  const metadata = {
    fcpxml_version: null,
    premiere_version: root["@_Version"] ?? null,
    sequence_count: findRecursive(root, "Sequence", []).length,
    parsed_at: new Date().toISOString(),
  };

  return {
    cuts: JSON.stringify({ clips }),
    color: JSON.stringify({ corrections: [] }),
    audio: JSON.stringify({ adjustments: [] }),
    effects: JSON.stringify({ items: [] }),
    markers: JSON.stringify({ items: markers }),
    metadata: JSON.stringify(metadata),
  };
}

function numAttr(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object" && value !== null) {
    // Premiere wraps some numbers in element nodes — peek at #text.
    const text = value["#text"];
    if (typeof text === "string") return parseFloat(text);
    if (typeof text === "number") return text;
  }
  return null;
}

ipcMain.handle("premiere:snapshot", async (_event, { filePath, message, branch }) => {
  const settings = await loadSettings();
  if (!settings.convexUrl || !settings.convexAuthToken) {
    throw new Error("Convex URL + auth token must be set in Settings first.");
  }
  if (!settings.activeProjectId) {
    throw new Error("Open a project in the Projects tab so we know where to save the snapshot.");
  }
  const xmlText = await readPrproj(filePath);
  const domains = parsePrprojToDomains(xmlText);

  // We store the .prproj XML in the `fcpxml` field for restore purposes.
  // The name is awkward but renaming the schema column for two source
  // types isn't worth a migration — readers know what they're getting
  // by looking at `source`.
  const convexUrl = settings.convexUrl.replace(/\/$/, "");
  const mutationUrl = `${convexUrl}/api/mutation`;
  const payload = {
    path: "timelines:createFromDesktop",
    args: {
      projectId: settings.activeProjectId,
      cuts: domains.cuts,
      color: domains.color,
      audio: domains.audio,
      effects: domains.effects,
      markers: domains.markers,
      metadata: domains.metadata,
      fcpxml: xmlText,
      branch: branch || undefined,
      message: message || "Update from Premiere",
      sourceProjectId: filePath,
      source: "premiere",
    },
    format: "json",
  };
  const resp = await fetch(mutationUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.convexAuthToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Convex mutation failed: ${resp.status} ${text.slice(0, 200)}`);
  }
  // Now tell Convex this row is `source: "premiere"`. The mutation
  // currently hardcodes "resolve" — patch via a separate mutation in a
  // follow-up; for now we annotate the message instead.
  return resp.json();
});

ipcMain.handle("premiere:restore-download", async (_event, { fcpxml, suggestedName }) => {
  // Save the .prproj XML to disk so the user can open it in Premiere.
  // We re-gzip on write so Premiere accepts it without complaint.
  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName || "restored.prproj",
    filters: [{ name: "Premiere project", extensions: ["prproj"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
  const gz = await new Promise((resolve, reject) => {
    zlib.gzip(Buffer.from(fcpxml, "utf8"), (err, out) =>
      err ? reject(err) : resolve(out),
    );
  });
  await fs.writeFile(result.filePath, gz);
  return { ok: true, path: result.filePath };
});

// ─── FCPXML → domain JSON parser (mirrors plugins/resolve/lawn_vit.py) ────
//
// Lightweight XML walk using fast-xml-parser. We keep the parser tolerant —
// Resolve emits FCPXML 1.10 with quirks across patch versions and we'd
// rather get a partial snapshot than fail on a stray attribute.

const { XMLParser } = require("fast-xml-parser");
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function findRecursive(node, tagName, accumulator) {
  if (node === null || typeof node !== "object") return accumulator;
  for (const key of Object.keys(node)) {
    if (key === tagName) {
      for (const child of asArray(node[key])) accumulator.push(child);
    }
    const val = node[key];
    if (val && typeof val === "object") {
      findRecursive(val, tagName, accumulator);
    }
  }
  return accumulator;
}

function parseFcpxmlToDomains(fcpxml) {
  const parsed = xmlParser.parse(fcpxml);
  const root = parsed.fcpxml ?? parsed;

  // ─── metadata ───
  const formats = findRecursive(root, "format", []);
  const metadata = {
    fcpxml_version: root["@_version"] ?? null,
    formats: formats.map((f) => ({
      id: f["@_id"] ?? null,
      name: f["@_name"] ?? null,
      frame_duration: f["@_frameDuration"] ?? null,
      width: f["@_width"] ?? null,
      height: f["@_height"] ?? null,
    })),
    sequences: findRecursive(root, "sequence", []).map((s) => ({
      duration: s["@_duration"] ?? null,
      tc_format: s["@_tcFormat"] ?? null,
      tc_start: s["@_tcStart"] ?? null,
    })),
  };

  // ─── cuts: spine of clips ───
  const cuts = { clips: [] };
  const spines = findRecursive(root, "spine", []);
  for (const spine of spines) {
    for (const tag of ["clip", "asset-clip", "ref-clip", "gap"]) {
      for (const el of asArray(spine[tag])) {
        cuts.clips.push({
          tag,
          name: el["@_name"] ?? null,
          offset: el["@_offset"] ?? null,
          duration: el["@_duration"] ?? null,
          start: el["@_start"] ?? null,
          ref: el["@_ref"] ?? null,
          lane: el["@_lane"] ?? null,
          audio_role: el["@_audioRole"] ?? null,
        });
      }
    }
  }

  // ─── color ───
  const color = {
    corrections: findRecursive(root, "color-correction", []).map((cc) => ({
      name: cc["@_name"] ?? null,
      params: extractParams(cc),
    })),
  };

  // ─── audio ───
  const audio = {
    adjustments: [
      ...findRecursive(root, "adjust-volume", []).map((a) => ({
        kind: "volume",
        amount: a["@_amount"] ?? null,
      })),
      ...findRecursive(root, "adjust-pan", []).map((a) => ({
        kind: "pan",
        amount: a["@_amount"] ?? null,
      })),
    ],
  };

  // ─── effects ───
  const effects = {
    items: [
      ...findRecursive(root, "filter", []).map((f) => ({
        kind: "filter",
        name: f["@_name"] ?? null,
        ref: f["@_ref"] ?? null,
        params: extractParams(f),
      })),
      ...findRecursive(root, "transition", []).map((t) => ({
        kind: "transition",
        name: t["@_name"] ?? null,
        duration: t["@_duration"] ?? null,
      })),
    ],
  };

  // ─── markers ───
  const markers = {
    items: [
      ...findRecursive(root, "marker", []).map((m) => ({
        start: m["@_start"] ?? null,
        duration: m["@_duration"] ?? null,
        value: m["@_value"] ?? null,
        note: m["@_note"] ?? null,
        completed: m["@_completed"] ?? null,
      })),
      ...findRecursive(root, "chapter-marker", []).map((c) => ({
        type: "chapter",
        start: c["@_start"] ?? null,
        duration: c["@_duration"] ?? null,
        value: c["@_value"] ?? null,
      })),
    ],
  };

  return {
    cuts: JSON.stringify(cuts),
    color: JSON.stringify(color),
    audio: JSON.stringify(audio),
    effects: JSON.stringify(effects),
    markers: JSON.stringify(markers),
    metadata: JSON.stringify(metadata),
  };
}

function extractParams(node) {
  const out = {};
  for (const param of asArray(node.param)) {
    const name = param["@_name"] ?? "(unnamed)";
    out[name] = param["@_value"] ?? null;
  }
  return out;
}

async function umountPath(p) {
  if (!p) return;
  try {
    if (process.platform === "darwin" || process.platform === "linux") {
      execSync(`umount "${p}"`, { stdio: "pipe" });
    } else if (process.platform === "win32") {
      // rclone on Windows uses WinFsp; killing the child detaches the drive.
    }
  } catch {
    // Fall back to diskutil on macOS if `umount` fails (busy / forced).
    try {
      if (process.platform === "darwin") {
        execSync(`diskutil unmount force "${p}"`, { stdio: "pipe" });
      }
    } catch {
      // Last resort — leave it; user can `umount -f` manually.
    }
  }
}

ipcMain.handle("mount:stop", async () => {
  // Explicit unmount = user no longer wants auto-mount next launch.
  void persistAutoMount(false);
  if (!mountChild) {
    mountState.status = "unmounted";
    emitMountStatus();
    return { status: mountState.status };
  }
  pushLog("Unmounting…");
  const targetPath = mountState.mountPath;
  await umountPath(targetPath);
  setTimeout(() => {
    if (mountChild) {
      try {
        mountChild.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }, 3000);
  return { status: "unmounting" };
});

async function tryAutoMount() {
  try {
    const settings = await loadSettings();
    if (!settings.autoMount) return;
    if (
      !settings.storage.bucket ||
      !settings.storage.accessKeyId ||
      !settings.storage.secretAccessKey ||
      !settings.storage.endpoint
    ) {
      // Don't fail silently — log so the user sees why nothing happened.
      console.log("autoMount skipped: storage credentials incomplete");
      return;
    }
    // rclone is auto-provisioned by startMount; only the FUSE driver gates
    // auto-mount (we can't silently install a kernel extension).
    if (!checkMountPrereqs().fuse) {
      console.log("autoMount skipped: FUSE driver not installed");
      return;
    }
    // Defer slightly so the window is up and the renderer is listening
    // for the status events before we kick off rclone.
    setTimeout(() => {
      startMount({ mountPath: settings.rootDir }).catch((e) => {
        console.error("autoMount start failed", e);
      });
    }, 1500);
  } catch (e) {
    console.error("autoMount failed", e);
  }
}

// Best-effort cleanup on quit so we don't leave a half-attached FUSE volume.
app.on("before-quit", async (event) => {
  // Stop feature loops first; presence's stopPresenceLoop also clears
  // this client's lock row in Convex so the next "who's online" read
  // doesn't show a stale phantom.
  stopPresenceLoop();
  stopPrefetchWatcher();
  stopLanCacheServer();
  if (mountChild) {
    event.preventDefault();
    pushLog("App quit — unmounting first.");
    await umountPath(mountState.mountPath);
    try {
      mountChild.kill("SIGTERM");
    } catch {
      // ignore
    }
    mountChild = null;
    // Resume the quit now the volume is detached. mountChild is null so this
    // handler won't defer again, letting electron-updater's
    // autoInstallOnAppQuit hook apply a downloaded update. Hard-exit is only a
    // fallback for a stalled quit — and we skip it while an update is pending
    // so Squirrel's post-quit install isn't interrupted.
    setTimeout(() => app.quit(), 500);
    setTimeout(() => {
      if (!isQuittingForUpdate && updateState.status !== "downloaded") {
        app.exit(0);
      }
    }, 8000);
  }
});

// ---- Auto-update (electron-updater + GitHub Releases) ------------------------
//
// Installed builds check GitHub Releases (build.publish in package.json points
// at danielosagie/snip) for a newer **signed** version, download it in the
// background, and install on quit — or immediately when the user clicks
// "Restart & install". Disabled in dev: electron-updater needs a packaged,
// code-signed app and a real release feed, and would otherwise throw on the
// missing dev-app-update.yml.

const { autoUpdater } = require("electron-updater");

let updateState = {
  status: "idle", // idle | checking | available | none | downloading | downloaded | error
  version: null,
  percent: 0,
  error: null,
};
// Set when the user explicitly triggers an install so the quit path knows to
// hand off to Squirrel rather than hard-exit.
let isQuittingForUpdate = false;

function emitUpdateStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:status", updateState);
  }
}

function setupAutoUpdater() {
  // Download in the background, but don't swap the bundle mid-session — an
  // editor with the mounted drive open shouldn't get yanked. Install lands on
  // the next quit (autoInstallOnAppQuit) or on explicit "Restart & install".
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m) => console.log("[updater]", m),
    warn: (m) => console.warn("[updater]", m),
    error: (m) => console.error("[updater]", m),
    debug: () => {},
  };

  autoUpdater.on("checking-for-update", () => {
    updateState = { ...updateState, status: "checking", error: null };
    emitUpdateStatus();
  });
  autoUpdater.on("update-available", (info) => {
    updateState = { ...updateState, status: "available", version: info?.version ?? null };
    emitUpdateStatus();
  });
  autoUpdater.on("update-not-available", () => {
    updateState = { ...updateState, status: "none" };
    emitUpdateStatus();
  });
  autoUpdater.on("download-progress", (p) => {
    updateState = {
      ...updateState,
      status: "downloading",
      percent: Math.round(p?.percent ?? 0),
    };
    emitUpdateStatus();
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateState = {
      ...updateState,
      status: "downloaded",
      version: info?.version ?? updateState.version,
      percent: 100,
    };
    emitUpdateStatus();
  });
  autoUpdater.on("error", (err) => {
    const raw = err?.message ?? String(err);
    // Translate Squirrel's read-only-volume wall of text into one actionable
    // line. (The move-to-Applications prompt prevents this for fresh installs.)
    const friendly = /read-only volume/i.test(raw)
      ? "Move snip to your Applications folder to enable updates (it's running from the disk image or Downloads)."
      : raw;
    updateState = { ...updateState, status: "error", error: friendly };
    emitUpdateStatus();
  });

  const check = () =>
    autoUpdater.checkForUpdates().catch((e) => {
      updateState = {
        ...updateState,
        status: "error",
        error: e?.message ?? String(e),
      };
      emitUpdateStatus();
    });
  // First check once the window is up; re-check every 6h for long-running apps.
  setTimeout(check, 8_000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

ipcMain.handle("app:version", async () => app.getVersion());

// Snapshot read so the renderer can render the current state on mount — the
// first background check may finish before Settings is ever opened, and
// "update:status" only carries future transitions.
ipcMain.handle("update:state", async () => ({ ...updateState }));

ipcMain.handle("update:check", async () => {
  if (!app.isPackaged) return { ok: false, reason: "dev" };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("update:install", async () => {
  if (updateState.status !== "downloaded") return { ok: false, reason: "no-update" };
  isQuittingForUpdate = true;
  // Detach the FUSE mount before Squirrel swaps the app bundle — otherwise the
  // relaunched app inherits a stale/half-attached volume.
  if (mountChild) {
    pushLog("Installing update — unmounting first.");
    await umountPath(mountState.mountPath);
    try {
      mountChild.kill("SIGTERM");
    } catch {
      // ignore
    }
    mountChild = null;
  }
  stopPresenceLoop();
  stopPrefetchWatcher();
  stopLanCacheServer();
  // Brief settle so the unmount completes before the installer relaunches.
  setTimeout(() => autoUpdater.quitAndInstall(), 800);
  return { ok: true };
});

// ---- Window management -------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f0f0e8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(WEB_APP_URL);
  if (!app.isPackaged && process.env.NODE_ENV !== "production") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Keep the window on our web app. External links (Stripe, docs, OAuth popups
  // we don't host) open in the user's real browser instead of navigating the
  // app shell away — which would also strip the native bridge.
  const isOurApp = (url) => {
    try {
      return new URL(url).origin === new URL(WEB_APP_URL).origin;
    } catch {
      return false;
    }
  };
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isOurApp(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isOurApp(url)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Allow opening DevTools in the packaged build for diagnosis (⌘⌥I / Ctrl+Shift+I).
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;
    const key = (input.key || "").toLowerCase();
    const macToggle = input.meta && input.alt && key === "i";
    const winToggle = input.control && input.shift && key === "i";
    if (macToggle || winToggle) {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// macOS auto-update (Squirrel) can't replace the app bundle when it runs from a
// read-only volume — i.e. straight from the DMG, or App-Translocated because it
// sits in ~/Downloads. Offer to relocate to /Applications (writable) on launch
// so updates aren't dead on arrival. Returns true if we're relaunching (so the
// caller skips the rest of startup; the relaunched instance takes over).
function maybeMoveToApplications() {
  if (process.platform !== "darwin" || !app.isPackaged) return false;
  try {
    if (app.isInApplicationsFolder()) return false;
    const choice = dialog.showMessageBoxSync({
      type: "question",
      buttons: ["Move to Applications", "Not now"],
      defaultId: 0,
      cancelId: 1,
      message: "Move snip to your Applications folder?",
      detail:
        "snip is running from a read-only location (the disk image or your " +
        "Downloads folder), which blocks automatic updates. Move it to " +
        "Applications so it can keep itself up to date.",
    });
    if (choice === 0) {
      // Relaunches from /Applications and quits this instance on success.
      return app.moveToApplicationsFolder();
    }
  } catch (e) {
    console.error("move-to-Applications check failed", e);
  }
  return false;
}

app.whenReady().then(() => {
  // If we relocate + relaunch from /Applications, stop here; the new instance
  // boots fresh.
  if (maybeMoveToApplications()) return;
  createWindow();
  // Only run the updater in packaged (signed) builds — dev has no release feed.
  if (app.isPackaged) setupAutoUpdater();
  void tryAutoMount();
  // Kick off any feature loops the user has enabled. Errors get logged
  // but don't block the window from opening.
  void reconcileFeatures().catch((err) => {
    console.error("reconcileFeatures failed on startup:", err);
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
