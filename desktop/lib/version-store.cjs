"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");

const MANIFEST_VERSION = 1;
// Keep at most 100 save points and 2 GiB of unique project data. One hundred
// entries covers several weeks of active daily edits, while 2 GiB prevents a
// large NLE project from growing app data without bound. Eviction is oldest
// first, and shared content-addressed blobs survive until their last entry is
// removed.
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function publicEntry(entry) {
  return {
    id: entry.id,
    file: entry.file,
    mtime: entry.mtime,
    observedAt: entry.observedAt,
    hash: entry.hash,
    sizeBytes: entry.sizeBytes,
    sourceFormat: entry.sourceFormat,
  };
}

class LocalVersionStore {
  constructor({
    baseDirectory,
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxBytes = DEFAULT_MAX_BYTES,
    fsApi = fs,
  }) {
    if (!baseDirectory) throw new Error("Version store requires a base directory.");
    this.baseDirectory = path.resolve(baseDirectory);
    this.blobDirectory = path.join(this.baseDirectory, "blobs");
    this.manifestPath = path.join(this.baseDirectory, "index.json");
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.maxBytes = Math.max(1, Math.floor(maxBytes));
    this.fs = fsApi;
    this.queue = Promise.resolve();
  }

  enqueue(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async readManifest() {
    try {
      const parsed = JSON.parse(await this.fs.readFile(this.manifestPath, "utf8"));
      if (parsed?.version !== MANIFEST_VERSION || !Array.isArray(parsed.entries)) {
        throw new Error("Local version history has an unsupported format.");
      }
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { version: MANIFEST_VERSION, entries: [] };
      }
      throw error;
    }
  }

  async writeManifest(manifest) {
    await this.fs.mkdir(this.baseDirectory, { recursive: true, mode: 0o700 });
    const temporary = path.join(
      this.baseDirectory,
      `index.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
    );
    await this.fs.writeFile(temporary, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await this.fs.rename(temporary, this.manifestPath);
  }

  blobPath(hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Version hash is invalid.");
    return path.join(this.blobDirectory, hash.slice(0, 2), hash);
  }

  async writeBlob(hash, content) {
    const destination = this.blobPath(hash);
    await this.fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    try {
      await this.fs.writeFile(destination, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    return destination;
  }

  async evict(manifest) {
    manifest.entries.sort(
      (left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id),
    );
    const references = new Map();
    const sizes = new Map();
    for (const entry of manifest.entries) {
      references.set(entry.hash, (references.get(entry.hash) ?? 0) + 1);
      sizes.set(entry.hash, entry.sizeBytes);
    }
    let totalBytes = [...sizes.values()].reduce((total, size) => total + size, 0);
    while (
      manifest.entries.length > this.maxEntries ||
      totalBytes > this.maxBytes
    ) {
      const oldest = manifest.entries.shift();
      if (!oldest) break;
      const remaining = (references.get(oldest.hash) ?? 1) - 1;
      references.set(oldest.hash, remaining);
      if (remaining === 0) {
        totalBytes -= sizes.get(oldest.hash) ?? oldest.sizeBytes;
        try {
          await this.fs.unlink(this.blobPath(oldest.hash));
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }
  }

  snapshot({
    content,
    file,
    root,
    sourcePath,
    hash: suppliedHash,
    mtime,
    observedAt = Date.now(),
    sourceFormat,
  }) {
    return this.enqueue(async () => {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
      if (buffer.length > this.maxBytes) {
        throw new Error("Project file exceeds the local history budget.");
      }
      const hash = suppliedHash || sha256(buffer);
      this.blobPath(hash);
      await this.writeBlob(hash, buffer);
      const manifest = await this.readManifest();
      const entry = {
        id: `${observedAt}-${hash.slice(0, 12)}-${crypto.randomBytes(4).toString("hex")}`,
        file: String(file || path.basename(sourcePath || "project")),
        root: String(root || ""),
        sourcePath: sourcePath ? path.resolve(sourcePath) : null,
        mtime: Number.isFinite(mtime) ? mtime : observedAt,
        observedAt,
        hash,
        sizeBytes: buffer.length,
        sourceFormat: String(sourceFormat || path.extname(file || "").replace(/^\./, "")),
      };
      manifest.entries.push(entry);
      await this.evict(manifest);
      await this.writeManifest(manifest);
      return publicEntry(entry);
    });
  }

  list() {
    return this.enqueue(async () => {
      const manifest = await this.readManifest();
      return manifest.entries
        .slice()
        .sort(
          (left, right) =>
            right.observedAt - left.observedAt || right.id.localeCompare(left.id),
        )
        .map(publicEntry);
    });
  }

  restoreToCopy(id, destinationPath) {
    return this.enqueue(async () => {
      if (!path.isAbsolute(destinationPath)) {
        throw new Error("Restore destination must be an absolute path.");
      }
      const manifest = await this.readManifest();
      const entry = manifest.entries.find((candidate) => candidate.id === id);
      if (!entry) throw new Error("Local version was not found.");
      if (
        entry.sourcePath &&
        path.resolve(entry.sourcePath) === path.resolve(destinationPath)
      ) {
        throw new Error("Choose a new file name for the restored copy.");
      }
      await this.fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await this.fs.copyFile(this.blobPath(entry.hash), destinationPath);
      return publicEntry(entry);
    });
  }
}

/**
 * The watcher depends on this small store surface only. A later remote durable
 * implementation can replace it without changing save processing or the UI.
 */
function createLocalVersionStore(options) {
  return new LocalVersionStore(options);
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ENTRIES,
  LocalVersionStore,
  createLocalVersionStore,
  sha256,
};
