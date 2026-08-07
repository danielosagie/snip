"use client";

import { useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { AlertTriangle } from "lucide-react";

/**
 * Soft trigger that nudges heavy customers toward the Enterprise PAYG
 * tier when their flat-tier storage usage approaches the cap. The
 * PAYG tier already exists (TIERS.enterprise + the usageMeters cron).
 * This banner just makes it discoverable — most heavy customers
 * either cap out their flat tier silently or buy two flat
 * subscriptions before they realize PAYG exists.
 *
 * Renders nothing for free-tier workspaces (the storage progress bar
 * already nudges them to upgrade to Basic), for unauthenticated
 * callers, and for users already on Enterprise.
 */
export function EnterpriseUpsellBanner() {
  const storage = useQuery(api.workspaceBilling.getMyStorageUsage, {});

  if (!storage) return null;
  if (storage.plan === "free" || storage.plan === "enterprise") return null;
  if (storage.percent < 80) return null;

  return (
    <div className="flex items-start gap-3 rounded-[14px] border border-[#E8E8EC] bg-[#FFF9EC] px-4 py-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#74521D]" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-[#131315]">
          Enterprise may cost less
        </div>
        <p className="mt-1 max-w-prose text-sm text-[#6E6E73]">
          You're at {storage.percent}% of your {storage.label} storage
          ({formatBytes(storage.usedBytes)} / {formatBytes(storage.limitBytes)}).
          Enterprise bills by usage for storage and seats.
        </p>
        <Link
          to="/dashboard/billing"
          search={{ show: "enterprise" } as never}
          className="mt-2 inline-flex rounded-full border border-[#D8D8DE] bg-white px-3 py-1.5 text-sm font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3]"
        >
          See pricing
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
