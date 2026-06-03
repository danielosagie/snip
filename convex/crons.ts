import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Daily enterprise PAYG roll-up. Posts the current period's storage,
 * egress, seat, and transcription deltas to Stripe's Meter Events API.
 * Idempotent via deterministic identifiers — re-runs are no-ops on the
 * Stripe side.
 *
 * 03:00 UTC because most production traffic on snip is North-American
 * waking hours; off-peak puts the API load when retries are cheap.
 */
crons.daily(
  "report enterprise usage to stripe",
  { hourUTC: 3, minuteUTC: 0 },
  internal.usageMetersActions.runDailyReport,
  {},
);

/**
 * Daily cold-eviction sweep. Reclaims the encoded ladder (Mux/Stream +
 * mirrored R2 proxies) for videos that haven't been watched within
 * RETENTION_HOT_DAYS, leaving the source in place for lazy re-encode on
 * the next watch. No-op on deployments where eviction is disabled
 * (single-tenant / demo — see `retention.isEvictionEnabled`).
 *
 * 04:00 UTC — after the usage roll-up so a video isn't evicted in the
 * same hour its final storage delta is metered.
 */
crons.daily(
  "evict cold video renditions",
  { hourUTC: 4, minuteUTC: 0 },
  internal.retentionActions.runColdEviction,
  {},
);

export default crons;
