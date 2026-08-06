import { Id } from "@convex/_generated/dataModel";

export const SNIP_VIDEO_DRAG_TYPE = "application/x-snip-video";
export const SNIP_VIDEOS_DRAG_TYPE = "application/x-snip-videos";

export function readDraggedVideoIds(
  dataTransfer: DataTransfer,
): Id<"videos">[] {
  const multiPayload = dataTransfer.getData(SNIP_VIDEOS_DRAG_TYPE);
  if (multiPayload) {
    try {
      const parsed: unknown = JSON.parse(multiPayload);
      if (Array.isArray(parsed)) {
        const ids = parsed.filter(
          (value): value is Id<"videos"> =>
            typeof value === "string" && value.length > 0,
        );
        if (ids.length > 0) return Array.from(new Set(ids));
      }
    } catch {
      // Fall through to the single-item payload for backward compatibility.
    }
  }

  const videoId = dataTransfer.getData(SNIP_VIDEO_DRAG_TYPE);
  return videoId ? [videoId as Id<"videos">] : [];
}

export function setDraggedVideoData(
  dataTransfer: DataTransfer,
  grabbedVideoId: Id<"videos">,
  draggedVideoIds: readonly Id<"videos">[],
) {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(SNIP_VIDEO_DRAG_TYPE, grabbedVideoId);

  if (draggedVideoIds.length <= 1) return;

  dataTransfer.setData(SNIP_VIDEOS_DRAG_TYPE, JSON.stringify(draggedVideoIds));
  if (typeof document === "undefined") return;

  const dragImage = document.createElement("div");
  dragImage.setAttribute("aria-hidden", "true");
  Object.assign(dragImage.style, {
    position: "fixed",
    top: "-1000px",
    left: "0",
    width: "104px",
    height: "68px",
    pointerEvents: "none",
  });

  const backCard = document.createElement("div");
  Object.assign(backCard.style, {
    position: "absolute",
    top: "7px",
    left: "7px",
    width: "96px",
    height: "56px",
    border: "1px solid #E8E8EC",
    borderRadius: "10px",
    background: "#FFFFFF",
  });

  const frontCard = document.createElement("div");
  Object.assign(frontCard.style, {
    position: "absolute",
    top: "0",
    left: "0",
    width: "96px",
    height: "56px",
    border: "1px solid #E8E8EC",
    borderRadius: "10px",
    background: "#FFFFFF",
    boxShadow: "0 4px 12px rgba(19, 19, 21, 0.10)",
  });

  const countPill = document.createElement("div");
  countPill.textContent = String(draggedVideoIds.length);
  Object.assign(countPill.style, {
    position: "absolute",
    top: "-7px",
    right: "-3px",
    display: "flex",
    minWidth: "24px",
    height: "24px",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 7px",
    borderRadius: "9999px",
    background: "#131315",
    color: "#FFFFFF",
    fontFamily: "'Inter Tight', system-ui, sans-serif",
    fontSize: "12px",
    fontWeight: "500",
    lineHeight: "24px",
  });

  dragImage.append(backCard, frontCard, countPill);
  document.body.appendChild(dragImage);
  dataTransfer.setDragImage(dragImage, 20, 20);
  setTimeout(() => dragImage.remove(), 0);
}
