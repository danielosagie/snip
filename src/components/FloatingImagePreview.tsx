"use client";

/**
 * Cursor-following floating image preview. Renders nothing when `pos`
 * is null. Used wherever a small thumbnail benefits from an enlarged
 * peek on hover — file tiles, file rows, video cards in the project
 * grid/list.
 *
 * Caller owns the hover state (so the parent decides what counts as
 * "hovered" — selection, drag, modifier-key behavior, etc.). This
 * component just paints.
 */
export function FloatingImagePreview({
  src,
  alt,
  pos,
  maxSize = 360,
}: {
  src: string | null | undefined;
  alt: string;
  pos: { x: number; y: number } | null;
  maxSize?: number;
}) {
  if (!pos || !src) return null;
  const padding = 18;
  // Keep the preview inside the viewport on the right / bottom edges.
  const left = Math.min(pos.x + padding, window.innerWidth - (maxSize + padding));
  const top = Math.min(pos.y + padding, window.innerHeight - (maxSize + padding));
  return (
    <div
      className="pointer-events-none fixed z-[80] rounded-[12px] border border-[#E8E8EC] bg-white p-1.5 shadow-[0_8px_24px_rgba(19,19,21,0.10)]"
      style={{ left, top }}
    >
      <img
        src={src}
        alt={alt}
        className="block rounded-[8px] object-contain"
        style={{ maxWidth: maxSize, maxHeight: maxSize }}
      />
    </div>
  );
}
