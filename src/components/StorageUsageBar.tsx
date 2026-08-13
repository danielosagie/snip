"use client";

import { useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { cn } from "@/lib/utils";

/**
 * Storage usage progress bar. Two visual modes:
 *
 *   • `compact` — fits in the sidebar above the Billing & usage link.
 *     Slim bar, single-line numeric readout, no upgrade CTA unless
 *     the user is close to the cap.
 *   • `full` — for the Billing & usage page card. Larger bar, plan
 *     label, percentage, and always-visible upgrade CTA on free.
 *
 * Reads `api.workspaceBilling.getMyStorageUsage`. Renders nothing
 * for unauthenticated callers or users with no team membership.
 */
export function StorageUsageBar({
  variant = "compact",
}: {
  variant?: "compact" | "full";
}) {
  const usage = useQuery(api.workspaceBilling.getMyStorageUsage, {});

  // Loading or signed-out / no-team → take no space in either layout.
  if (usage === undefined || usage === null) return null;

  const isFree = usage.plan === "free";
  const nearCap = usage.percent >= 80;
  const overCap = usage.percent >= 100;

  const fillColor = overCap
    ? "bg-[#D8434F]"
    : nearCap
      ? "bg-[#D39329]"
      : "bg-[#FF6600]";

  const compactFillColor = overCap
    ? "bg-[#D8434F]"
    : nearCap
      ? "bg-[#D39329]"
      : "bg-[#FF6600]";

  if (variant === "compact") {
    return (
      <div className="px-2.5 pb-2 pt-1">
        <div className="flex items-center justify-between gap-2 text-[13px] leading-[18px] text-[#6E6E73]">
          <span>Storage</span>
          <span className="truncate text-[#131315]">
            {formatBytes(usage.usedBytes)} / {formatBytes(usage.limitBytes)}
          </span>
        </div>
        <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#F1F1F3]">
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              compactFillColor,
            )}
            style={{ width: `${Math.min(100, usage.percent)}%` }}
          />
        </div>
        {(isFree && nearCap) || overCap ? (
          <Link
            to="/dashboard/billing"
            className="mt-1 block text-xs font-medium text-[#D14E00] hover:underline"
          >
            {overCap ? "Storage full, upgrade" : "Nearly full, upgrade"}
          </Link>
        ) : null}
      </div>
    );
  }

  // Full variant — billing page card.
  return (
    // No outer margin: this renders both as a billing-page card and inside
    // the Adjust plan dialog, and a baked-in mt-10 put ~40px of dead space
    // under the dialog header. Callers space it.
    <section className="rounded-[14px] border border-[#E8E8EC] bg-white px-6 py-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold tracking-tight text-[#131315]">
          Storage usage
        </h2>
        <span className="rounded-full bg-[#F1F1F3] px-2.5 py-1 text-xs font-medium text-[#6E6E73]">
          {usage.label} plan
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-[#F1F1F3]">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", fillColor)}
          style={{ width: `${Math.min(100, usage.percent)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-[#6E6E73]">
        <span>
          {formatBytes(usage.usedBytes)} of {formatBytes(usage.limitBytes)} used
        </span>
        <span className={cn(overCap || nearCap ? "text-[#74521D]" : "")}>
          {usage.percent}%
        </span>
      </div>

      {/* Active / archived split — the retention model in one line. */}
      <dl className="mt-4 grid grid-cols-3 overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-[#F1F1F3] text-center">
        <Stat label="Active" value={formatBytes(usage.hotBytes)} hint="instant playback" />
        <Stat
          label="Archived"
          value={formatBytes(usage.coldBytes)}
          hint="re-encodes on watch"
        />
        <Stat
          label="On drive"
          value={formatBytes(usage.driveBytes)}
          hint="managed source"
        />
      </dl>
      <p className="mt-2 max-w-prose text-[11px] leading-snug text-[#6E6E73]">
        Clips you haven&apos;t watched in 30 days are archived to cut storage
        cost. The source stays put and the player rebuilds full quality on the
        next watch. <span>All Snip-managed source files count toward your storage capacity.</span>
      </p>

      {isFree ? (
        <p className="mt-3 max-w-prose text-xs text-[#6E6E73]">
          Free workspaces get 25 GB. Upgrade to Basic or Pro for more
          space and unlimited collaborators.
        </p>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-[#FAFAFA] px-2 py-3 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-[#F1F1F3]">
      <dt className="text-xs text-[#6E6E73]">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-[#131315]">{value}</dd>
      <dd className="text-[10px] text-[#A0A0A5]">{hint}</dd>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  const TB = GB * 1024;
  if (bytes >= TB) return `${(bytes / TB).toFixed(2)} TB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${bytes} B`;
}
