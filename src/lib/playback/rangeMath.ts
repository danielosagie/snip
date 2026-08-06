export type ByteRange = {
  start: number;
  end: number;
};

export function rangeLength(range: ByteRange): number {
  return Math.max(0, range.end - range.start + 1);
}

export function clampByteRange(
  range: ByteRange,
  totalBytes: number,
): ByteRange {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    throw new Error("The source has no addressable bytes.");
  }

  const lastByte = Math.max(0, Math.floor(totalBytes) - 1);
  const start = Math.min(lastByte, Math.max(0, Math.floor(range.start)));
  const end = Math.min(lastByte, Math.max(start, Math.floor(range.end)));
  return { start, end };
}

export function alignByteRange(
  range: ByteRange,
  totalBytes: number,
  alignment = 256 * 1024,
): ByteRange {
  const clamped = clampByteRange(range, totalBytes);
  const safeAlignment = Math.max(1, Math.floor(alignment));
  const start = Math.floor(clamped.start / safeAlignment) * safeAlignment;
  const end =
    Math.ceil((clamped.end + 1) / safeAlignment) * safeAlignment - 1;
  return clampByteRange({ start, end }, totalBytes);
}

export function mergeByteRanges(ranges: ByteRange[]): ByteRange[] {
  if (ranges.length <= 1) return ranges.map((range) => ({ ...range }));

  const sorted = ranges
    .map((range) => ({ ...range }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ByteRange[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index];
    const current = merged[merged.length - 1];
    if (next.start <= current.end + 1) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(next);
    }
  }

  return merged;
}

export function parseContentRange(value: string | null): {
  start: number;
  end: number;
  total: number;
} | null {
  if (!value) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match || match[3] === "*") return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    return null;
  }
  return { start, end, total };
}

export type IsoBoxHeader = {
  type: string;
  start: number;
  size: number;
  headerSize: 8 | 16;
  endExclusive: number;
};

/** Parse one ISO-BMFF top-level box header without touching its payload. */
export function readIsoBoxHeader(
  bytes: ArrayBuffer,
  absoluteStart: number,
  fileSize: number,
): IsoBoxHeader {
  if (bytes.byteLength < 8) {
    throw new Error("The MP4 box header is incomplete.");
  }
  const view = new DataView(bytes);
  const size32 = view.getUint32(0);
  const type = String.fromCharCode(
    view.getUint8(4),
    view.getUint8(5),
    view.getUint8(6),
    view.getUint8(7),
  );

  let size: number;
  let headerSize: 8 | 16 = 8;
  if (size32 === 1) {
    if (bytes.byteLength < 16) {
      throw new Error("The extended MP4 box header is incomplete.");
    }
    const size64 = view.getBigUint64(8);
    if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("The MP4 box is too large for browser addressing.");
    }
    size = Number(size64);
    headerSize = 16;
  } else if (size32 === 0) {
    size = fileSize - absoluteStart;
  } else {
    size = size32;
  }

  if (size < headerSize || absoluteStart + size > fileSize) {
    throw new Error(`Invalid ${type || "unknown"} MP4 box size.`);
  }

  return {
    type,
    start: absoluteStart,
    size,
    headerSize,
    endExclusive: absoluteStart + size,
  };
}

