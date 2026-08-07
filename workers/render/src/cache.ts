import type { ObjectStore } from "./objectStore";
import {
  CACHE_FORMAT_VERSION,
  createSegmentCacheIdentity,
  hashSegmentIdentity,
  segmentCacheObjectKey,
  type SegmentCacheIdentityInput,
} from "./cacheKey";

export interface CacheAddress {
  hash: string;
  objectKey: string;
}

export interface CacheLookupResult extends CacheAddress {
  hit: boolean;
  bytes: number;
}

export class SegmentCache {
  constructor(
    private readonly store: ObjectStore,
    private readonly prefix = "render-cache",
  ) {}

  address(input: SegmentCacheIdentityInput): CacheAddress {
    const hash = hashSegmentIdentity(createSegmentCacheIdentity(input));
    return { hash, objectKey: segmentCacheObjectKey(hash, this.prefix) };
  }

  async restore(address: CacheAddress, destination: string): Promise<CacheLookupResult> {
    const info = await this.store.head(address.objectKey);
    if (!info) return { ...address, hit: false, bytes: 0 };
    const downloaded = await this.store.downloadToFile(address.objectKey, destination);
    return { ...address, hit: true, bytes: downloaded.bytes };
  }

  async storeFile(address: CacheAddress, source: string): Promise<CacheLookupResult> {
    const stored = await this.store.putFile(address.objectKey, source, {
      contentType: "video/mp4",
      ifAbsent: true,
      metadata: {
        "snip-cache-format": CACHE_FORMAT_VERSION,
        "snip-cache-hash": address.hash,
      },
    });
    return { ...address, hit: false, bytes: stored.bytes };
  }
}
