"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { UploadStatus } from "./UploadProgress";
import type { LocalMediaMeta } from "@/lib/localMediaMeta";
import { UploadProgress, formatTransferTime } from "./UploadProgress";
import { formatBytes } from "@/lib/utils";

interface QueueItem {
  id: string;
  file: File;
  progress: number;
  bytesUploaded: number;
  status: UploadStatus;
  error?: string;
  bytesPerSecond?: number;
  estimatedSecondsRemaining?: number | null;
  resumable: boolean;
  meta?: LocalMediaMeta;
}

interface Props {
  uploads: QueueItem[];
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}

const ACTIVE_STATUSES = new Set<UploadStatus>([
  "pending",
  "uploading",
  "paused",
  "cancelling",
  "processing",
]);

export function UploadQueuePanel({
  uploads,
  onCancel,
  onPause,
  onResume,
  onRetry,
  onDismiss,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const summary = useMemo(() => {
    let totalBytes = 0;
    let uploadedBytes = 0;
    let speed = 0;
    let active = 0;
    let errors = 0;
    for (const upload of uploads) {
      totalBytes += upload.file.size;
      uploadedBytes += Math.min(upload.bytesUploaded, upload.file.size);
      speed += upload.bytesPerSecond ?? 0;
      if (ACTIVE_STATUSES.has(upload.status)) active += 1;
      if (upload.status === "error") errors += 1;
    }
    const remaining = Math.max(0, totalBytes - uploadedBytes);
    return {
      active,
      errors,
      progress: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 100,
      speed,
      eta: speed > 0 ? Math.ceil(remaining / speed) : null,
    };
  }, [uploads]);

  const headline = summary.errors > 0
    ? `${summary.errors} ${summary.errors === 1 ? "transfer needs" : "transfers need"} attention`
    : summary.active > 0
      ? `Transferring ${summary.active} ${summary.active === 1 ? "item" : "items"}`
      : "Transfers complete";

  return (
    <section
      className="fixed bottom-4 left-4 right-4 z-50 overflow-hidden bg-[var(--surface)] shadow-[0_16px_50px_rgba(26,26,26,0.22),0_2px_8px_rgba(26,26,26,0.14)] sm:left-auto sm:w-[420px]"
      aria-label="File transfers"
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex min-h-12 w-full items-center gap-3 bg-[var(--surface-strong)] px-3 py-2 text-left text-[var(--foreground-inverse)] transition-[background-color,transform] duration-150 ease-out active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--ring)]"
        aria-expanded={!collapsed}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-semibold">{headline}</span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--foreground-subtle)]">
              {summary.progress}%
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] tabular-nums text-[var(--foreground-subtle)]">
            {summary.speed > 0 ? <span>{formatBytes(summary.speed)}/s</span> : null}
            {summary.eta ? <span>{formatTransferTime(summary.eta)} remaining</span> : null}
            {summary.speed === 0 && summary.active > 0 ? <span>Preparing queue</span> : null}
          </div>
        </div>
        {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {!collapsed ? (
        <ul className="max-h-[min(55vh,440px)] divide-y divide-[var(--border-subtle)] overflow-y-auto overscroll-contain [content-visibility:auto]">
          {uploads.map((upload) => (
            <UploadProgress
              key={upload.id}
              fileName={upload.file.name}
              fileSize={upload.file.size}
              meta={upload.meta}
              bytesUploaded={upload.bytesUploaded}
              progress={upload.progress}
              status={upload.status}
              error={upload.error}
              bytesPerSecond={upload.bytesPerSecond}
              estimatedSecondsRemaining={upload.estimatedSecondsRemaining}
              resumable={upload.resumable}
              onCancel={() => onCancel(upload.id)}
              onPause={() => onPause(upload.id)}
              onResume={() => onResume(upload.id)}
              onRetry={() => onRetry(upload.id)}
              onDismiss={() => onDismiss(upload.id)}
            />
          ))}
        </ul>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">{headline}</span>
    </section>
  );
}
