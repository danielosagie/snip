import type {
  ISOFile,
  Movie,
  SampleEntry,
  VisualSampleEntry,
} from "mp4box";

import { CachedRangeSource } from "./rangeSource";
import { readIsoBoxHeader, type IsoBoxHeader } from "./rangeMath";
import {
  buildGopIndex,
  isVideoSampleIndex,
  toIndexedSamples,
  type VideoSampleIndex,
} from "./mp4Index";

const INITIAL_METADATA_BYTES = 512 * 1024;
const BOX_HEADER_BYTES = 16;
const MAX_TOP_LEVEL_BOXES = 128;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function locateMoov(
  source: CachedRangeSource,
  fileSize: number,
  head: ArrayBuffer,
  signal?: AbortSignal,
): Promise<IsoBoxHeader> {
  let offset = 0;
  for (
    let count = 0;
    count < MAX_TOP_LEVEL_BOXES && offset < fileSize;
    count += 1
  ) {
    let headerBytes: ArrayBuffer;
    if (offset + BOX_HEADER_BYTES <= head.byteLength) {
      headerBytes = head.slice(offset, offset + BOX_HEADER_BYTES);
    } else {
      headerBytes = await source.get(
        {
          start: offset,
          end: Math.min(fileSize - 1, offset + BOX_HEADER_BYTES - 1),
        },
        signal,
      );
    }

    const header = readIsoBoxHeader(headerBytes, offset, fileSize);
    if (header.type === "moov") return header;
    if (header.endExclusive <= offset) break;
    offset = header.endExclusive;
  }
  throw new Error("The MP4 does not contain a readable moov box.");
}

function getAvcDescription(
  file: ISOFile,
  trackId: number,
  DataStream: typeof import("mp4box")["DataStream"],
): Uint8Array {
  type AvcEntry = VisualSampleEntry & {
    avcC?: { write: (stream: InstanceType<typeof DataStream>) => void };
  };
  const track = file.getTrackById(trackId);
  const entry = track.mdia.minf.stbl.stsd.entries[0] as
    | AvcEntry
    | SampleEntry
    | undefined;
  if (!entry || !("avcC" in entry) || !entry.avcC) {
    throw new Error("The H.264 proxy is missing its AVC decoder configuration.");
  }

  const stream = new DataStream(0);
  entry.avcC.write(stream);
  const written = stream.getPosition();
  if (written <= 8) {
    throw new Error("The AVC decoder configuration is empty.");
  }
  return new Uint8Array(stream.buffer.slice(8, written));
}

function waitForMovie(file: ISOFile): {
  promise: Promise<Movie>;
  cancel: () => void;
} {
  let settled = false;
  let rejectPromise: (reason: Error) => void = () => undefined;
  const promise = new Promise<Movie>((resolve, reject) => {
    rejectPromise = reject;
    file.onReady = (movie) => {
      settled = true;
      resolve(movie);
    };
    file.onError = (module, message) => {
      settled = true;
      reject(new Error(`${module}: ${message}`));
    };
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      rejectPromise(new Error("MP4 metadata parsing did not complete."));
    },
  };
}

/**
 * MP4Box.js is the maintained GPAC browser demuxer and supports progressive,
 * discontiguous input. It is dynamically imported so fallback-only browsers
 * do not pay for it. We use it for container/sample tables only, then fetch
 * the indexed GOP byte ranges directly for WebCodecs.
 */
export async function loadVideoSampleIndex(
  source: CachedRangeSource,
  signal?: AbortSignal,
): Promise<VideoSampleIndex> {
  const { fileSize } = await source.probe(signal);
  const cached = await source.getCachedIndex();
  if (
    cached &&
    isVideoSampleIndex(cached) &&
    cached.fileSize === fileSize &&
    cached.samples.length > 0 &&
    cached.gops.length > 0
  ) {
    return cached;
  }

  const MP4Box = await import("mp4box");
  const file = MP4Box.createFile(false);
  const ready = waitForMovie(file);
  const head = await source.get(
    {
      start: 0,
      // Keep even tiny files as range workflows. The final byte is fetched
      // only with a later metadata/GOP request, never as one whole-file GET.
      end: Math.min(Math.max(0, fileSize - 2), INITIAL_METADATA_BYTES - 1),
    },
    signal,
  );
  const moov = await locateMoov(source, fileSize, head, signal);

  file.appendBuffer(MP4Box.MP4BoxBuffer.fromArrayBuffer(head, 0));
  const moovIsInsideHead = moov.endExclusive <= head.byteLength;
  if (!moovIsInsideHead) {
    const moovBytes = await source.get(
      { start: moov.start, end: moov.endExclusive - 1 },
      signal,
    );
    file.appendBuffer(
      MP4Box.MP4BoxBuffer.fromArrayBuffer(moovBytes, moov.start),
    );
  }

  if (!file.readySent) {
    ready.cancel();
    throw new Error("MP4 metadata is incomplete after reading moov.");
  }
  const movie = await ready.promise;

  const track = movie.videoTracks[0];
  if (!track) throw new Error("The MP4 has no video track.");
  if (!track.codec.toLowerCase().startsWith("avc1")) {
    throw new Error(
      `WebCodecs playback only accepts H.264 proxies (${track.codec}).`,
    );
  }

  const rawSamples = file.getTrackSamplesInfo(track.id);
  const samples = toIndexedSamples(rawSamples);
  if (samples.length === 0) {
    throw new Error("The MP4 video track has no indexed samples.");
  }

  const duration =
    track.timescale > 0
      ? track.duration / track.timescale
      : movie.timescale > 0
        ? movie.duration / movie.timescale
        : 0;
  const frameRate = duration > 0 ? samples.length / duration : 30;
  const description = getAvcDescription(file, track.id, MP4Box.DataStream);
  const index: VideoSampleIndex = {
    version: 1,
    fileSize,
    duration,
    width: track.video?.width ?? track.track_width,
    height: track.video?.height ?? track.track_height,
    frameRate,
    codec: track.codec,
    decoderDescriptionBase64: toBase64(description),
    samples,
    gops: buildGopIndex(samples, duration),
  };
  if (index.gops.length === 0) {
    throw new Error("The MP4 video track has no decodable GOPs.");
  }
  void source.putCachedIndex(index);
  return index;
}
