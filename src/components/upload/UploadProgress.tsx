"use client";

import { memo } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  formatDuration,
  formatResolution,
  type LocalMediaMeta,
} from "@/lib/localMediaMeta";

export type UploadStatus =
  | "pending"
  | "uploading"
  | "paused"
  | "cancelling"
  | "processing"
  | "complete"
  | "error";

export function formatTransferTime(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

interface UploadProgressProps {
  fileName: string;
  fileSize: number;
  bytesUploaded: number;
  progress: number;
  status: UploadStatus;
  error?: string;
  bytesPerSecond?: number;
  estimatedSecondsRemaining?: number | null;
  resumable?: boolean;
  /** Local probe result. Undefined until the probe resolves. */
  meta?: LocalMediaMeta;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  pending: "Queued",
  uploading: "Uploading",
  paused: "Paused",
  cancelling: "Cancelling",
  processing: "Preparing",
  complete: "Complete",
  error: "Needs attention",
};

export const UploadProgress = memo(function UploadProgress({
  fileName,
  fileSize,
  bytesUploaded,
  progress,
  status,
  error,
  bytesPerSecond = 0,
  estimatedSecondsRemaining = null,
  resumable = false,
  meta,
  onCancel,
  onPause,
  onResume,
  onRetry,
  onDismiss,
}: UploadProgressProps) {
  const isTransferring = status === "uploading" || status === "pending";
  const time = formatTransferTime(estimatedSecondsRemaining);
  const detail =
    status === "uploading"
      ? `${formatBytes(Math.min(bytesUploaded, fileSize))} of ${formatBytes(fileSize)}`
      : status === "processing"
        ? "Upload finished, preparing file"
        : status === "paused"
          ? `${formatBytes(Math.min(bytesUploaded, fileSize))} uploaded`
          : status === "error"
            ? error ?? "Transfer interrupted"
            : status === "complete"
              ? formatBytes(fileSize)
              : STATUS_LABEL[status];

  // Size always; duration and resolution only once the probe found them, so
  // the line never shows a placeholder for something we could not read.
  const mediaLine = [
    formatBytes(fileSize),
    formatDuration(meta?.durationSec),
    formatResolution(meta?.width, meta?.height),
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <li className="group px-3 py-2.5 bg-[var(--surface)]" aria-label={`${fileName}: ${STATUS_LABEL[status]}`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden bg-[var(--surface-alt)] text-[var(--foreground-muted)]">
          {/* The poster is the fastest way to confirm you grabbed the right
              take, so it outranks the status glyph once we have one. State
              still reads from the percentage and the label to its right. */}
          {meta?.posterUrl ? (
            <img src={meta.posterUrl} alt="" className="h-full w-full object-cover" />
          ) : status === "complete" ? (
            <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
          ) : status === "error" ? (
            <AlertCircle className="h-4 w-4 text-[var(--destructive)]" />
          ) : status === "paused" ? (
            <Pause className="h-4 w-4 text-[var(--warning)]" />
          ) : (
            <Loader2 className={cn("h-4 w-4 text-[var(--accent)]", status !== "pending" && "animate-spin motion-reduce:animate-none")} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <p className="truncate text-sm font-semibold text-[var(--foreground)]">{fileName}</p>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--foreground-muted)]">
              {status === "uploading" ? `${progress}%` : STATUS_LABEL[status]}
            </span>
          </div>
          {mediaLine ? (
            <p className="mt-0.5 truncate font-mono text-[10px] tabular-nums text-[var(--foreground-subtle)]">
              {mediaLine}
            </p>
          ) : null}
          <div className="mt-0.5 flex min-w-0 items-center justify-between gap-3 font-mono text-[10px] tabular-nums text-[var(--foreground-muted)]">
            <span className={cn("truncate", status === "error" && "text-[var(--destructive)]")}>{detail}</span>
            {status === "uploading" ? (
              <span className="shrink-0">
                {bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : "Starting"}
                {time ? ` · ${time} left` : ""}
              </span>
            ) : null}
          </div>
          {isTransferring || status === "paused" ? (
            <Progress
              value={status === "pending" ? 0 : progress}
              className="mt-2 h-1.5"
              aria-label={`${progress}% uploaded`}
            />
          ) : null}
        </div>

        <div className="flex shrink-0 items-center">
          {status === "uploading" && resumable && onPause ? (
            <TransferButton label="Pause this upload" onClick={onPause}>
              <Pause className="h-4 w-4" />
            </TransferButton>
          ) : null}
          {status === "paused" && onResume ? (
            <TransferButton label="Resume this upload" onClick={onResume}>
              <Play className="h-4 w-4" />
            </TransferButton>
          ) : null}
          {status === "error" && onRetry ? (
            <TransferButton label="Retry this upload" onClick={onRetry}>
              <RotateCcw className="h-4 w-4" />
            </TransferButton>
          ) : null}
          {(status === "pending" || status === "uploading" || status === "paused") && onCancel ? (
            <TransferButton label="Cancel only this upload" onClick={onCancel} destructive>
              <X className="h-4 w-4" />
            </TransferButton>
          ) : null}
          {(status === "complete" || status === "error") && onDismiss ? (
            <TransferButton label="Dismiss transfer" onClick={onDismiss}>
              <X className="h-4 w-4" />
            </TransferButton>
          ) : null}
        </div>
      </div>
    </li>
  );
});

function TransferButton({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid h-10 w-10 place-items-center text-[var(--foreground-muted)] transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]",
        destructive
          ? "hover:bg-[var(--destructive-subtle)] hover:text-[var(--destructive)]"
          : "hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]",
      )}
    >
      {children}
    </button>
  );
}
