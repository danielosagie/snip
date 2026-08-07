export type RenderCodec = "h264" | "hevc";
export type RenderContainer = "mp4";

export interface SegmentEffects {
  brightness: number;
  contrast: number;
  saturation: number;
  volume: number;
  muted: boolean;
}

export interface RenderTarget {
  codec: RenderCodec;
  container: RenderContainer;
  width: number;
  height: number;
  fps: number;
  pixelFormat: "yuv420p";
  crf: number;
  preset: "veryfast" | "faster" | "fast" | "medium" | "slow";
  audioCodec: "aac";
  audioBitrateKbps: number;
  audioSampleRate: number;
  audioChannels: 1 | 2;
}

export interface SourceSegment {
  sourceKey: string;
  /** Immutable checksum, version ID, or other content identity. Never a mutable URL. */
  sourceContentId: string;
  inSeconds: number;
  outSeconds: number;
  effects: SegmentEffects;
}

export interface RenderJobSpec {
  segments: SourceSegment[];
  target: RenderTarget;
  outputKey: string;
  manifestKey: string;
}

export interface LocalJobInput {
  id?: string;
  spec?: unknown;
  [key: string]: unknown;
}

export type JobPhase =
  | "claimed"
  | "downloading"
  | "probing"
  | "rendering"
  | "uploading"
  | "complete";

export interface JobClaim {
  jobId: string;
  claimToken: string;
  workerId: string;
  attempt: number;
  spec: RenderJobSpec;
}

export interface JobHeartbeat {
  phase: JobPhase;
  progress: number;
  message?: string;
}

export interface CacheSegmentManifest {
  cacheHash: string;
  cacheObjectKey: string;
  sourceContentId: string;
  inSeconds: number;
  outSeconds: number;
  durationSeconds: number;
  startsAtKeyframe: boolean;
  endsAtKeyframe: boolean;
  cacheResult: "hit" | "miss";
  bytes: number;
}

export interface CacheAccounting {
  hits: number;
  misses: number;
  totalSegments: number;
  hitRate: number;
  hitBytes: number;
  missBytes: number;
  totalBytes: number;
  byteHitRate: number;
  hitDurationSeconds: number;
  missDurationSeconds: number;
  totalDurationSeconds: number;
  streamCopyPercent: number;
}

export interface RenderResultManifest {
  version: 1;
  jobId: string;
  attempt: number;
  startedAt: string;
  completedAt: string;
  output: {
    key: string;
    bytes: number;
    codec: RenderCodec;
    container: RenderContainer;
    width: number;
    height: number;
    durationSeconds: number;
  };
  sources: {
    key: string;
    contentId: string;
    downloadedBytes: number;
  }[];
  cache: CacheAccounting;
  cacheSegments: CacheSegmentManifest[];
}

export interface RenderJobResult {
  outputKey: string;
  manifestKey: string;
  outputBytes: number;
  cache: CacheAccounting;
  manifest: RenderResultManifest;
}
