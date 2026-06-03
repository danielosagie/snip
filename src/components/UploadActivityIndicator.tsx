import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";

/**
 * Global, always-mounted upload indicator for the dashboard. Subscribes to the
 * signed-in user's in-flight uploads and shows a brutalist pill while any are
 * running — most importantly DRIVE drops, which otherwise produce no app-side
 * feedback (the file lands in Finder via the FUSE cache, but the upload to R2
 * happens asynchronously through the WebDAV server and only surfaced as a
 * per-video "Uploading…" inside the one project view).
 *
 * Reactive: rows appear as createUploadForDesktop/videos.create stamp status
 * "uploading", and drop off when Mux ingest flips them to "ready". We hide rows
 * older than 24h so a failed upload stuck in "uploading" can't pin the pill on.
 */
const STALE_MS = 24 * 60 * 60 * 1000;

export function UploadActivityIndicator() {
  const active = useQuery(api.videos.listMyActiveUploads);
  if (!active || active.length === 0) return null;

  const now = Date.now();
  const live = active.filter((u) => now - u.createdAt < STALE_MS);
  if (live.length === 0) return null;

  const count = live.length;
  const names = live.slice(0, 2).map((u) => u.title);
  const more = count - names.length;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 fade-in duration-200"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5 border-2 border-[#1a1a1a] bg-[#1a1a1a] px-3.5 py-2.5 text-[#f0f0e8] shadow-[4px_4px_0px_0px_#C2410C]">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#FDBA74]" />
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">
            Uploading {count} {count === 1 ? "file" : "files"}…
          </p>
          <p className="truncate font-mono text-[11px] leading-tight text-[#9a9a92]">
            {names.join(", ")}
            {more > 0 ? ` +${more} more` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
