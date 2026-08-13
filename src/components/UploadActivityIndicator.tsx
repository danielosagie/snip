import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { formatBytes } from "@/lib/utils";
import { formatTransferTime } from "@/components/upload/UploadProgress";
import type { DesktopBackupRun, DesktopBackupState } from "@/desktop";

/**
 * The one place snip says "bytes are moving", wherever they came from:
 * drag-and-drop uploads, the mounted drive, and auto-backup all land here.
 *
 * Two things this fixes over the panel it replaces. It reports a TOTAL —
 * the old one showed per-file percentages and never said how much of the
 * whole job was done, which is the only number that matters when a backup
 * is 913 GB. And it does not strobe: the old one unmounted the instant zero
 * transfers were in flight, so a backup tore it down and rebuilt it between
 * every single file.
 */

const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Keep the pill up this long after the last byte lands.
 *
 * The gap between two files in a backup is one commit plus one createUpload
 * — comfortably under a second — and that gap is what made the old panel
 * flash. 2.5s bridges it with room to spare while still getting out of the
 * way promptly once the job is genuinely finished.
 */
const LINGER_MS = 2500;

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
  backup?: {
    state: () => Promise<DesktopBackupState>;
    onState: (handler: (state: DesktopBackupState) => void) => () => void;
  };
};

function isRunning(run: DesktopBackupRun) {
  return run.state === "scanning" || run.state === "uploading";
}

export function UploadActivityIndicator() {
  const active = useQuery(api.videos.listMyActiveUploads);
  const [nativeTransfers, setNativeTransfers] = useState<DriveTransfer[]>([]);
  const [backupRuns, setBackupRuns] = useState<DesktopBackupRun[]>([]);
  const [visible, setVisible] = useState(false);
  const lingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bridge = (window as unknown as { api?: DriveBridge }).api;
    if (!bridge?.drive?.onActivity) return;
    return bridge.drive.onActivity((payload) => {
      setNativeTransfers(Array.isArray(payload?.uploading) ? payload.uploading : []);
    });
  }, []);

  // Backup reports a real job total; Convex's active-upload rows only know
  // about the file currently in flight. Read both so the pill can say
  // "961 MB of 913 GB" instead of just naming a file.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const bridge = (window as unknown as { api?: DriveBridge }).api;
    if (!bridge?.backup) return;
    void bridge.backup
      .state()
      .then((s) => setBackupRuns(s.runs ?? []))
      .catch(() => {});
    return bridge.backup.onState((s) => setBackupRuns(s.runs ?? []));
  }, []);

  const runningBackups = useMemo(
    () => backupRuns.filter(isRunning),
    [backupRuns],
  );

  const convexNames = useMemo(() => {
    const now = Date.now();
    const nativeNames = new Set(nativeTransfers.map((item) => item.name).filter(Boolean));
    return (active ?? [])
      .filter((upload) => now - upload.createdAt < STALE_MS && !nativeNames.has(upload.title))
      .map((upload) => upload.title);
  }, [active, nativeTransfers]);

  const busy =
    nativeTransfers.length > 0 ||
    convexNames.length > 0 ||
    runningBackups.length > 0;

  // Show immediately, hide only after the linger. Without this the component
  // returned null the moment the queue emptied, which for a backup happens
  // between every file.
  useEffect(() => {
    if (busy) {
      if (lingerRef.current) clearTimeout(lingerRef.current);
      lingerRef.current = null;
      setVisible(true);
      return;
    }
    if (!visible || lingerRef.current) return;
    lingerRef.current = setTimeout(() => {
      lingerRef.current = null;
      setVisible(false);
    }, LINGER_MS);
  }, [busy, visible]);

  useEffect(
    () => () => {
      if (lingerRef.current) clearTimeout(lingerRef.current);
    },
    [],
  );

  if (!visible) return null;

  const backupDone = runningBackups.reduce((sum, run) => sum + run.bytesDone, 0);
  const backupTotal = runningBackups.reduce((sum, run) => sum + run.bytesTotal, 0);
  const driveDone = nativeTransfers.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  const driveTotal = nativeTransfers.reduce((sum, item) => sum + (item.size ?? 0), 0);
  const doneBytes = backupDone + driveDone;
  const totalBytes = backupTotal + driveTotal;

  const filesDone = runningBackups.reduce((sum, run) => sum + run.filesDone, 0);
  const filesTotal = runningBackups.reduce((sum, run) => sum + run.filesTotal, 0);

  const speed = nativeTransfers.reduce((total, item) => total + (item.speed ?? 0), 0);
  const eta = nativeTransfers.reduce<number | null>((longest, item) => {
    if (item.eta == null) return longest;
    return longest == null ? item.eta : Math.max(longest, item.eta);
  }, null);

  const percent =
    totalBytes > 0 ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : null;

  const scanning =
    runningBackups.length > 0 && runningBackups.every((run) => run.state === "scanning");

  const currentName =
    runningBackups.find((run) => run.currentFile)?.currentFile ??
    nativeTransfers[0]?.name ??
    convexNames[0] ??
    null;

  const title = !busy
    ? "Up to date"
    : scanning
      ? "Looking for changes"
      : runningBackups.length > 0
        ? filesTotal > 0
          ? `Backing up ${filesDone.toLocaleString()} of ${filesTotal.toLocaleString()}`
          : "Backing up"
        : `Uploading ${nativeTransfers.length + convexNames.length}`;

  // Totals first — that is the number the old panel never showed. The file
  // name is the least useful part and goes last, where it can truncate.
  const detail = [
    totalBytes > 0 ? `${formatBytes(doneBytes)} of ${formatBytes(totalBytes)}` : null,
    speed > 0 ? `${formatBytes(speed)}/s` : null,
    eta ? `${formatTransferTime(eta)} left` : null,
    currentName,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <section
      className="fixed right-4 top-10 z-40 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-[22px] border border-[#E8E8EC] bg-white shadow-[0_16px_38px_-8px_rgba(19,19,21,0.24),0_1px_3px_rgba(19,19,21,0.10)]"
      aria-label="Transfer activity"
    >
      <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#FF6600]">
          <div className="h-[9px] w-[9px] rounded-[2.5px] bg-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[#131315]">
            {title}
          </p>
          <p className="truncate text-[12.5px] leading-[17px] text-[#6E6E73]">
            {detail || "Preparing"}
          </p>
        </div>
        {percent !== null ? (
          <span className="shrink-0 font-mono text-[12px] tabular-nums text-[#A0A0A5]">
            {percent}%
          </span>
        ) : null}
      </div>
      <div className="h-[3px] w-full bg-[#F1F1F3]">
        <div
          className="h-full rounded-r-full bg-[#FF6600] transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {title}
      </span>
    </section>
  );
}
