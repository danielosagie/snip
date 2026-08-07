const KEYFRAME_EPSILON_SECONDS = 0.000_5;

export interface GopSegment {
  inSeconds: number;
  outSeconds: number;
  durationSeconds: number;
  startsAtKeyframe: boolean;
  endsAtKeyframe: boolean;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= KEYFRAME_EPSILON_SECONDS;
}

function containsKeyframe(keyframes: number[], timestamp: number): boolean {
  return keyframes.some((keyframe) => nearlyEqual(keyframe, timestamp));
}

/**
 * Splits a requested source range at every internal source keyframe. Interior
 * units are whole GOPs and can be reused when neighboring edit boundaries move.
 * Only the first and last unit can be partial GOPs.
 */
export function planGopSegments(
  inSeconds: number,
  outSeconds: number,
  keyframes: number[],
): GopSegment[] {
  if (!Number.isFinite(inSeconds) || !Number.isFinite(outSeconds)) {
    throw new Error("GOP bounds must be finite.");
  }
  if (inSeconds < 0 || outSeconds <= inSeconds) {
    throw new Error("GOP range requires 0 <= inSeconds < outSeconds.");
  }
  const cleanKeyframes = [...new Set(
    keyframes
      .filter(Number.isFinite)
      .filter((value) => value >= 0)
      .map((value) => Math.round(value * 1_000_000) / 1_000_000),
  )].sort((left, right) => left - right);
  const internal = cleanKeyframes.filter(
    (keyframe) =>
      keyframe > inSeconds + KEYFRAME_EPSILON_SECONDS
      && keyframe < outSeconds - KEYFRAME_EPSILON_SECONDS,
  );
  const boundaries = [inSeconds, ...internal, outSeconds];
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    return {
      inSeconds: start,
      outSeconds: end,
      durationSeconds: end - start,
      startsAtKeyframe: containsKeyframe(cleanKeyframes, start),
      endsAtKeyframe: containsKeyframe(cleanKeyframes, end),
    };
  });
}
