import {
  chooseCacheEvictions,
  type CacheEntryRecord,
} from "./cachePolicy";
import type { ByteRange } from "./rangeMath";
import type { VideoSampleIndex } from "./mp4Index";

const CACHE_DIRECTORY = "snip-playback-v1";
const MANIFEST_FILE = "manifest.json";

/**
 * 512 MiB holds the active GOP working sets for several 720p proxies while
 * staying conservative on laptops with smaller SSDs. The cache is an LRU and
 * is strictly disposable, so storage pressure never blocks playback.
 */
export const PLAYBACK_CACHE_BUDGET_BYTES = 512 * 1024 * 1024;

type ManifestEntry = CacheEntryRecord & {
  kind: "range" | "index";
  fileName: string;
};

type CacheManifest = {
  version: 1;
  entries: Record<string, ManifestEntry>;
};

const EMPTY_MANIFEST: CacheManifest = { version: 1, entries: {} };

async function digestKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readJsonFile<T>(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<T | null> {
  try {
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
}

async function writeFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  data: FileSystemWriteChunkType,
): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

export class OpfsPlaybackCache {
  private mutationQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly root: FileSystemDirectoryHandle,
    private readonly ranges: FileSystemDirectoryHandle,
    private readonly indexes: FileSystemDirectoryHandle,
    private readonly budgetBytes: number,
  ) {}

  static async create(
    budgetBytes = PLAYBACK_CACHE_BUDGET_BYTES,
  ): Promise<OpfsPlaybackCache | null> {
    if (
      typeof navigator === "undefined" ||
      !("storage" in navigator) ||
      typeof navigator.storage.getDirectory !== "function" ||
      typeof crypto?.subtle?.digest !== "function"
    ) {
      return null;
    }

    try {
      const storageRoot = await navigator.storage.getDirectory();
      const root = await storageRoot.getDirectoryHandle(CACHE_DIRECTORY, {
        create: true,
      });
      const [ranges, indexes] = await Promise.all([
        root.getDirectoryHandle("ranges", { create: true }),
        root.getDirectoryHandle("indexes", { create: true }),
      ]);
      return new OpfsPlaybackCache(root, ranges, indexes, budgetBytes);
    } catch {
      return null;
    }
  }

  async sourceKey(contentHash: string): Promise<string> {
    return await digestKey(contentHash);
  }

  async getRange(
    sourceKey: string,
    range: ByteRange,
  ): Promise<ArrayBuffer | null> {
    const key = this.rangeKey(sourceKey, range);
    const manifest = await this.readManifest();
    const entry = manifest.entries[key];
    if (!entry) return null;

    try {
      const handle = await this.ranges.getFileHandle(entry.fileName);
      const file = await handle.getFile();
      if (file.size !== entry.size) return null;
      this.touchLater(key);
      return await file.arrayBuffer();
    } catch {
      this.removeLater(key);
      return null;
    }
  }

  async putRange(
    sourceKey: string,
    range: ByteRange,
    bytes: ArrayBuffer,
  ): Promise<void> {
    const key = this.rangeKey(sourceKey, range);
    const fileName = `${sourceKey}-${range.start}-${range.end}.bin`;
    await this.enqueue(async () => {
      await this.makeRoom(bytes.byteLength, key);
      if (bytes.byteLength > this.budgetBytes) return;
      await writeFile(this.ranges, fileName, bytes);
      const manifest = await this.readManifest();
      manifest.entries[key] = {
        key,
        kind: "range",
        fileName,
        size: bytes.byteLength,
        lastAccess: Date.now(),
      };
      await this.writeManifest(manifest);
    });
  }

  async getIndex(sourceKey: string): Promise<VideoSampleIndex | null> {
    const key = this.indexKey(sourceKey);
    const manifest = await this.readManifest();
    const entry = manifest.entries[key];
    if (!entry) return null;
    const value = await readJsonFile<VideoSampleIndex>(this.indexes, entry.fileName);
    if (value) this.touchLater(key);
    else this.removeLater(key);
    return value;
  }

  async putIndex(sourceKey: string, index: VideoSampleIndex): Promise<void> {
    const key = this.indexKey(sourceKey);
    const fileName = `${sourceKey}.json`;
    const json = JSON.stringify(index);
    const size = new TextEncoder().encode(json).byteLength;
    await this.enqueue(async () => {
      await this.makeRoom(size, key);
      if (size > this.budgetBytes) return;
      await writeFile(this.indexes, fileName, json);
      const manifest = await this.readManifest();
      manifest.entries[key] = {
        key,
        kind: "index",
        fileName,
        size,
        lastAccess: Date.now(),
      };
      await this.writeManifest(manifest);
    });
  }

  private rangeKey(sourceKey: string, range: ByteRange): string {
    return `range:${sourceKey}:${range.start}-${range.end}`;
  }

  private indexKey(sourceKey: string): string {
    return `index:${sourceKey}`;
  }

  private async readManifest(): Promise<CacheManifest> {
    const value = await readJsonFile<CacheManifest>(this.root, MANIFEST_FILE);
    if (!value || value.version !== 1 || !value.entries) {
      return { ...EMPTY_MANIFEST, entries: {} };
    }
    return value;
  }

  private async writeManifest(manifest: CacheManifest): Promise<void> {
    await writeFile(this.root, MANIFEST_FILE, JSON.stringify(manifest));
  }

  private async makeRoom(
    incomingBytes: number,
    protectedKey: string,
  ): Promise<void> {
    const manifest = await this.readManifest();
    const existingSize = manifest.entries[protectedKey]?.size ?? 0;
    const entries = Object.values(manifest.entries).filter(
      (entry) => entry.key !== protectedKey,
    );
    const evictions = chooseCacheEvictions(
      entries,
      Math.max(0, incomingBytes - existingSize),
      this.budgetBytes,
      protectedKey,
    );
    for (const key of evictions) {
      await this.removeEntry(manifest, key);
    }
    if (evictions.length > 0) await this.writeManifest(manifest);
  }

  private async removeEntry(
    manifest: CacheManifest,
    key: string,
  ): Promise<void> {
    const entry = manifest.entries[key];
    if (!entry) return;
    const directory = entry.kind === "range" ? this.ranges : this.indexes;
    try {
      await directory.removeEntry(entry.fileName);
    } catch {
      // The manifest is authoritative; a missing disposable file is harmless.
    }
    delete manifest.entries[key];
  }

  private touchLater(key: string): void {
    void this.enqueue(async () => {
      const manifest = await this.readManifest();
      const entry = manifest.entries[key];
      if (!entry) return;
      entry.lastAccess = Date.now();
      await this.writeManifest(manifest);
    });
  }

  private removeLater(key: string): void {
    void this.enqueue(async () => {
      const manifest = await this.readManifest();
      await this.removeEntry(manifest, key);
      await this.writeManifest(manifest);
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.then(task, task);
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }
}

