"use client";

import { useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { AlertTriangle } from "lucide-react";

/**
 * Soft trigger that nudges heavy customers toward the Enterprise PAYG
 * tier when their flat-tier usage approaches the cap. Two checks fire
 * the banner:
 *
 *   • Storage > 80% of included tier limit
 *   • Encoded minutes > 80% of included tier minutes
 *
 * The PAYG tier already exists (TIERS.enterprise + the usageMeters
 * cron). This banner just makes it discoverable — most heavy
 * customers either cap out their flat tier silently or buy two flat
 * subscriptions before they realize PAYG exists.
 *
 * Renders nothing for free-tier workspaces (the storage progress bar
 * already nudges them to upgrade to Basic), for unauthenticated
 * callers, and for users already on Enterprise.
 */
export function EnterpriseUpsellBanner() {
  const storage = useQuery(api.workspaceBilling.getMyStorageUsage, {});
  const encoding = useQuery(api.workspaceBilling.getMyEncodingUsage, {});

  // Loading or signed-out → render nothing. Free-tier upgrade is
  // handled by the storage bar itself; we only want the Enterprise
  // nudge for already-paying customers approaching their cap.
  if (!storage || !encoding) return null;
  if (storage.plan === "free" || storage.plan === "enterprise") return null;

  const storageHot = storage.percent >= 80;
  const minutesHot =
    encoding.minutesIncluded > 0 &&
    encoding.minutesUsed >= encoding.minutesIncluded * 0.8;

  if (!storageHot && !minutesHot) return null;

  const reason = storageHot
    ? `You're at ${storage.percent}% of your ${storage.label} storage (${formatBytes(storage.usedBytes)} / ${formatBytes(storage.limitBytes)}).`
    : `You've encoded ${Math.round(encoding.minutesUsed)} of ${encoding.minutesIncluded} included minutes this period — overage at $${(encoding.overageRateCents / 100).toFixed(2)}/min kicks in next.`;

  return (
    <div className="border-2 border-[#b45309] bg-[#FDBA74]/30 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 text-[#b45309] flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-black text-sm uppercase tracking-tight text-[#1a1a1a]">
          You may save money on Enterprise PAYG
        </div>
        <p className="text-sm text-[#1a1a1a] mt-1 max-w-prose">
          {reason} Enterprise bills only what you actually use — storage
          by GB-month, encoding by minute, seats by month — and is
          usually cheaper than a flat tier once you're consistently near
          the cap.
        </p>
        <Link
          to="/dashboard/billing"
          search={{ show: "enterprise" } as never}
          className="inline-block mt-2 text-sm font-bold text-[#1a1a1a] underline hover:text-[#C2410C]"
        >
          See Enterprise pricing →
        </Link>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const GB = 1024 ** 3;
  const TB = GB * 1024;
  if (bytes >= TB) return `${(bytes / TB).toFixed(2)} TB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}
