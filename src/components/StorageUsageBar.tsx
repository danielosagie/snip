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
    ? "bg-[#b91c1c]"
    : nearCap
      ? "bg-[#b45309]"
      : "bg-[#C2410C]";

  if (variant === "compact") {
    return (
      <div className="px-2 pb-2 pt-1">
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-[#666]">
          <span>Storage</span>
          <span className="text-[#1a1a1a]">
            {formatBytes(usage.usedBytes)} / {formatBytes(usage.limitBytes)}
          </span>
        </div>
        <div className="mt-1 h-1.5 border border-[#1a1a1a] bg-[#f0f0e8] relative">
          <div
            className={cn("absolute inset-y-0 left-0", fillColor)}
            style={{ width: `${Math.min(100, usage.percent)}%` }}
          />
        </div>
        {(isFree && nearCap) || overCap ? (
          <Link
            to="/dashboard/billing"
            className="mt-1 block text-[10px] font-mono font-bold uppercase tracking-wider text-[#C2410C] hover:underline"
          >
            {overCap ? "Storage full · upgrade" : "Nearly full · upgrade"}
          </Link>
        ) : null}
      </div>
    );
  }

  // Full variant — billing page card.
  return (
    <section className="mt-10 border-2 border-[#1a1a1a] p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-black text-sm uppercase tracking-tight">
          Storage usage
        </h2>
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
          {usage.label} plan
        </span>
      </div>
      <div className="h-3 border-2 border-[#1a1a1a] bg-[#f0f0e8] relative">
        <div
          className={cn("absolute inset-y-0 left-0", fillColor)}
          style={{ width: `${Math.min(100, usage.percent)}%` }}
        />
      </div>
      <div className="mt-2 text-xs font-mono text-[#666] flex items-center justify-between">
        <span>
          {formatBytes(usage.usedBytes)} of {formatBytes(usage.limitBytes)} used
        </span>
        <span className={cn(overCap || nearCap ? "text-[#b45309]" : "")}>
          {usage.percent}%
        </span>
      </div>
      {isFree ? (
        <p className="text-xs text-[#666] mt-3 max-w-prose">
          Free workspaces get 20 GB. Upgrade to Basic or Pro for more
          space and bigger uploads.
        </p>
      ) : null}
    </section>
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
