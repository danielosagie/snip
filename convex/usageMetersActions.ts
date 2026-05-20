"use node";

import Stripe from "stripe";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Node-only side of enterprise PAYG: pushes the daily usage deltas
 * tallied in `usageMeters` to Stripe via the Meter Events API
 * (https://docs.stripe.com/api/billing/meter-event). The mutation that
 * records the report timestamp stays in usageMeters.ts so it can run
 * in the V8 isolate.
 *
 * Event identifiers are deterministic per (ownerClerkId, periodStart,
 * meter, dayBucket) so a retried cron run is a no-op on the Stripe
 * side instead of double-billing.
 */

// Standard event names the Stripe meter is configured against. The
// Stripe Meter object's `event_name` MUST match these strings; if you
// change them here, update the Stripe dashboard meters too.
const METER_EVENT_NAMES = {
  storage: "snip_storage_gb_months",
  egress: "snip_egress_gb",
  seats: "snip_seats",
  transcription: "snip_transcription_kmin",
} as const;

function getStripeOrThrow(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  return new Stripe(secret);
}

function dayBucket(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function postMeterEvent(
  stripe: Stripe,
  args: {
    eventName: string;
    customerId: string;
    value: number;
    identifier: string;
  },
) {
  if (args.value <= 0) return;
  // The Stripe SDK's TypeScript types for billing.meterEvents lag the
  // REST API; use the lower-level request helper.
  await stripe.v2.billing.meterEvents.create({
    event_name: args.eventName,
    payload: {
      stripe_customer_id: args.customerId,
      value: String(Math.round(args.value)),
    },
    identifier: args.identifier,
  });
}

/**
 * Daily cron entrypoint. Iterates every enterprise subscription, reads
 * its current usageMeters row, posts to Stripe, and stamps
 * `lastReportedAt` on success.
 */
export const runDailyReport = internalAction({
  args: {},
  handler: async (ctx) => {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) {
      console.warn("usageMetersActions: STRIPE_SECRET_KEY missing — skipping.");
      return;
    }
    const stripe = getStripeOrThrow();

    const subs = await ctx.runQuery(
      internal.usageMeters.listEnterpriseSubscriptions,
      {},
    );
    const bucket = dayBucket();

    for (const sub of subs) {
      if (!sub.stripeCustomerId) continue;

      // Snapshot storage + seats before reading the meter row so the
      // values we report to Stripe include today's data point.
      try {
        const storage = await ctx.runQuery(
          internal.usageMeters.sumStorageForOwner,
          { ownerClerkId: sub.ownerClerkId },
        );
        await ctx.runMutation(internal.usageMeters.snapshotStorageDelta, {
          workspaceOwnerClerkId: sub.ownerClerkId,
          bytesNow: storage.totalBytes,
        });
        const seats = await ctx.runQuery(
          internal.usageMeters.countSeatsForOwner,
          { ownerClerkId: sub.ownerClerkId },
        );
        await ctx.runMutation(internal.usageMeters.updateSeatCount, {
          workspaceOwnerClerkId: sub.ownerClerkId,
          seatCount: seats.seatCount,
        });
      } catch (err) {
        console.error("usageMeters: snapshot failed", {
          ownerClerkId: sub.ownerClerkId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const meter = await ctx.runQuery(
        internal.usageMeters.getOwnerMeterRow,
        { ownerClerkId: sub.ownerClerkId },
      );
      if (!meter) continue;

      try {
        await postMeterEvent(stripe, {
          eventName: METER_EVENT_NAMES.storage,
          customerId: sub.stripeCustomerId,
          value: meter.storageBytesGbMonths,
          identifier: `${sub.ownerClerkId}:${meter.periodStart}:storage:${bucket}`,
        });
        await postMeterEvent(stripe, {
          eventName: METER_EVENT_NAMES.egress,
          customerId: sub.stripeCustomerId,
          value: meter.egressBytesGb,
          identifier: `${sub.ownerClerkId}:${meter.periodStart}:egress:${bucket}`,
        });
        await postMeterEvent(stripe, {
          eventName: METER_EVENT_NAMES.seats,
          customerId: sub.stripeCustomerId,
          value: meter.seatCount,
          identifier: `${sub.ownerClerkId}:${meter.periodStart}:seats:${bucket}`,
        });
        await postMeterEvent(stripe, {
          eventName: METER_EVENT_NAMES.transcription,
          customerId: sub.stripeCustomerId,
          value: meter.transcribedMinutes / 1000,
          identifier: `${sub.ownerClerkId}:${meter.periodStart}:transcription:${bucket}`,
        });
        await ctx.runMutation(internal.usageMeters.markReportedToStripe, {
          rowId: meter._id,
        });
      } catch (err) {
        console.error("Stripe meter report failed", {
          ownerClerkId: sub.ownerClerkId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue with the next sub — don't let one bad customer
        // stop the whole batch. The local meter row is the source of
        // truth; tomorrow's run will re-report the same totals.
      }
    }
  },
});
