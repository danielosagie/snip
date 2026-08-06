import { OpfsPlaybackCache } from "./opfsCache";
import {
  clampByteRange,
  parseContentRange,
  rangeLength,
  type ByteRange,
} from "./rangeMath";
import type { PlaybackSource } from "./types";

export class RangeNotSupportedError extends Error {
  constructor(message = "The proxy server did not honor HTTP range requests.") {
    super(message);
    this.name = "RangeNotSupportedError";
  }
}

export type RangeProbe = {
  fileSize: number;
  etag?: string;
};

const MAX_SINGLE_RANGE_BYTES = 32 * 1024 * 1024;

export class CachedRangeSource {
  private readonly memory = new Map<string, ArrayBuffer>();
  private probeResult: RangeProbe | null = null;

  private constructor(
    private readonly source: PlaybackSource,
    private readonly cache: OpfsPlaybackCache | null,
    readonly sourceKey: string,
  ) {}

  static async create(source: PlaybackSource): Promise<CachedRangeSource> {
    const cache = await OpfsPlaybackCache.create();
    const sourceKey = cache
      ? await cache.sourceKey(source.contentHash)
      : source.contentHash;
    return new CachedRangeSource(source, cache, sourceKey);
  }

  async probe(signal?: AbortSignal): Promise<RangeProbe> {
    if (this.probeResult) return this.probeResult;

    const response = await fetch(this.source.url, {
      headers: { Range: "bytes=0-0" },
      signal,
    });
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => undefined);
      throw new RangeNotSupportedError();
    }
    const parsed = parseContentRange(response.headers.get("content-range"));
    await response.body?.cancel().catch(() => undefined);
    const fileSize = parsed?.total ?? this.source.byteLength;
    if (!fileSize || fileSize <= 0) {
      throw new RangeNotSupportedError(
        "The proxy did not expose its size in Content-Range.",
      );
    }
    this.probeResult = {
      fileSize,
      etag: response.headers.get("etag") ?? undefined,
    };
    return this.probeResult;
  }

  async get(range: ByteRange, signal?: AbortSignal): Promise<ArrayBuffer> {
    const { fileSize } = await this.probe(signal);
    const clamped = clampByteRange(range, fileSize);
    const length = rangeLength(clamped);
    if (length > MAX_SINGLE_RANGE_BYTES) {
      throw new Error(
        `A ${Math.ceil(length / 1024 / 1024)} MiB media window exceeds the 32 MiB playback limit.`,
      );
    }

    const key = `${clamped.start}-${clamped.end}`;
    const memoryHit = this.memory.get(key);
    if (memoryHit) return memoryHit.slice(0);

    const opfsHit = await this.cache?.getRange(this.sourceKey, clamped);
    if (opfsHit) {
      this.remember(key, opfsHit);
      return opfsHit.slice(0);
    }

    const response = await fetch(this.source.url, {
      headers: { Range: `bytes=${clamped.start}-${clamped.end}` },
      signal,
    });
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => undefined);
      throw new RangeNotSupportedError();
    }
    const parsed = parseContentRange(response.headers.get("content-range"));
    if (
      parsed &&
      (parsed.start !== clamped.start || parsed.end !== clamped.end)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new RangeNotSupportedError("The proxy returned the wrong byte range.");
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== length) {
      throw new RangeNotSupportedError("The proxy byte range was truncated.");
    }

    this.remember(key, bytes);
    void this.cache?.putRange(this.sourceKey, clamped, bytes.slice(0));
    return bytes;
  }

  async getCachedIndex() {
    return await this.cache?.getIndex(this.sourceKey);
  }

  async putCachedIndex(index: Parameters<OpfsPlaybackCache["putIndex"]>[1]) {
    await this.cache?.putIndex(this.sourceKey, index);
  }

  private remember(key: string, bytes: ArrayBuffer): void {
    this.memory.set(key, bytes.slice(0));
    while (this.memory.size > 4) {
      const oldest = this.memory.keys().next().value as string | undefined;
      if (!oldest) break;
      this.memory.delete(oldest);
    }
  }
}

