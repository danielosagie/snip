import { loadVideoSampleIndex } from "./demuxMp4";
import {
  findGopAtTime,
  sampleDurationSeconds,
  samplePresentationTime,
  type IndexedVideoSample,
  type VideoSampleIndex,
} from "./mp4Index";
import { CachedRangeSource } from "./rangeSource";
import type {
  PlaybackController,
  PlaybackEventMap,
  PlaybackEventName,
  PlaybackListener,
  PlaybackMetadata,
  PlaybackMode,
  PlaybackOutputs,
  PlaybackSource,
} from "./types";

type QueuedSample = {
  sample: IndexedVideoSample;
  data: Uint8Array<ArrayBuffer>;
};

type DecodePurpose =
  | {
      kind: "seek";
      targetUs: number;
      before: VideoFrame | null;
      after: VideoFrame | null;
    }
  | { kind: "play"; minimumUs: number };

const MAX_DECODE_AHEAD = 8;
const PREFETCH_SAMPLE_THRESHOLD = 24;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.min(Math.max(0, duration), time));
}

export class BrowserPlaybackController implements PlaybackController {
  private listeners = new Map<
    PlaybackEventName,
    Set<(event: unknown) => void>
  >();
  private source: PlaybackSource | null = null;
  private rangeSource: CachedRangeSource | null = null;
  private sampleIndex: VideoSampleIndex | null = null;
  private decoderConfig: VideoDecoderConfig | null = null;
  private decoder: VideoDecoder | null = null;
  private decodePurpose: DecodePurpose | null = null;
  private queuedSamples: QueuedSample[] = [];
  private queuedSampleCursor = 0;
  private decodedFrames: VideoFrame[] = [];
  private nextGopToLoad = 0;
  private pendingGop: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private generation = 0;
  private rafId: number | null = null;
  private playing = false;
  private waiting = false;
  private destroyed = false;
  private clockMediaTime = 0;
  private clockStartedAt = 0;
  private currentTimeValue = 0;
  private durationValue = 0;
  private modeValue: PlaybackMode = "webcodecs";
  private metadata: PlaybackMetadata | null = null;
  private fallbackCleanup: (() => void) | null = null;
  private fallbackRecovery: Promise<void> | null = null;

  constructor(private readonly outputs: PlaybackOutputs) {
    outputs.fallbackVideo.preload = "metadata";
    outputs.fallbackVideo.playsInline = true;
    this.showOutput("webcodecs");
  }

  get currentTime(): number {
    return this.modeValue === "video"
      ? this.outputs.fallbackVideo.currentTime || this.currentTimeValue
      : this.currentTimeValue;
  }

  get duration(): number {
    return this.durationValue;
  }

  get paused(): boolean {
    return this.modeValue === "video"
      ? this.outputs.fallbackVideo.paused
      : !this.playing;
  }

  get mode(): PlaybackMode {
    return this.modeValue;
  }

  async load(source: PlaybackSource): Promise<PlaybackMetadata> {
    this.assertAlive();
    this.resetMedia();
    this.source = source;
    const generation = ++this.generation;
    this.abortController = new AbortController();

    if (
      typeof VideoDecoder === "undefined" ||
      typeof EncodedVideoChunk === "undefined"
    ) {
      return await this.activateFallback(source, "WebCodecs is unavailable.");
    }

    try {
      const rangeSource = await CachedRangeSource.create(source);
      const index = await loadVideoSampleIndex(
        rangeSource,
        this.abortController.signal,
      );
      if (generation !== this.generation) throw new DOMException("Aborted", "AbortError");

      const config: VideoDecoderConfig = {
        codec: index.codec,
        codedWidth: index.width,
        codedHeight: index.height,
        description: fromBase64(index.decoderDescriptionBase64),
        optimizeForLatency: true,
      };
      const support = await VideoDecoder.isConfigSupported(config);
      if (!support.supported) {
        throw new Error(`This browser cannot decode ${index.codec} with WebCodecs.`);
      }

      this.rangeSource = rangeSource;
      this.sampleIndex = index;
      this.decoderConfig = support.config ?? config;
      this.durationValue = index.duration;
      this.metadata = {
        mode: "webcodecs",
        duration: index.duration,
        width: index.width,
        height: index.height,
        frameRate: index.frameRate,
        codec: index.codec,
      };
      this.outputs.canvas.width = index.width;
      this.outputs.canvas.height = index.height;
      this.setMode("webcodecs");
      await this.seekWebCodecs(0, false);
      this.emit("ready", this.metadata);
      return this.metadata;
    } catch (error) {
      if (asError(error).name === "AbortError") throw error;
      return await this.activateFallback(source, asError(error).message);
    }
  }

  async seek(time: number): Promise<number> {
    this.assertAlive();
    if (!this.source) throw new Error("Load a playback source before seeking.");
    if (this.modeValue === "video") return await this.seekFallback(time);

    try {
      return await this.seekWebCodecs(time, this.playing);
    } catch (error) {
      if (asError(error).name === "AbortError") throw error;
      await this.recoverWithFallback(error);
      return await this.seekFallback(time);
    }
  }

  async play(): Promise<void> {
    this.assertAlive();
    if (!this.source) throw new Error("Load a playback source before playing.");
    if (this.modeValue === "video") {
      await this.outputs.fallbackVideo.play();
      return;
    }
    if (this.playing) return;

    try {
      await this.startWebCodecsPlayback();
    } catch (error) {
      if (asError(error).name === "AbortError") return;
      await this.recoverWithFallback(error);
      await this.outputs.fallbackVideo.play();
    }
  }

  pause(): void {
    if (this.modeValue === "video") {
      this.outputs.fallbackVideo.pause();
      return;
    }
    if (!this.playing) return;
    this.playing = false;
    this.cancelAnimationFrame();
    this.emit("pause", { currentTime: this.currentTimeValue });
  }

  on<K extends PlaybackEventName>(
    event: K,
    listener: PlaybackListener<K>,
  ): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    const wrapped = (payload: unknown) =>
      listener(payload as PlaybackEventMap[K]);
    listeners.add(wrapped);
    this.listeners.set(event, listeners);
    return () => listeners.delete(wrapped);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resetMedia();
    this.listeners.clear();
  }

  private async seekWebCodecs(
    time: number,
    resumeAfterSeek: boolean,
  ): Promise<number> {
    const index = this.requireIndex();
    const target = clampTime(time, index.duration);
    const generation = ++this.generation;
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.playing = false;
    this.cancelAnimationFrame();
    this.clearDecodeBuffers();
    this.emitWaiting();

    const gopIndex = findGopAtTime(index.gops, target);
    const gop = index.gops[gopIndex];
    const rangeBytes = await this.requireRangeSource().get(
      { start: gop.byteStart, end: gop.byteEnd },
      this.abortController.signal,
    );
    if (generation !== this.generation) throw new DOMException("Aborted", "AbortError");

    this.resetDecoder();
    const purpose: DecodePurpose = {
      kind: "seek",
      targetUs: Math.round(target * 1_000_000),
      before: null,
      after: null,
    };
    this.decodePurpose = purpose;
    for (let sampleIndex = gop.sampleStart; sampleIndex <= gop.sampleEnd; sampleIndex += 1) {
      const sample = index.samples[sampleIndex];
      this.decoder?.decode(this.makeChunk(sample, rangeBytes, gop.byteStart));
    }
    await this.decoder?.flush();
    if (generation !== this.generation) throw new DOMException("Aborted", "AbortError");

    const frame = purpose.before ?? purpose.after;
    if (!frame) throw new Error("WebCodecs did not produce a frame for this GOP.");
    this.paintFrame(frame);
    if (purpose.before && purpose.before !== frame) purpose.before.close();
    if (purpose.after && purpose.after !== frame) purpose.after.close();
    frame.close();
    this.decodePurpose = null;
    this.setWaiting(false);
    this.emit("timeupdate", { currentTime: this.currentTimeValue });

    if (resumeAfterSeek) await this.startWebCodecsPlayback();
    return this.currentTimeValue;
  }

  private async startWebCodecsPlayback(): Promise<void> {
    const index = this.requireIndex();
    if (this.currentTimeValue >= index.duration) {
      await this.seekWebCodecs(0, false);
    }
    const generation = ++this.generation;
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.clearDecodeBuffers();
    this.resetDecoder();
    this.decodePurpose = {
      kind: "play",
      minimumUs: Math.max(0, Math.round(this.currentTimeValue * 1_000_000) - 1),
    };

    const gopIndex = findGopAtTime(index.gops, this.currentTimeValue);
    await this.appendGop(gopIndex, generation);
    if (generation !== this.generation) throw new DOMException("Aborted", "AbortError");
    this.nextGopToLoad = gopIndex + 1;
    this.playing = true;
    this.clockMediaTime = this.currentTimeValue;
    this.clockStartedAt = performance.now();
    this.setWaiting(false);
    this.emit("play", { currentTime: this.currentTimeValue });
    this.pumpDecoder();
    this.scheduleTick();
  }

  private scheduleTick(): void {
    this.cancelAnimationFrame();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.rafId = null;
    if (!this.playing || this.destroyed || this.modeValue !== "webcodecs") return;

    const targetUs = Math.round(
      (this.clockMediaTime + (now - this.clockStartedAt) / 1000) * 1_000_000,
    );
    let dueFrame: VideoFrame | null = null;
    while (
      this.decodedFrames.length > 0 &&
      this.decodedFrames[0].timestamp <= targetUs
    ) {
      dueFrame?.close();
      dueFrame = this.decodedFrames.shift() ?? null;
    }
    if (dueFrame) {
      this.paintFrame(dueFrame);
      dueFrame.close();
      this.setWaiting(false);
      this.emit("frame", { currentTime: this.currentTimeValue });
      this.emit("timeupdate", { currentTime: this.currentTimeValue });
    }

    this.pumpDecoder();
    const samplesRemaining = this.queuedSamples.length - this.queuedSampleCursor;
    if (
      samplesRemaining <= PREFETCH_SAMPLE_THRESHOLD &&
      !this.pendingGop &&
      this.nextGopToLoad < this.requireIndex().gops.length
    ) {
      const gop = this.nextGopToLoad;
      this.nextGopToLoad += 1;
      const generation = this.generation;
      this.pendingGop = this.appendGop(gop, generation)
        .then(() => {
          if (generation === this.generation) this.pumpDecoder();
        })
        .catch((error) => this.recoverWithFallback(error))
        .finally(() => {
          this.pendingGop = null;
        });
    }

    const decoderIdle = (this.decoder?.decodeQueueSize ?? 0) === 0;
    const exhausted =
      this.queuedSampleCursor >= this.queuedSamples.length &&
      this.nextGopToLoad >= this.requireIndex().gops.length &&
      !this.pendingGop;
    if (exhausted && decoderIdle && this.decodedFrames.length === 0) {
      this.playing = false;
      this.currentTimeValue = this.durationValue;
      this.emit("timeupdate", { currentTime: this.currentTimeValue });
      this.emit("ended", { currentTime: this.currentTimeValue });
      return;
    }

    if (
      !dueFrame &&
      this.decodedFrames.length === 0 &&
      decoderIdle &&
      (samplesRemaining === 0 || this.pendingGop)
    ) {
      this.emitWaiting();
      this.clockMediaTime = this.currentTimeValue;
      this.clockStartedAt = now;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private pumpDecoder(): void {
    if (!this.decoder || this.decoder.state !== "configured") return;
    while (
      this.queuedSampleCursor < this.queuedSamples.length &&
      this.decoder.decodeQueueSize + this.decodedFrames.length < MAX_DECODE_AHEAD
    ) {
      const queued = this.queuedSamples[this.queuedSampleCursor];
      this.queuedSampleCursor += 1;
      this.decoder.decode(
        new EncodedVideoChunk({
          type: queued.sample.isSync ? "key" : "delta",
          timestamp: Math.round(samplePresentationTime(queued.sample) * 1_000_000),
          duration: Math.max(
            1,
            Math.round(sampleDurationSeconds(queued.sample) * 1_000_000),
          ),
          data: queued.data,
        }),
      );
    }

    if (this.queuedSampleCursor > 512) {
      this.queuedSamples = this.queuedSamples.slice(this.queuedSampleCursor);
      this.queuedSampleCursor = 0;
    }
  }

  private async appendGop(gopIndex: number, generation: number): Promise<void> {
    const index = this.requireIndex();
    const gop = index.gops[gopIndex];
    const bytes = await this.requireRangeSource().get(
      { start: gop.byteStart, end: gop.byteEnd },
      this.abortController?.signal,
    );
    if (generation !== this.generation) throw new DOMException("Aborted", "AbortError");

    for (let sampleIndex = gop.sampleStart; sampleIndex <= gop.sampleEnd; sampleIndex += 1) {
      const sample = index.samples[sampleIndex];
      const relativeStart = sample.offset - gop.byteStart;
      this.queuedSamples.push({
        sample,
        data: new Uint8Array(bytes, relativeStart, sample.size),
      });
    }
  }

  private makeChunk(
    sample: IndexedVideoSample,
    rangeBytes: ArrayBuffer,
    rangeStart: number,
  ): EncodedVideoChunk {
    const relativeStart = sample.offset - rangeStart;
    return new EncodedVideoChunk({
      type: sample.isSync ? "key" : "delta",
      timestamp: Math.round(samplePresentationTime(sample) * 1_000_000),
      duration: Math.max(
        1,
        Math.round(sampleDurationSeconds(sample) * 1_000_000),
      ),
      data: new Uint8Array(rangeBytes, relativeStart, sample.size),
    });
  }

  private resetDecoder(): void {
    this.decoder?.close();
    const config = this.decoderConfig;
    if (!config) throw new Error("The WebCodecs decoder is not configured.");
    this.decoder = new VideoDecoder({
      output: (frame) => this.handleDecodedFrame(frame),
      error: (error) => {
        void this.recoverWithFallback(error).catch((fallbackError) => {
          this.emit("error", { error: asError(fallbackError) });
        });
      },
    });
    this.decoder.configure(config);
  }

  private handleDecodedFrame(frame: VideoFrame): void {
    const purpose = this.decodePurpose;
    if (!purpose) {
      frame.close();
      return;
    }
    if (purpose.kind === "seek") {
      if (frame.timestamp <= purpose.targetUs) {
        if (!purpose.before || frame.timestamp > purpose.before.timestamp) {
          purpose.before?.close();
          purpose.before = frame;
        } else {
          frame.close();
        }
      } else if (!purpose.after || frame.timestamp < purpose.after.timestamp) {
        purpose.after?.close();
        purpose.after = frame;
      } else {
        frame.close();
      }
      return;
    }

    if (frame.timestamp < purpose.minimumUs) {
      frame.close();
      queueMicrotask(() => this.pumpDecoder());
      return;
    }
    const insertionPoint = this.decodedFrames.findIndex(
      (candidate) => candidate.timestamp > frame.timestamp,
    );
    if (insertionPoint === -1) this.decodedFrames.push(frame);
    else this.decodedFrames.splice(insertionPoint, 0, frame);
  }

  private paintFrame(frame: VideoFrame): void {
    const canvas = this.outputs.canvas;
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D rendering is unavailable.");
    context.drawImage(frame, 0, 0, width, height);
    this.currentTimeValue = frame.timestamp / 1_000_000;
  }

  private async activateFallback(
    source: PlaybackSource,
    reason?: string,
  ): Promise<PlaybackMetadata> {
    this.clearDecodeBuffers();
    this.decoder?.close();
    this.decoder = null;
    this.source = source;
    this.setMode("video", reason);
    const video = this.outputs.fallbackVideo;
    video.src = source.url;
    video.load();

    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        resolve();
        return;
      }
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(video.error ?? new Error("The proxy could not be loaded."));
      };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadedmetadata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    this.durationValue = Number.isFinite(video.duration) ? video.duration : 0;
    this.currentTimeValue = video.currentTime;
    this.metadata = {
      mode: "video",
      duration: this.durationValue,
      width: video.videoWidth,
      height: video.videoHeight,
      frameRate: 0,
    };
    this.bindFallbackEvents();
    this.emit("ready", this.metadata);
    return this.metadata;
  }

  private bindFallbackEvents(): void {
    this.fallbackCleanup?.();
    const video = this.outputs.fallbackVideo;
    const onTime = () => {
      this.currentTimeValue = video.currentTime;
      this.emit("timeupdate", { currentTime: this.currentTimeValue });
    };
    const onPlay = () => this.emit("play", { currentTime: video.currentTime });
    const onPause = () => this.emit("pause", { currentTime: video.currentTime });
    const onWaiting = () => this.emit("waiting", { currentTime: video.currentTime });
    const onEnded = () => this.emit("ended", { currentTime: video.currentTime });
    const onError = () => {
      const message = video.error?.message || "The proxy playback failed.";
      this.emit("error", { error: new Error(message) });
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    this.fallbackCleanup = () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
    };
  }

  private async seekFallback(time: number): Promise<number> {
    const video = this.outputs.fallbackVideo;
    const target = clampTime(time, this.durationValue);
    if (Math.abs(video.currentTime - target) < 0.0005) return video.currentTime;
    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(video.error ?? new Error("The proxy seek failed."));
      };
      const cleanup = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.currentTime = target;
    });
    this.currentTimeValue = video.currentTime;
    this.emit("timeupdate", { currentTime: this.currentTimeValue });
    return this.currentTimeValue;
  }

  private async recoverWithFallback(error: unknown): Promise<void> {
    if (this.fallbackRecovery) return await this.fallbackRecovery;
    if (this.modeValue === "video" || !this.source || this.destroyed) return;

    const recovery = (async () => {
      const wasPlaying = this.playing;
      const time = this.currentTimeValue;
      const source = this.source;
      if (!source) return;
      this.emit("error", { error: asError(error) });
      await this.activateFallback(source, asError(error).message);
      await this.seekFallback(time);
      if (wasPlaying) await this.outputs.fallbackVideo.play();
    })();
    this.fallbackRecovery = recovery;
    try {
      await recovery;
    } finally {
      if (this.fallbackRecovery === recovery) this.fallbackRecovery = null;
    }
  }

  private setMode(mode: PlaybackMode, reason?: string): void {
    const changed = this.modeValue !== mode;
    this.modeValue = mode;
    this.showOutput(mode);
    if (changed || reason) this.emit("modechange", { mode, reason });
  }

  private showOutput(mode: PlaybackMode): void {
    this.outputs.canvas.hidden = mode !== "webcodecs";
    this.outputs.fallbackVideo.hidden = mode !== "video";
  }

  private emitWaiting(): void {
    if (this.waiting) return;
    this.waiting = true;
    this.emit("waiting", { currentTime: this.currentTimeValue });
  }

  private setWaiting(value: boolean): void {
    this.waiting = value;
  }

  private emit<K extends PlaybackEventName>(
    event: K,
    payload: PlaybackEventMap[K],
  ): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  private clearDecodeBuffers(): void {
    for (const frame of this.decodedFrames) frame.close();
    this.decodedFrames = [];
    if (this.decodePurpose?.kind === "seek") {
      this.decodePurpose.before?.close();
      this.decodePurpose.after?.close();
    }
    this.decodePurpose = null;
    this.queuedSamples = [];
    this.queuedSampleCursor = 0;
    this.pendingGop = null;
  }

  private cancelAnimationFrame(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private resetMedia(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.playing = false;
    this.cancelAnimationFrame();
    this.clearDecodeBuffers();
    this.decoder?.close();
    this.decoder = null;
    this.decoderConfig = null;
    this.rangeSource = null;
    this.sampleIndex = null;
    this.metadata = null;
    this.currentTimeValue = 0;
    this.durationValue = 0;
    this.waiting = false;
    this.fallbackRecovery = null;
    this.fallbackCleanup?.();
    this.fallbackCleanup = null;
    this.outputs.fallbackVideo.pause();
    this.outputs.fallbackVideo.removeAttribute("src");
    this.outputs.fallbackVideo.load();
  }

  private requireIndex(): VideoSampleIndex {
    if (!this.sampleIndex) throw new Error("The proxy sample index is not loaded.");
    return this.sampleIndex;
  }

  private requireRangeSource(): CachedRangeSource {
    if (!this.rangeSource) throw new Error("The proxy range source is not loaded.");
    return this.rangeSource;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("This playback controller was destroyed.");
  }
}

export function createPlaybackController(
  outputs: PlaybackOutputs,
): PlaybackController {
  return new BrowserPlaybackController(outputs);
}
