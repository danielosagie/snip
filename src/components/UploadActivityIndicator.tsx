import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { HardDriveUpload, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { formatBytes } from "@/lib/utils";
import { formatTransferTime } from "@/components/upload/UploadProgress";

const STALE_MS = 24 * 60 * 60 * 1000;

interface DriveTransfer {
  name?: string;
  size?: number | null;
  bytes?: number;
  percentage?: number;
  speed?: number;
  eta?: number | null;
  status?: "queued" | "uploading";
}

type DriveBridge = {
  drive?: {
    onActivity?: (cb: (payload: { uploading?: DriveTransfer[] }) => void) => () => void;
  };
};

export function UploadActivityIndicator() {
  const active = useQuery(api.videos.listMyActiveUploads);
  const [nativeTransfers, setNativeTransfers] = useState<DriveTransfer[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bridge = (window as unknown as { api?: DriveBridge }).api;
    if (!bridge?.drive?.onActivity) return;
    return bridge.drive.onActivity((payload) => {
      setNativeTransfers(Array.isArray(payload?.uploading) ? payload.uploading : []);
    });
  }, []);

  const convexNames = useMemo(() => {
    const now = Date.now();
    const nativeNames = new Set(nativeTransfers.map((item) => item.name).filter(Boolean));
    return (active ?? [])
      .filter((upload) => now - upload.createdAt < STALE_MS && !nativeNames.has(upload.title))
      .map((upload) => upload.title);
  }, [active, nativeTransfers]);

  if (nativeTransfers.length === 0 && convexNames.length === 0) return null;

  const speed = nativeTransfers.reduce((total, item) => total + (item.speed ?? 0), 0);
  const eta = nativeTransfers.reduce<number | null>((longest, item) => {
    if (item.eta == null) return longest;
    return longest == null ? item.eta : Math.max(longest, item.eta);
  }, null);
  const total = nativeTransfers.length + convexNames.length;

  return (
    <section
      className="fixed right-4 top-10 z-40 w-[min(380px,calc(100vw-2rem))] overflow-hidden bg-[var(--surface)] shadow-[0_14px_42px_rgba(26,26,26,0.2),0_2px_8px_rgba(26,26,26,0.12)]"
      aria-label="Cloud drive activity"
    >
      <header className="flex min-h-12 items-center gap-3 bg-[var(--surface-strong)] px-3 py-2 text-[var(--foreground-inverse)]">
        <HardDriveUpload className="h-4 w-4 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Cloud drive · {total} active</p>
          <p className="font-mono text-[10px] tabular-nums text-[var(--foreground-subtle)]">
            {speed > 0 ? `${formatBytes(speed)}/s` : "Syncing with project folders"}
            {eta ? ` · ${formatTransferTime(eta)} remaining` : ""}
          </p>
        </div>
      </header>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {nativeTransfers.slice(0, 4).map((transfer, index) => {
          const percent = Math.round(transfer.percentage ?? 0);
          return (
            <li key={`${transfer.name ?? "transfer"}-${index}`} className="px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-xs font-semibold text-[var(--foreground)]">{transfer.name ?? "File"}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--foreground-muted)]">
                  {transfer.status === "queued" ? "Queued" : `${percent}%`}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden bg-[var(--surface-alt)]">
                <div
                  className="h-full bg-[var(--accent)] transition-[width] duration-150 ease-out motion-reduce:transition-none"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-1 font-mono text-[10px] tabular-nums text-[var(--foreground-muted)]">
                {typeof transfer.bytes === "number" ? formatBytes(transfer.bytes) : "0 B"}
                {typeof transfer.size === "number" ? ` of ${formatBytes(transfer.size)}` : ""}
                {(transfer.speed ?? 0) > 0 ? ` · ${formatBytes(transfer.speed ?? 0)}/s` : ""}
              </p>
            </li>
          );
        })}
        {convexNames.slice(0, Math.max(0, 4 - nativeTransfers.length)).map((name) => (
          <li key={name} className="flex items-center gap-2 px-3 py-2.5 text-xs text-[var(--foreground-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)] motion-reduce:animate-none" />
            <span className="truncate">Preparing {name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
