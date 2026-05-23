"use client";

import { cn, formatBytes, formatDuration, formatRelativeTime } from "@/lib/utils";

/**
 * Read-only metadata panel for the focused share item — the "Info" tab next to
 * Comments. Sourced from the share summary (videos table fields).
 */

export interface ShareItemMeta {
  title: string;
  contentType: string | null;
  hasMuxPlayback: boolean | null;
  workflowStatus: "review" | "rework" | "done";
  uploaderName: string;
  createdAt: number;
  duration: number | null;
  fileSize: number | null;
  versionNumber: number | null;
  versionLabel: string | null;
}

const STATUS_META: Record<
  ShareItemMeta["workflowStatus"],
  { label: string; className: string }
> = {
  review: { label: "Needs Review", className: "bg-[#FFEDD5] text-[#C2410C]" },
  rework: { label: "Rework", className: "bg-[#fde2e2] text-[#dc2626]" },
  done: { label: "Done", className: "bg-[#dcfce7] text-[#15803d]" },
};

function typeLabel(meta: ShareItemMeta): string {
  if (meta.contentType?.startsWith("image/")) return "Image";
  if (meta.contentType?.startsWith("video/") || meta.hasMuxPlayback) return "Video";
  if (meta.contentType?.startsWith("audio/")) return "Audio";
  if (meta.contentType === "application/pdf") return "PDF";
  return meta.contentType ?? "File";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-xs font-bold uppercase tracking-widest text-[#888]">
        {label}
      </dt>
      <dd className="text-right text-sm text-[#1a1a1a] min-w-0 break-words">
        {value}
      </dd>
    </div>
  );
}

export function ShareItemMetadata({ meta }: { meta: ShareItemMeta | null }) {
  if (!meta) {
    return (
      <p className="text-sm text-[#888]">
        Open an item to see its details.
      </p>
    );
  }

  const status = STATUS_META[meta.workflowStatus];
  const versionDisplay =
    meta.versionLabel ??
    (meta.versionNumber ? `v${meta.versionNumber}` : null);

  return (
    <dl className="divide-y-2 divide-[#1a1a1a] border-2 border-[#1a1a1a] bg-[#f0f0e8] px-3">
      <Row label="Name" value={<span className="font-bold">{meta.title}</span>} />
      <Row label="Type" value={<span className="font-mono">{typeLabel(meta)}</span>} />
      <Row
        label="Status"
        value={
          <span
            className={cn(
              "inline-block px-1.5 py-0.5 text-[10px] font-bold",
              status.className,
            )}
          >
            {status.label}
          </span>
        }
      />
      {versionDisplay ? (
        <Row label="Version" value={<span className="font-mono">{versionDisplay}</span>} />
      ) : null}
      {meta.duration ? (
        <Row
          label="Duration"
          value={<span className="font-mono">{formatDuration(meta.duration)}</span>}
        />
      ) : null}
      <Row
        label="Size"
        value={
          <span className="font-mono">
            {meta.fileSize ? formatBytes(meta.fileSize) : "—"}
          </span>
        }
      />
      <Row label="Uploaded by" value={meta.uploaderName} />
      <Row
        label="Uploaded"
        value={
          <span className="font-mono">{formatRelativeTime(meta.createdAt)}</span>
        }
      />
    </dl>
  );
}
