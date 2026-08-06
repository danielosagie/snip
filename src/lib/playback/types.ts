export type PlaybackMode = "webcodecs" | "video";

export type PlaybackSource = {
  /** A CORS-enabled, range-capable URL for an immutable proxy MP4. */
  url: string;
  /**
   * Stable content identity, normally the R2 object key or its digest. It must
   * change when the bytes change so cached GOPs can never cross revisions.
   */
  contentHash: string;
  byteLength?: number;
  mimeType?: string;
};

export type PlaybackMetadata = {
  mode: PlaybackMode;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  codec?: string;
};

export type PlaybackEventMap = {
  ready: PlaybackMetadata;
  frame: { currentTime: number };
  timeupdate: { currentTime: number };
  play: { currentTime: number };
  pause: { currentTime: number };
  waiting: { currentTime: number };
  ended: { currentTime: number };
  modechange: { mode: PlaybackMode; reason?: string };
  error: { error: Error };
};

export type PlaybackEventName = keyof PlaybackEventMap;
export type PlaybackListener<K extends PlaybackEventName> = (
  event: PlaybackEventMap[K],
) => void;

/**
 * Wave 2 drives this interface. `currentTime` is the timestamp of the frame
 * actually painted, not an estimated wall-clock position. `seek()` resolves
 * after that frame is visible.
 */
export interface PlaybackController {
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly mode: PlaybackMode;

  load(source: PlaybackSource): Promise<PlaybackMetadata>;
  seek(time: number): Promise<number>;
  play(): Promise<void>;
  pause(): void;
  on<K extends PlaybackEventName>(
    event: K,
    listener: PlaybackListener<K>,
  ): () => void;
  destroy(): void;
}

export type PlaybackOutputs = {
  canvas: HTMLCanvasElement;
  fallbackVideo: HTMLVideoElement;
};

