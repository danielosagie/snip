/**
 * Reads what a browser can actually know about a file before it is uploaded.
 *
 * The upload queue used to show a name and a byte count, which is the least
 * informative thing on screen at the moment you most want to check you grabbed
 * the right take. Duration, pixel dimensions and a poster frame are all
 * available locally from a File — no server round trip, no upload required.
 *
 * Codec is deliberately NOT here. The browser exposes no codec string for a
 * local file without parsing the container ourselves, and a label we cannot
 * read honestly is worse than no label.
 */

export type LocalMediaMeta = {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  /** Object URL for a poster frame. Caller must revoke it. */
  posterUrl: string | null;
};

const EMPTY: LocalMediaMeta = {
  durationSec: null,
  width: null,
  height: null,
  posterUrl: null,
};

/**
 * Give up rather than hang. A partially-copied file off a card reader can make
 * loadedmetadata never fire, and a queue row that waits forever on a probe is
 * worse than a row with no duration on it.
 */
const PROBE_TIMEOUT_MS = 5000;

/** Seek this far in for the poster: frame zero is very often black or a slate. */
const POSTER_SEEK_SEC = 1;

/** Poster is a queue thumbnail, roughly 52x30 CSS px. 320 wide covers 3x. */
const POSTER_MAX_WIDTH = 320;

function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), PROBE_TIMEOUT_MS)),
  ]);
}

function probeImage(file: File): Promise<LocalMediaMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        durationSec: null,
        width: img.naturalWidth || null,
        height: img.naturalHeight || null,
        // The file itself is the poster. Not revoked here; the caller owns it.
        posterUrl: url,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(EMPTY);
    };
    img.src = url;
  });
}

function probeVideo(file: File): Promise<LocalMediaMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    // Safari will not decode a frame for a video that was never in the DOM
    // unless playsInline is set.
    video.playsInline = true;

    const done = (meta: LocalMediaMeta) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };

    video.onerror = () => done(EMPTY);

    video.onloadedmetadata = () => {
      const base: LocalMediaMeta = {
        durationSec: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        posterUrl: null,
      };

      video.onseeked = () => {
        try {
          const scale = Math.min(1, POSTER_MAX_WIDTH / (video.videoWidth || 1));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) return done(base);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => {
              done({
                ...base,
                posterUrl: blob ? URL.createObjectURL(blob) : null,
              });
            },
            "image/jpeg",
            0.72,
          );
        } catch {
          // Tainted canvas or a codec the browser can decode metadata for but
          // not paint. Dimensions and duration still stand.
          done(base);
        }
      };

      const target = Math.min(
        POSTER_SEEK_SEC,
        Number.isFinite(video.duration) ? video.duration / 2 : POSTER_SEEK_SEC,
      );
      try {
        video.currentTime = target;
      } catch {
        done(base);
      }
    };

    video.src = url;
  });
}

/**
 * Best-effort local metadata. Never throws and never blocks longer than
 * PROBE_TIMEOUT_MS; an unreadable file simply reports nothing.
 */
export async function probeLocalMedia(file: File): Promise<LocalMediaMeta> {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("video/")) return withTimeout(probeVideo(file), EMPTY);
  if (type.startsWith("image/") && type !== "image/svg+xml") {
    return withTimeout(probeImage(file), EMPTY);
  }
  return EMPTY;
}

/** "00:03:14", or "03:14" under an hour. Blank for unknown. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * "4K" / "1080p" for the shapes people name, exact pixels otherwise. A person
 * scanning a queue reads "4K" faster than "3840 x 2160", but an odd crop must
 * not be rounded into a lie.
 */
export function formatResolution(
  width: number | null | undefined,
  height: number | null | undefined,
): string {
  if (!width || !height) return "";
  const named: Array<[number, number, string]> = [
    [7680, 4320, "8K"],
    [3840, 2160, "4K"],
    [2560, 1440, "1440p"],
    [1920, 1080, "1080p"],
    [1280, 720, "720p"],
  ];
  for (const [w, h, label] of named) {
    if (width === w && height === h) return label;
  }
  return `${width} x ${height}`;
}
