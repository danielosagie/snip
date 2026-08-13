"use strict";

/**
 * Auto-backup engine.
 *
 * Mirrors a local folder (or a whole attached volume) into a snip project,
 * incrementally, in the background.
 *
 * Why it uploads the way it does:
 *   Bytes could be pushed straight to S3 with the desktop's own creds — but
 *   objects written that way are invisible to the web app, which reads the
 *   Convex `videos` tree, not the bucket. So a backup takes the SAME three
 *   steps the WebDAV drive takes for a Finder drop:
 *     1. `ensureFolderForDesktop` for each folder level (idempotent),
 *     2. `createUploadForDesktop` → presigned candidate key,
 *     3. PUT the bytes, then `commitUploadForDesktop` to publish the row.
 *   A backed-up file is therefore indistinguishable from a dragged-in one.
 *
 * What "incremental" means here:
 *   A per-source manifest records size + mtime per relative path. A file is
 *   re-uploaded when it is new, when its size changed, or when its mtime
 *   changed. Content is never hashed during a scan: hashing a multi-terabyte
 *   drive on every pass would cost hours of disk read to answer a question
 *   size+mtime already answers. Files are re-stat'ed after upload — if they
 *   moved under us mid-copy the manifest is left dirty so the next pass
 *   retries, which is why no "settle" delay is needed.
 */

const path = require("node:path");
const fs = require("node:fs/promises");
const fssync = require("node:fs");

/**
 * Junk that every backup should skip. These are OS bookkeeping directories,
 * not user data — copying them wastes upload and clutters the project tree.
 */
const SYSTEM_IGNORES = Object.freeze([
  ".DS_Store",
  ".Spotlight-V100",
  ".DocumentRevisions-V100",
  ".TemporaryItems",
  ".Trashes",
  ".fseventsd",
  ".vol",
  "$RECYCLE.BIN",
  "System Volume Information",
  "lost+found",
  "node_modules",
]);

/**
 * Tripwire, not a budget. macOS caps a path at 1024 bytes; at a realistic ~15
 * characters per directory name a genuine tree bottoms out around 60 levels
 * before the OS itself refuses. 64 sits just past that, so only a pathological
 * or looping tree can reach it — and when it does we say so by name rather
 * than recursing until the stack dies.
 */
const MAX_DEPTH = 64;

/** A single PUT caps at 5 GB on S3 and R2; above it we stream multipart. */
const SINGLE_PUT_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Concurrent uploads per run. Backups are bandwidth-bound, not CPU-bound: 3
 * in-flight streams keep a typical uplink saturated while leaving headroom for
 * the mounted drive's own transfers. Raise it in settings if the pipe is fatter.
 */
const DEFAULT_CONCURRENCY = 3;

/** Coalescing window for progress events, ~5 updates/sec. */
const PROGRESS_THROTTLE_MS = 200;

/** Per-file upload attempts before the file is recorded as failed and skipped. */
const UPLOAD_ATTEMPTS = 3;

/**
 * Folder names snip will accept. Must match `ensureFolderForDesktop` in
 * convex/desktopBrowse.ts — if we send a name the server would rewrite, the
 * later upload resolves against a folder that does not exist under that name.
 */
function sanitizeFolderName(raw) {
  const name = String(raw ?? "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  return name;
}

function isIgnoredEntry(name, { includeHidden = false } = {}) {
  if (SYSTEM_IGNORES.includes(name)) return true;
  if (!includeHidden && name.startsWith(".")) return true;
  return false;
}

function toPosixRelative(relPath) {
  return relPath.split(path.sep).join("/");
}

/**
 * Walk a source root and return every regular file under it.
 *
 * Symlinks are skipped outright rather than followed: a backup that follows
 * links can loop forever, and can silently copy data from outside the folder
 * the user actually chose.
 */
async function scanSource(
  root,
  { includeHidden = false, readdir = fs.readdir, lstat = fs.lstat, onLog = () => {} } = {},
) {
  const files = [];
  let skippedDeep = 0;
  let skippedLinks = 0;

  async function recurse(dir, relDir, depth) {
    if (depth > MAX_DEPTH) {
      skippedDeep += 1;
      onLog(
        `backup: stopped at depth ${MAX_DEPTH} (limit MAX_DEPTH=${MAX_DEPTH}) under ${relDir || "."}`,
      );
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      onLog(`backup: could not read ${dir}: ${error.message}`);
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (isIgnoredEntry(name, { includeHidden })) continue;
      const absolute = path.join(dir, name);
      const relative = relDir ? `${relDir}/${name}` : name;

      // Dirent from a plain readdir already tells us symlink vs dir vs file;
      // lstat is the fallback when a caller injects a bare readdir in tests.
      let isDirectory = entry.isDirectory?.();
      let isFile = entry.isFile?.();
      const isLink = entry.isSymbolicLink?.();
      if (isLink) {
        skippedLinks += 1;
        continue;
      }
      if (isDirectory === undefined && isFile === undefined) {
        const stat = await lstat(absolute).catch(() => null);
        if (!stat) continue;
        if (stat.isSymbolicLink()) {
          skippedLinks += 1;
          continue;
        }
        isDirectory = stat.isDirectory();
        isFile = stat.isFile();
      }

      if (isDirectory) {
        await recurse(absolute, relative, depth + 1);
        continue;
      }
      if (!isFile) continue;

      const stat = await lstat(absolute).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      files.push({
        relPath: toPosixRelative(relative),
        absolutePath: absolute,
        size: stat.size,
        mtimeMs: Math.floor(stat.mtimeMs),
      });
    }
  }

  await recurse(root, "", 0);
  return { files, skippedDeep, skippedLinks };
}

/**
 * Diff a scan against the manifest. Pure — the whole "what needs uploading"
 * decision is one testable function.
 */
function planUploads(files, manifest) {
  const entries = manifest?.entries ?? {};
  const uploads = [];
  let unchangedCount = 0;
  let unchangedBytes = 0;
  let pendingBytes = 0;

  for (const file of files) {
    const known = entries[file.relPath];
    const changed =
      !known || known.size !== file.size || known.mtimeMs !== file.mtimeMs;
    if (changed) {
      uploads.push(file);
      pendingBytes += file.size;
    } else {
      unchangedCount += 1;
      unchangedBytes += file.size;
    }
  }

  return {
    uploads,
    unchangedCount,
    unchangedBytes,
    pendingBytes,
    totalCount: files.length,
  };
}

/**
 * Local paths that no longer exist are LEFT in the manifest and left in snip.
 * A backup that deletes remotely when a file disappears locally is a delete
 * amplifier: unplug the drive mid-scan and it erases the copy you kept it for.
 */
function manifestPathFor(directory, sourceId) {
  return path.join(directory, `${sourceId}.json`);
}

async function loadManifest(directory, sourceId, { readFile = fs.readFile } = {}) {
  try {
    const raw = await readFile(manifestPathFor(directory, sourceId), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.entries !== "object") {
      return { version: 1, entries: {} };
    }
    return { version: 1, entries: parsed.entries ?? {} };
  } catch {
    return { version: 1, entries: {} };
  }
}

async function saveManifest(
  directory,
  sourceId,
  manifest,
  { writeFile = fs.writeFile, mkdir = fs.mkdir, rename = fs.rename } = {},
) {
  await mkdir(directory, { recursive: true });
  // Write-then-rename: a crash mid-write must not leave a truncated manifest,
  // which would read as "nothing was ever backed up" and re-upload everything.
  const finalPath = manifestPathFor(directory, sourceId);
  const tempPath = `${finalPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(manifest), "utf8");
  await rename(tempPath, finalPath);
}

/** Relative path → the snip folder segments it lands in, under `baseFolder`. */
function destinationFolderFor(relPath, baseFolder = []) {
  const parts = relPath.split("/");
  parts.pop(); // file name
  const segments = [...baseFolder, ...parts]
    .map(sanitizeFolderName)
    .filter(Boolean);
  return segments;
}

function contentTypeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase().replace(".", "");
  const map = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    webm: "video/webm",
    mxf: "application/mxf",
    braw: "application/octet-stream",
    r3d: "application/octet-stream",
    wav: "audio/wav",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    mp3: "audio/mpeg",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    tif: "image/tiff",
    tiff: "image/tiff",
    pdf: "application/pdf",
    zip: "application/zip",
  };
  return map[ext] || "application/octet-stream";
}

function emptyRun(sourceId) {
  return {
    sourceId,
    state: "idle", // idle | scanning | uploading | done | error | cancelled
    filesTotal: 0,
    filesDone: 0,
    filesFailed: 0,
    filesSkipped: 0,
    bytesTotal: 0,
    bytesDone: 0,
    currentFile: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    reason: null,
  };
}

/**
 * @param {object} deps
 * @param {(kind: string, fnPath: string, args: object) => Promise<any>} deps.convexCall
 * @param {(args: {key: string, body: any, contentType: string}) => Promise<void>} [deps.uploadObject]
 *   Multipart uploader, used only for files above the 5 GB single-PUT ceiling.
 * @param {string} deps.manifestDirectory
 * @param {(event: object) => void} [deps.onEvent]
 * @param {(line: string) => void} [deps.onLog]
 */
function createBackupEngine({
  convexCall,
  uploadObject = null,
  manifestDirectory,
  onEvent = () => {},
  onLog = () => {},
  concurrency = DEFAULT_CONCURRENCY,
  now = () => Date.now(),
  createReadStream = fssync.createReadStream,
  statFile = fs.stat,
  fetchImpl = (...args) => fetch(...args),
  scan = scanSource,
}) {
  if (typeof convexCall !== "function") {
    throw new TypeError("createBackupEngine requires a convexCall function.");
  }

  /** @type {Map<string, object>} sourceId → run status */
  const runs = new Map();
  /** @type {Map<string, {cancelled: boolean}>} */
  const tokens = new Map();
  let lastEmit = 0;

  function statusFor(sourceId) {
    if (!runs.has(sourceId)) runs.set(sourceId, emptyRun(sourceId));
    return runs.get(sourceId);
  }

  function emit({ force = false } = {}) {
    const ts = now();
    if (!force && ts - lastEmit < PROGRESS_THROTTLE_MS) return;
    lastEmit = ts;
    onEvent({ kind: "backup:progress", runs: [...runs.values()].map((r) => ({ ...r })) });
  }

  function isRunning(sourceId) {
    const run = runs.get(sourceId);
    return run?.state === "scanning" || run?.state === "uploading";
  }

  function cancel(sourceId) {
    const token = tokens.get(sourceId);
    if (token) token.cancelled = true;
  }

  function cancelAll() {
    for (const token of tokens.values()) token.cancelled = true;
  }

  /**
   * Create every folder level once per run. `ensureFolderForDesktop` is
   * idempotent but it is still a round-trip, and a drive with 20k files in one
   * tree would otherwise make 20k redundant calls.
   */
  function makeFolderEnsurer({ teamSlug, projectName }) {
    // Cache the in-flight PROMISE, not the completion. Workers run in
    // parallel, so caching only after the await lets every worker that starts
    // a file in the same new folder fire its own ensure call.
    const ensured = new Map();
    return async function ensureFolders(segments) {
      for (let i = 1; i <= segments.length; i += 1) {
        const slice = segments.slice(0, i);
        const key = slice.join("/");
        let pending = ensured.get(key);
        if (!pending) {
          pending = convexCall("mutation", "desktopBrowse:ensureFolderForDesktop", {
            teamSlug,
            projectName,
            folderPath: slice,
          });
          ensured.set(key, pending);
          // A failed ensure must not poison the cache — the next file that
          // needs this folder should try again rather than inherit the error.
          pending.catch(() => ensured.delete(key));
        }
        await pending;
      }
    };
  }

  async function uploadOne({ file, source, ensureFolders }) {
    const { teamSlug, projectName } = source.destination;
    const baseFolder = (source.destination.folderPath || []).map(sanitizeFolderName).filter(Boolean);
    const folderPath = destinationFolderFor(file.relPath, baseFolder);
    const fileName = path.basename(file.relPath);
    const contentType = contentTypeFor(fileName);

    if (folderPath.length) await ensureFolders(folderPath);

    const upload = await convexCall("action", "desktopBrowse:createUploadForDesktop", {
      teamSlug,
      projectName,
      folderPath,
      fileName,
      size: file.size,
      contentType,
    });

    try {
      if (uploadObject && file.size > SINGLE_PUT_MAX_BYTES) {
        await uploadObject({
          key: upload.s3Key,
          body: createReadStream(file.absolutePath),
          contentType,
        });
      } else if (file.size > SINGLE_PUT_MAX_BYTES) {
        throw new Error(
          `${fileName} is ${file.size} bytes, above the ${SINGLE_PUT_MAX_BYTES}-byte single-upload limit, and no multipart uploader is configured.`,
        );
      } else {
        const init = {
          method: "PUT",
          headers: {
            "content-type": contentType,
            "content-length": String(file.size),
          },
        };
        if (file.size > 0) {
          init.body = createReadStream(file.absolutePath);
          init.duplex = "half";
        }
        const res = await fetchImpl(upload.uploadUrl, init);
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`storage rejected upload (${res.status}): ${body.slice(0, 200)}`);
        }
      }
    } catch (error) {
      await convexCall("action", "desktopUploadActions:abortUploadForDesktop", {
        teamSlug,
        projectName,
        folderPath,
        s3Key: upload.s3Key,
      }).catch(() => {});
      throw error;
    }

    await convexCall("action", "desktopUploadActions:commitUploadForDesktop", {
      mode: upload.mode,
      teamSlug,
      projectName,
      folderPath,
      fileName,
      size: file.size,
      contentType,
      s3Key: upload.s3Key,
      videoId: upload.videoId,
      previousS3Key: upload.previousS3Key,
    });
  }

  /**
   * Back up one source. Returns a summary; never throws for a single bad file
   * (those are counted and named in the log) — only for a failure that makes
   * the whole run meaningless, such as an unreachable source path.
   */
  async function runSource(source, { reason = "manual" } = {}) {
    const sourceId = source.id;
    if (isRunning(sourceId)) {
      return { skipped: true, why: "already-running" };
    }

    const token = { cancelled: false };
    tokens.set(sourceId, token);
    const run = statusFor(sourceId);
    Object.assign(run, emptyRun(sourceId), {
      state: "scanning",
      startedAt: now(),
      reason,
    });
    emit({ force: true });

    try {
      if (!fssync.existsSync(source.path)) {
        throw new Error(`${source.path} is not available. Reconnect it and run the backup again.`);
      }

      const { files, skippedLinks } = await scan(source.path, {
        includeHidden: source.includeHidden === true,
        onLog,
      });
      if (token.cancelled) throw new CancelledError();

      const manifest = await loadManifest(manifestDirectory, sourceId);
      const plan = planUploads(files, manifest);

      run.state = "uploading";
      run.filesTotal = plan.uploads.length;
      run.filesSkipped = plan.unchangedCount;
      run.bytesTotal = plan.pendingBytes;
      emit({ force: true });
      onLog(
        `backup: ${source.label || source.path} — ${plan.uploads.length} to upload, ${plan.unchangedCount} unchanged, ${skippedLinks} links skipped`,
      );

      if (plan.uploads.length === 0) {
        run.state = "done";
        run.finishedAt = now();
        run.currentFile = null;
        emit({ force: true });
        return { uploaded: 0, skipped: plan.unchangedCount, failed: 0 };
      }

      const ensureFolders = makeFolderEnsurer(source.destination);
      const queue = [...plan.uploads];
      let dirty = false;

      const worker = async () => {
        while (queue.length > 0) {
          if (token.cancelled) return;
          const file = queue.shift();
          run.currentFile = file.relPath;
          emit();

          let lastError = null;
          for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
            if (token.cancelled) return;
            try {
              await uploadOne({ file, source, ensureFolders });
              lastError = null;
              break;
            } catch (error) {
              lastError = error;
              if (attempt < UPLOAD_ATTEMPTS) {
                await sleep(attempt * 1000);
              }
            }
          }

          if (lastError) {
            run.filesFailed += 1;
            onLog(`backup: ${file.relPath} failed after ${UPLOAD_ATTEMPTS} attempts: ${lastError.message}`);
            emit();
            continue;
          }

          // Re-stat before recording. If the file changed while we were
          // reading it, leave it out of the manifest so the next pass
          // re-uploads the settled version instead of trusting a torn copy.
          const after = await statFile(file.absolutePath).catch(() => null);
          if (after && after.size === file.size && Math.floor(after.mtimeMs) === file.mtimeMs) {
            manifest.entries[file.relPath] = {
              size: file.size,
              mtimeMs: file.mtimeMs,
              uploadedAt: now(),
            };
            dirty = true;
          } else {
            onLog(`backup: ${file.relPath} changed during upload; will re-check next run`);
          }

          run.filesDone += 1;
          run.bytesDone += file.size;
          emit();
        }
      };

      const workerCount = Math.max(1, Math.min(concurrency, plan.uploads.length));
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      if (dirty) await saveManifest(manifestDirectory, sourceId, manifest);
      if (token.cancelled) throw new CancelledError();

      run.state = run.filesFailed > 0 ? "error" : "done";
      run.error =
        run.filesFailed > 0
          ? `${run.filesFailed} of ${run.filesTotal} files did not upload. See the log.`
          : null;
      run.currentFile = null;
      run.finishedAt = now();
      emit({ force: true });
      return { uploaded: run.filesDone, skipped: run.filesSkipped, failed: run.filesFailed };
    } catch (error) {
      run.state = error instanceof CancelledError ? "cancelled" : "error";
      run.error = error instanceof CancelledError ? null : error.message;
      run.currentFile = null;
      run.finishedAt = now();
      emit({ force: true });
      if (error instanceof CancelledError) return { cancelled: true };
      throw error;
    } finally {
      tokens.delete(sourceId);
    }
  }

  return {
    runSource,
    cancel,
    cancelAll,
    isRunning,
    status: () => [...runs.values()].map((r) => ({ ...r })),
    forget: (sourceId) => {
      runs.delete(sourceId);
      tokens.delete(sourceId);
      return fs
        .rm(manifestPathFor(manifestDirectory, sourceId), { force: true })
        .catch(() => {});
    },
  };
}

class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  DEFAULT_CONCURRENCY,
  MAX_DEPTH,
  SINGLE_PUT_MAX_BYTES,
  SYSTEM_IGNORES,
  contentTypeFor,
  createBackupEngine,
  destinationFolderFor,
  loadManifest,
  planUploads,
  sanitizeFolderName,
  saveManifest,
  scanSource,
};
