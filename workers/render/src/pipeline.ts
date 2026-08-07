import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { SegmentCache, type CacheAddress, type CacheLookupResult } from "./cache";
import { concatenateSegments, encodeSegment, probeMedia, type MediaProbe } from "./ffmpeg";
import { planGopSegments, type GopSegment } from "./gop";
import { serializeManifest, summarizeCache } from "./manifest";
import type { ObjectStore } from "./objectStore";
import { mapConcurrent, retry } from "./process";
import type {
  CacheSegmentManifest,
  JobClaim,
  JobHeartbeat,
  RenderJobResult,
  RenderResultManifest,
  SourceSegment,
} from "./types";

interface DownloadedSource {
  identity: string;
  key: string;
  contentId: string;
  localPath: string;
  downloadedBytes: number;
  probe: MediaProbe;
}

interface PlannedUnit {
  source: DownloadedSource;
  sourceSegment: SourceSegment;
  range: GopSegment;
  address: CacheAddress;
  artifactPath: string;
}

export interface RenderPipelineOptions {
  objectStore: ObjectStore;
  cache: SegmentCache;
  workRoot: string;
  resultManifestPath?: string;
  keepWorkDir?: boolean;
}

export type PipelineHeartbeat = (heartbeat: JobHeartbeat) => Promise<void>;

function sourceIdentity(segment: SourceSegment): string {
  return `${segment.sourceContentId}\0${segment.sourceKey}`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const partPath = `${path}.${randomUUID()}.part`;
  try {
    await writeFile(partPath, content, "utf8");
    await rename(partPath, path);
  } catch (error) {
    await rm(partPath, { force: true });
    throw error;
  }
}

export class RenderPipeline {
  constructor(private readonly options: RenderPipelineOptions) {}

  async run(
    claim: JobClaim,
    heartbeat: PipelineHeartbeat,
    signal?: AbortSignal,
  ): Promise<RenderJobResult> {
    const startedAt = new Date().toISOString();
    await mkdir(this.options.workRoot, { recursive: true });
    const workDir = await mkdtemp(
      join(this.options.workRoot, `${claim.jobId.replace(/[^a-zA-Z0-9_-]/g, "_")}-`),
    );
    try {
      const sources = await this.downloadSources(claim, workDir, heartbeat, signal);
      await heartbeat({ phase: "probing", progress: 0.14, message: "Analyzing keyframes." });
      await mapConcurrent(sources, 4, async (source) => {
        signal?.throwIfAborted();
        source.probe = await probeMedia(source.localPath, signal);
        return source;
      });
      const units = this.planUnits(claim, sources, workDir);
      const uniqueUnits = [...new Map(units.map((unit) => [unit.address.hash, unit])).values()];
      await heartbeat({
        phase: "rendering",
        progress: 0.2,
        message: `Resolving ${uniqueUnits.length} GOP cache segments.`,
      });

      const outcomes = new Map<string, CacheLookupResult>();
      const restored = await mapConcurrent(uniqueUnits, 8, async (unit) => {
        signal?.throwIfAborted();
        const result = await retry(
          () => this.options.cache.restore(unit.address, unit.artifactPath),
          3,
          signal,
        );
        outcomes.set(unit.address.hash, result);
        return { unit, result };
      });
      const misses = restored.filter(({ result }) => !result.hit).map(({ unit }) => unit);
      let encoded = 0;
      for (const unit of misses) {
        signal?.throwIfAborted();
        await encodeSegment({
          sourcePath: unit.source.localPath,
          destination: unit.artifactPath,
          range: unit.range,
          effects: unit.sourceSegment.effects,
          target: claim.spec.target,
          hasAudio: unit.source.probe.hasAudio,
          signal,
        });
        const details = await stat(unit.artifactPath);
        await retry(
          () => this.options.cache.storeFile(unit.address, unit.artifactPath),
          3,
          signal,
        );
        outcomes.set(unit.address.hash, {
          ...unit.address,
          hit: false,
          bytes: details.size,
        });
        encoded += 1;
        await heartbeat({
          phase: "rendering",
          progress: 0.2 + 0.62 * (encoded / Math.max(1, misses.length)),
          message: `Encoded ${encoded} of ${misses.length} cache misses.`,
        });
      }

      signal?.throwIfAborted();
      const outputPath = join(workDir, "segments", `output.${claim.spec.target.container}`);
      await concatenateSegments(
        units.map((unit) => unit.artifactPath),
        join(workDir, "segments", "concat.txt"),
        outputPath,
        signal,
      );
      const outputDetails = await stat(outputPath);
      const cacheSegments = this.buildCacheManifest(uniqueUnits, outcomes);
      const cache = summarizeCache(cacheSegments);
      await heartbeat({ phase: "uploading", progress: 0.88, message: "Uploading output." });
      await retry(
        () => this.options.objectStore.putFile(claim.spec.outputKey, outputPath, {
          contentType: "video/mp4",
          metadata: { "snip-render-job": claim.jobId },
        }),
        3,
        signal,
      );
      const manifest: RenderResultManifest = {
        version: 1,
        jobId: claim.jobId,
        attempt: claim.attempt,
        startedAt,
        completedAt: new Date().toISOString(),
        output: {
          key: claim.spec.outputKey,
          bytes: outputDetails.size,
          codec: claim.spec.target.codec,
          container: claim.spec.target.container,
          width: claim.spec.target.width,
          height: claim.spec.target.height,
          durationSeconds: claim.spec.segments.reduce(
            (total, segment) => total + segment.outSeconds - segment.inSeconds,
            0,
          ),
        },
        sources: sources.map((source) => ({
          key: source.key,
          contentId: source.contentId,
          downloadedBytes: source.downloadedBytes,
        })),
        cache,
        cacheSegments,
      };
      const serializedManifest = serializeManifest(manifest);
      const workManifestPath = join(workDir, "result-manifest.json");
      await writeFile(workManifestPath, serializedManifest, "utf8");
      await heartbeat({ phase: "uploading", progress: 0.96, message: "Uploading manifest." });
      await retry(
        () => this.options.objectStore.putFile(claim.spec.manifestKey, workManifestPath, {
          contentType: "application/json",
          metadata: { "snip-render-job": claim.jobId },
        }),
        3,
        signal,
      );
      if (this.options.resultManifestPath) {
        await atomicWrite(this.options.resultManifestPath, serializedManifest);
      }
      return {
        outputKey: claim.spec.outputKey,
        manifestKey: claim.spec.manifestKey,
        outputBytes: outputDetails.size,
        cache,
        manifest,
      };
    } finally {
      if (!this.options.keepWorkDir) await rm(workDir, { recursive: true, force: true });
    }
  }

  private async downloadSources(
    claim: JobClaim,
    workDir: string,
    heartbeat: PipelineHeartbeat,
    signal?: AbortSignal,
  ): Promise<DownloadedSource[]> {
    const uniqueSegments = [...new Map(
      claim.spec.segments.map((segment) => [sourceIdentity(segment), segment]),
    ).values()];
    await heartbeat({
      phase: "downloading",
      progress: 0.02,
      message: `Downloading ${uniqueSegments.length} source objects.`,
    });
    let downloadedCount = 0;
    return await mapConcurrent(uniqueSegments, 4, async (segment) => {
      signal?.throwIfAborted();
      const identity = sourceIdentity(segment);
      const extension = basename(segment.sourceKey).split(".").pop() || "media";
      const localPath = join(workDir, "sources", `${shortHash(identity)}.${extension}`);
      const info = await retry(
        () => this.options.objectStore.downloadToFile(segment.sourceKey, localPath),
        3,
        signal,
      );
      downloadedCount += 1;
      await heartbeat({
        phase: "downloading",
        progress: 0.02 + 0.1 * (downloadedCount / uniqueSegments.length),
        message: `Downloaded ${downloadedCount} of ${uniqueSegments.length} sources.`,
      });
      return {
        identity,
        key: segment.sourceKey,
        contentId: segment.sourceContentId,
        localPath,
        downloadedBytes: info.bytes,
        probe: { durationSeconds: 0, hasAudio: false, keyframes: [] },
      };
    });
  }

  private planUnits(
    claim: JobClaim,
    sources: DownloadedSource[],
    workDir: string,
  ): PlannedUnit[] {
    const sourceByIdentity = new Map(sources.map((source) => [source.identity, source]));
    return claim.spec.segments.flatMap((segment) => {
      const source = sourceByIdentity.get(sourceIdentity(segment));
      if (!source) throw new Error(`Downloaded source missing for ${segment.sourceKey}.`);
      if (segment.outSeconds > source.probe.durationSeconds + 0.01) {
        throw new Error(
          `Segment outSeconds ${segment.outSeconds} exceeds ${segment.sourceKey} duration ${source.probe.durationSeconds}.`,
        );
      }
      return planGopSegments(
        segment.inSeconds,
        segment.outSeconds,
        source.probe.keyframes,
      ).map((range) => {
        const address = this.options.cache.address({
          sourceContentId: segment.sourceContentId,
          inSeconds: range.inSeconds,
          outSeconds: range.outSeconds,
          effects: segment.effects,
          target: claim.spec.target,
        });
        return {
          source,
          sourceSegment: segment,
          range,
          address,
          artifactPath: join(workDir, "segments", `${address.hash}.mp4`),
        };
      });
    });
  }

  private buildCacheManifest(
    units: PlannedUnit[],
    outcomes: Map<string, CacheLookupResult>,
  ): CacheSegmentManifest[] {
    return units.map((unit) => {
      const outcome = outcomes.get(unit.address.hash);
      if (!outcome) throw new Error(`Missing cache outcome for ${unit.address.hash}.`);
      return {
        cacheHash: outcome.hash,
        cacheObjectKey: outcome.objectKey,
        sourceContentId: unit.source.contentId,
        inSeconds: unit.range.inSeconds,
        outSeconds: unit.range.outSeconds,
        durationSeconds: unit.range.durationSeconds,
        startsAtKeyframe: unit.range.startsAtKeyframe,
        endsAtKeyframe: unit.range.endsAtKeyframe,
        cacheResult: outcome.hit ? "hit" : "miss",
        bytes: outcome.bytes,
      };
    });
  }
}
