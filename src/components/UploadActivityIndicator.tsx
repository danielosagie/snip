import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";

/**
 * Global, always-mounted upload indicator for the dashboard. Shows a brutalist
 * pill while the signed-in user has uploads in flight — most importantly DRIVE
 * drops, which otherwise produce no app-side feedback (the file lands in Finder
 * via the FUSE cache, but the upload to R2 is async through the WebDAV server).
 *
 * Two signals, merged by filename:
 *   • NATIVE (desktop only) — rclone's VFS upload queue, pushed over
 *     window.api.drive.onActivity. Fires the INSTANT a drop is queued, before
 *     the byte transfer (and thus the Convex row) exists. Gives sub-second feel.
 *   • CONVEX (everywhere) — videos.listMyActiveUploads, reactive. Confirms the
 *     upload and tracks it through Mux ingest until status flips to "ready".
 *
 * On the web (or desktop builds without the drive bridge) the native signal is
 * simply absent and the Convex query drives the pill on its own.
 */
const STALE_MS = 24 * 60 * 60 * 1000;

type DriveBridge = {
  drive?: {
    onActivity?: (
      cb: (p: { uploading?: Array<{ name?: string }> }) => void,
    ) => () => void;
  };
};

export function UploadActivityIndicator() {
  const active = useQuery(api.videos.listMyActiveUploads);
  const [nativeNames, setNativeNames] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bridge = (window as unknown as { api?: DriveBridge }).api;
    if (!bridge?.drive?.onActivity) return;
    return bridge.drive.onActivity((p) => {
      const names = Array.isArray(p?.uploading)
        ? p.uploading.map((u) => u?.name).filter((n): n is string => Boolean(n))
        : [];
      setNativeNames(names);
    });
  }, []);

  const now = Date.now();
  const convexNames = (active ?? [])
    .filter((u) => now - u.createdAt < STALE_MS)
    .map((u) => u.title);

  // Union by filename: native gives the instant signal, Convex confirms + holds
  // it through processing, so each file shows exactly once across both sources.
  const names = Array.from(new Set([...nativeNames, ...convexNames]));
  if (names.length === 0) return null;

  const count = names.length;
  const shown = names.slice(0, 2);
  const more = count - shown.length;

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
            {shown.join(", ")}
            {more > 0 ? ` +${more} more` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
