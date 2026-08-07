# Browser playback engine

`PlaybackController` is the wave-2 timeline contract. It owns transport and
frame output while the caller owns controls and edit state.

```ts
import { createPlaybackController } from "@/lib/playback";

const controller = createPlaybackController({ canvas, fallbackVideo });

await controller.load({
  url: signedR2ProxyUrl,
  contentHash: rendition.r2Key,
  byteLength: rendition.filesizeBytes,
  mimeType: "video/mp4",
});

await controller.seek(12.5); // resolves after the chosen frame is painted
await controller.play();
controller.pause();

const stop = controller.on("timeupdate", ({ currentTime }) => {
  // currentTime is the timestamp of the displayed frame.
});
```

## Contract

- `load(source)` loads immutable proxy metadata and paints frame zero.
- `seek(seconds)` seeks to the preceding decodable frame and resolves with its
  exact timestamp.
- `play()` and `pause()` control transport.
- `currentTime` is frame-accurate for the WebCodecs path.
- `ready`, `frame`, `timeupdate`, `play`, `pause`, `waiting`, `ended`,
  `modechange`, and `error` cover UI integration without exposing decoder
  internals.
- `destroy()` aborts range work and releases decoders and frames.

## Pipeline

The primary path dynamically loads MP4Box.js, reads only top-level MP4 metadata,
builds an H.264 sample/GOP index, fetches the GOP around the playhead with HTTP
Range, sends its samples to `VideoDecoder`, and paints `VideoFrame` output to a
canvas. A request is capped at 32 MiB. The engine never issues a whole-file GET.

Exact byte ranges and the reusable sample/GOP index are cached in OPFS. The
disposable LRU budget is 512 MiB, enough for several active 720p working sets
without treating browser storage as a second media library.

If WebCodecs, H.264 configuration, CORS range support, or decoding fails, the
controller keeps the same API and switches to the supplied plain `<video>`
element. Native video then supplies normal audio/video playback and browser
range behavior.

## Sequence playback

`SequencePlaybackSurface` maps timeline time into each clip's source range and
keeps two controllers alive. The inactive bank loads and seeks the next clip's
proxy window while the active bank plays, then the surface swaps banks at the
cut. A single black frame can still appear during a slow bank swap in M1.
