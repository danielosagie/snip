/**
 * Central feature-flag detection based on which env vars are present.
 * Every new integration (Stripe Connect, R2, Mux signed, watermark, etc.)
 * should gate behind one of these so the app boots without keys and shows
 * "configure X" prompts in the UI instead of crashing.
 *
 * Lives in the Convex node runtime — readable from any action or HTTP route.
 * Do NOT import from this file inside queries/mutations that run in the
 * Convex V8 isolate; instead use `getFeatureStatus` query below which
 * already adapts the runtime check.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";

function has(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function hasAny(...names: string[]): boolean {
  return names.some(has);
}

function hasAll(...names: string[]): boolean {
  return names.every(has);
}

export const FEATURES = {
  /** SaaS billing — Stripe customer/subscription for team plans. */
  stripeBilling: () => has("STRIPE_SECRET_KEY"),

  /** Stripe Connect for agency → client payments. Reuses STRIPE_SECRET_KEY. */
  stripeConnect: () => has("STRIPE_SECRET_KEY"),

  /** Stripe webhooks signed (Connect events). */
  stripeWebhooks: () => has("STRIPE_WEBHOOK_SECRET"),

  /** Mux ingest + playback (existing). */
  muxIngest: () => hasAll("MUX_TOKEN_ID", "MUX_TOKEN_SECRET"),

  /** Mux JWT-signed playback (new for paywalled streams). */
  muxSignedPlayback: () =>
    hasAll("MUX_TOKEN_ID", "MUX_TOKEN_SECRET") &&
    (hasAny("MUX_SIGNING_KEY", "MUX_SIGNING_KEY_ID")) &&
    (hasAny("MUX_PRIVATE_KEY", "MUX_SIGNING_PRIVATE_KEY")),

  /** Mux webhook signature verification. */
  muxWebhooks: () => has("MUX_WEBHOOK_SECRET"),

  /** S3-compatible object storage — either Railway or R2 creds. */
  objectStorage: () =>
    hasAll("RAILWAY_ACCESS_KEY_ID", "RAILWAY_SECRET_ACCESS_KEY") ||
    hasAll("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"),

  /** Whether we'll use R2 (preferred) or Railway. */
  usingR2: () => hasAll("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"),

  /** Watermark generation — needs sharp at runtime. We assume installed; the
   * real gate is that we have signed playback (no point watermarking if you
   * can't gate downloads). */
  watermarkPipeline: () =>
    hasAll("MUX_TOKEN_ID", "MUX_TOKEN_SECRET") &&
    (hasAll("RAILWAY_ACCESS_KEY_ID", "RAILWAY_SECRET_ACCESS_KEY") ||
      hasAll("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")),
} as const;

export type FeatureKey = keyof typeof FEATURES;

export function isFeatureEnabled(key: FeatureKey): boolean {
  return FEATURES[key]();
}

export function requireFeature(key: FeatureKey, friendlyName: string): void {
  if (!isFeatureEnabled(key)) {
    throw new Error(
      `${friendlyName} is not configured on this deployment. See docs/setup.md for the required env vars.`,
    );
  }
}

/**
 * Public query so the frontend can ask "which features are live?" and render
 * appropriate disabled/configure states. Returns booleans only — never expose
 * the actual env var values, even names, beyond what's already documented.
 */
export const getFeatureStatus = query({
  args: {},
  returns: v.object({
    stripeBilling: v.boolean(),
    stripeConnect: v.boolean(),
    stripeWebhooks: v.boolean(),
    muxIngest: v.boolean(),
    muxSignedPlayback: v.boolean(),
    muxWebhooks: v.boolean(),
    objectStorage: v.boolean(),
    usingR2: v.boolean(),
    watermarkPipeline: v.boolean(),
    paywallReady: v.boolean(),
    desktopSyncReady: v.boolean(),
  }),
  handler: async () => {
    const stripeBilling = FEATURES.stripeBilling();
    const stripeConnect = FEATURES.stripeConnect();
    const stripeWebhooks = FEATURES.stripeWebhooks();
    const muxIngest = FEATURES.muxIngest();
    const muxSignedPlayback = FEATURES.muxSignedPlayback();
    const muxWebhooks = FEATURES.muxWebhooks();
    const objectStorage = FEATURES.objectStorage();
    const usingR2 = FEATURES.usingR2();
    const watermarkPipeline = FEATURES.watermarkPipeline();

    // "Paywall ready" = client can complete a payment AND we can gate the file.
    const paywallReady =
      stripeConnect && stripeWebhooks && muxSignedPlayback && watermarkPipeline;

    // "Desktop sync ready" = we have object storage to mirror to/from.
    const desktopSyncReady = objectStorage;

    return {
      stripeBilling,
      stripeConnect,
      stripeWebhooks,
      muxIngest,
      muxSignedPlayback,
      muxWebhooks,
      objectStorage,
      usingR2,
      watermarkPipeline,
      paywallReady,
      desktopSyncReady,
    };
  },
});
