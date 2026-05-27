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
      className="fixed z-[80] pointer-events-none border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[6px_6px_0px_0px_var(--shadow-color)] p-1"
      style={{ left, top }}
    >
      <img
        src={src}
        alt={alt}
        className="block object-contain"
        style={{ maxWidth: maxSize, maxHeight: maxSize }}
      />
    </div>
  );
}
