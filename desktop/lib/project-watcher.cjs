"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const fssync = require("node:fs");

const DEFAULT_PROJECT_EXTENSIONS = Object.freeze([".prproj", ".fcpxml", ".drp"]);

function normalizeExtensions(configured = []) {
  const values = [...DEFAULT_PROJECT_EXTENSIONS, ...configured];
  return new Set(
    values
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
      .map((value) => (value.startsWith(".") ? value : `.${value}`)),
  );
}

function uniqueRoots(roots) {
  const seen = new Set();
  const output = [];
  for (const root of roots || []) {
    if (typeof root !== "string" || !root.trim()) continue;
    const resolved = path.resolve(root.trim());
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    output.push(resolved);
  }
  return output;
}

function createSaveDebouncer({ delayMs, onReady, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const timers = new Map();
  return {
    schedule(file) {
      const existing = timers.get(file);
      if (existing) clearTimer(existing);
      const timer = setTimer(() => {
        timers.delete(file);
        onReady(file);
      }, delayMs);
      timers.set(file, timer);
    },
    flush(file) {
      const timer = timers.get(file);
      if (!timer) return false;
      clearTimer(timer);
      timers.delete(file);
      onReady(file);
      return true;
    },
    close() {
      for (const timer of timers.values()) clearTimer(timer);
      timers.clear();
    },
    get pendingCount() {
      return timers.size;
    },
  };
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fssync.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function relativeFile(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.basename(absolutePath);
  }
  return relative.split(path.sep).join("/");
}

/**
 * @typedef {Object} WatcherEvent
 * @property {'open'|'save'} kind
 * @property {string} file
 * @property {string} root
 * @property {string} user
 * @property {number} mtime
 * @property {number} observedAt
 * @property {string} hash
 * @property {'pending'|'parsed'|'saved_timeline_not_parsed'|'not_requested'} parseStatus
 */

/**
 * Minimal wave 1 transport contract. Implementations may batch or retry, but
 * callers never await `publish` from an editor's filesystem callback.
 *
 * @interface WatcherTransport
 * @method publish(events: WatcherEvent[]): Promise<void>
 */

class ProjectFileWatcher {
  constructor({
    roots,
    extensions = [],
    user,
    transport,
    debounceMs = 750,
    openPollMs = 5000,
    listOpenFiles = null,
    parseProjectBufferSoft = null,
    handleProjectSave = null,
    watchFactory = fssync.watch,
    statFile = fs.stat,
    readFile = fs.readFile,
    hashFileFn = hashFile,
    onLog = () => {},
  }) {
    if (!transport || typeof transport.publish !== "function") {
      throw new TypeError("ProjectFileWatcher requires a WatcherTransport.");
    }
    this.roots = uniqueRoots(roots);
    this.extensions = normalizeExtensions(extensions);
    this.user = typeof user === "function" ? user : () => String(user || "unknown");
    this.transport = transport;
    this.debounceMs = debounceMs;
    this.openPollMs = openPollMs;
    this.listOpenFiles = listOpenFiles;
    this.parseProjectBufferSoft = parseProjectBufferSoft;
    this.handleProjectSave = handleProjectSave;
    this.watchFactory = watchFactory;
    this.statFile = statFile;
    this.readFile = readFile;
    this.hashFileFn = hashFileFn;
    this.onLog = onLog;
    this.watchers = [];
    this.openPoll = null;
    this.openFiles = new Set();
    this.inFlight = new Set();
    this.closed = false;
    this.debouncer = createSaveDebouncer({
      delayMs: this.debounceMs,
      onReady: (key) => {
        const [root, absolutePath] = JSON.parse(key);
        void this.emitStableEvent("save", root, absolutePath);
      },
    });
  }

  accepts(filePath) {
    return this.extensions.has(path.extname(String(filePath)).toLowerCase());
  }

  start() {
    this.closed = false;
    for (const root of this.roots) {
      if (!fssync.existsSync(root)) {
        this.onLog(`watcher: skipped missing directory ${root}`);
        continue;
      }
      try {
        const watcher = this.watchFactory(
          root,
          { recursive: true, persistent: false },
          (eventType, filename) => {
            if (!filename || (eventType !== "change" && eventType !== "rename")) return;
            const name = String(filename);
            if (!this.accepts(name)) return;
            this.noteFilesystemEvent(root, path.join(root, name));
          },
        );
        this.watchers.push(watcher);
        this.onLog(`watcher: watching ${root}`);
      } catch (error) {
        this.onLog(
          `watcher: could not watch ${root}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (this.listOpenFiles && this.roots.length > 0) {
      void this.pollOpenFiles();
      this.openPoll = setInterval(() => void this.pollOpenFiles(), this.openPollMs);
      this.openPoll.unref?.();
    }
    return this;
  }

  noteFilesystemEvent(root, absolutePath) {
    if (this.closed || !this.accepts(absolutePath)) return;
    this.debouncer.schedule(JSON.stringify([root, absolutePath]));
  }

  async pollOpenFiles() {
    if (this.closed || !this.listOpenFiles) return;
    const nextOpen = new Set();
    for (const root of this.roots) {
      let rows = [];
      try {
        rows = await this.listOpenFiles(root);
      } catch (error) {
        this.onLog(
          `watcher: open-file scan failed for ${root}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      for (const row of rows || []) {
        const rawPath = typeof row === "string" ? row : row?.path;
        if (!rawPath) continue;
        const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.join(root, rawPath);
        if (!this.accepts(absolutePath)) continue;
        const key = JSON.stringify([root, absolutePath]);
        nextOpen.add(key);
        if (!this.openFiles.has(key)) void this.emitStableEvent("open", root, absolutePath);
      }
    }
    this.openFiles = nextOpen;
  }

  publish(event) {
    // Move network work off the filesystem callback and explicitly ignore its
    // completion. An offline Convex deployment must never backpressure a save.
    queueMicrotask(() => {
      Promise.resolve(this.transport.publish([event])).catch((error) => {
        this.onLog(
          `watcher: event transport failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  }

  async emitStableEvent(kind, root, absolutePath) {
    const key = `${kind}:${absolutePath}`;
    if (this.closed || this.inFlight.has(key)) return;
    this.inFlight.add(key);
    try {
      const [stat, hash] = await Promise.all([
        this.statFile(absolutePath),
        this.hashFileFn(absolutePath),
      ]);
      if (!stat.isFile()) return;
      const extension = path.extname(absolutePath).toLowerCase();
      const event = {
        kind,
        file: relativeFile(root, absolutePath),
        root,
        user: this.user(),
        mtime: stat.mtimeMs,
        observedAt: Date.now(),
        hash,
        parseStatus: kind === "save" && this.parseProjectBufferSoft ? "pending" : "not_requested",
      };
      this.publish(event);

      // Parsing, local versioning, and remote ingest are follow-up work. The
      // save event above is already queued before this read begins.
      if (kind === "save" && this.parseProjectBufferSoft) {
        setImmediate(async () => {
          let result;
          let buffer = null;
          try {
            const supported = extension === ".prproj" || extension === ".fcpxml";
            if (supported || this.handleProjectSave) {
              buffer = await this.readFile(absolutePath);
            }
            if (supported) {
              result = this.parseProjectBufferSoft(buffer, extension);
            } else {
              result = {
                status: "saved_timeline_not_parsed",
                error: `No timeline parser is available for ${extension}.`,
              };
            }
          } catch (error) {
            result = {
              status: "saved_timeline_not_parsed",
              error: error instanceof Error ? error.message : String(error),
            };
          }
          if (this.handleProjectSave && buffer) {
            try {
              const processed = await this.handleProjectSave({
                event,
                absolutePath,
                extension,
                buffer,
                parseResult: result,
              });
              if (processed?.status) result = processed;
              if (processed?.hash) event.hash = processed.hash;
            } catch (error) {
              result = {
                status: "saved_timeline_not_parsed",
                error: error instanceof Error ? error.message : String(error),
              };
            }
          }
          this.publish({
            ...event,
            parseStatus: result.status,
            ...(result.status === "saved_timeline_not_parsed"
              ? { parseError: String(result.error || "Timeline could not be parsed.").slice(0, 500) }
              : {}),
          });
        });
      }
    } catch (error) {
      // Rename-based saves may briefly remove the destination. A later watch
      // event will retry; this failure is intentionally best effort.
      this.onLog(
        `watcher: skipped ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.inFlight.delete(key);
    }
  }

  close() {
    this.closed = true;
    this.debouncer.close();
    if (this.openPoll) clearInterval(this.openPoll);
    this.openPoll = null;
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Best effort during app shutdown.
      }
    }
    this.watchers = [];
    this.openFiles.clear();
  }
}

module.exports = {
  DEFAULT_PROJECT_EXTENSIONS,
  ProjectFileWatcher,
  createSaveDebouncer,
  hashFile,
  normalizeExtensions,
  uniqueRoots,
};
