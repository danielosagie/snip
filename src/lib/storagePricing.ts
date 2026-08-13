/**
 * Storage pricing math, shared by the billing UI.
 *
 * Everything here is pure and runs client-side: the planner can quote a
 * price the instant the user drags the slider, with no Stripe round-trip.
 * Stripe is only involved when they commit and we open checkout.
 *
 * These stops are the ADVERTISED ladder from app/routes/-pricing.tsx. They do
 * NOT match what the server enforces (convex/billingHelpers.ts: 25 GB /
 * 500 GB / 2 TB) or what Stripe charges ($25 / $50). That is a live pricing
 * decision, not a bug to quietly resolve here — see the note in
 * billingHelpers.ts. Do not "fix" this file by deriving it from the server
 * without changing the Stripe prices in the same commit, or checkout will
 * refuse to open a session.
 */

export const GIBIBYTE = 1024 * 1024 * 1024;

export type StoragePlanKey = "free" | "basic" | "pro";

export type StorageStop = {
  plan: StoragePlanKey;
  label: string;
  gb: number;
  monthlyCents: number;
  /** Every advertised stop includes unlimited collaborators. */
  seatCap: number | null;
};

/** Ordered smallest to largest. Index doubles as the slider position. */
export const STORAGE_STOPS: readonly StorageStop[] = [
  { plan: "free", label: "Free", gb: 100, monthlyCents: 0, seatCap: null },
  { plan: "basic", label: "Studio", gb: 1024, monthlyCents: 4900, seatCap: null },
  { plan: "pro", label: "Scale", gb: 5120, monthlyCents: 14900, seatCap: null },
];

export function stopForPlan(plan: string): StorageStop | undefined {
  // Keep archived "studio" rows mapped to the stable Basic checkout key.
  const key = plan === "studio" ? "basic" : plan;
  return STORAGE_STOPS.find((s) => s.plan === key);
}

export function stopAtIndex(index: number): StorageStop {
  const clamped = Math.min(Math.max(index, 0), STORAGE_STOPS.length - 1);
  return STORAGE_STOPS[clamped];
}

export function indexOfPlan(plan: string): number {
  const stop = stopForPlan(plan);
  return stop ? STORAGE_STOPS.indexOf(stop) : 0;
}

/**
 * Cheapest stop that holds `gb`. Returns null when the number is past the
 * largest stop: the caller should route that to "contact us" rather than
 * silently clamping someone down to a plan that can't hold their files.
 */
export function smallestStopFor(gb: number): StorageStop | null {
  if (!Number.isFinite(gb) || gb < 0) return STORAGE_STOPS[0];
  return STORAGE_STOPS.find((s) => s.gb >= gb) ?? null;
}

/** True when moving to `target` would leave existing files homeless. */
export function wouldOverflow(target: StorageStop, usedBytes: number): boolean {
  return usedBytes > target.gb * GIBIBYTE;
}

export function formatStorage(gb: number): string {
  if (gb >= 1024) {
    const tb = gb / 1024;
    return `${Number.isInteger(tb) ? tb : tb.toFixed(1)} TB`;
  }
  return `${gb} GB`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 GB";
  const gb = bytes / GIBIBYTE;
  if (gb < 0.1) return "under 0.1 GB";
  if (gb < 1024) return `${gb.toFixed(1)} GB`;
  return `${(gb / 1024).toFixed(2)} TB`;
}

export function formatUsd(cents: number): string {
  if (cents === 0) return "$0";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * Effective price per GB at a stop, in cents. This is the number that
 * makes the ladder legible: bigger stops are cheaper per GB, and it lets
 * the UI show "you're paying for room you don't use" honestly.
 */
export function centsPerGb(stop: StorageStop): number {
  if (stop.gb === 0) return 0;
  return stop.monthlyCents / stop.gb;
}

export function formatCentsPerGb(stop: StorageStop): string {
  const c = centsPerGb(stop);
  if (c === 0) return "free";
  return `${c.toFixed(1)}¢ per GB`;
}

export type PlanChange = {
  direction: "upgrade" | "downgrade" | "same";
  deltaCents: number;
};

export function describeChange(
  from: StorageStop,
  to: StorageStop,
): PlanChange {
  const deltaCents = to.monthlyCents - from.monthlyCents;
  if (deltaCents === 0) return { direction: "same", deltaCents: 0 };
  return {
    direction: deltaCents > 0 ? "upgrade" : "downgrade",
    deltaCents,
  };
}
