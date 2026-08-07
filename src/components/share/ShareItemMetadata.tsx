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
  review: { label: "Needs review", className: "bg-[#FFF0E6] text-[#D14E00]" },
  rework: { label: "Rework", className: "bg-[#FFF5F5] text-[#8A2B34]" },
  done: { label: "Done", className: "bg-[#F2FBF5] text-[#225B36]" },
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
      <dt className="font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-sm text-[#131315]">
        {value}
      </dd>
    </div>
  );
}

export function ShareItemMetadata({ meta }: { meta: ShareItemMeta | null }) {
  if (!meta) {
    return (
      <p className="text-sm text-[#6E6E73]">
        Open an item to see its details.
      </p>
    );
  }

  const status = STATUS_META[meta.workflowStatus];
  const versionDisplay =
    meta.versionLabel ??
    (meta.versionNumber ? `v${meta.versionNumber}` : null);

  return (
    <dl className="overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] px-3 divide-y divide-[#F1F1F3]">
      <Row label="Name" value={<span className="font-semibold">{meta.title}</span>} />
      <Row label="Type" value={typeLabel(meta)} />
      <Row
        label="Status"
        value={
          <span
            className={cn(
              "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
              status.className,
            )}
          >
            {status.label}
          </span>
        }
      />
      {versionDisplay ? (
        <Row label="Version" value={versionDisplay} />
      ) : null}
      {meta.duration ? (
        <Row
          label="Duration"
          value={formatDuration(meta.duration)}
        />
      ) : null}
      <Row
        label="Size"
        value={
          <span>
            {meta.fileSize ? formatBytes(meta.fileSize) : "Unknown"}
          </span>
        }
      />
      <Row label="Uploaded by" value={meta.uploaderName} />
      <Row
        label="Uploaded"
        value={
          <span>{formatRelativeTime(meta.createdAt)}</span>
        }
      />
    </dl>
  );
}
