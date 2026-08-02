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
 * Recently Deleted is a 30-day recovery window, not permanent storage.
 * Purge source objects, provider assets, previews, and database rows daily.
 */
crons.daily(
  "purge expired recently deleted items",
  { hourUTC: 4, minuteUTC: 0 },
  internal.retentionActions.purgeExpiredTrash,
  {},
);

crons.daily(
  "purge unused watermarked preview assets",
  { hourUTC: 5, minuteUTC: 0 },
  internal.retentionActions.purgeUnusedPreviewAssets,
  {},
);

export default crons;
