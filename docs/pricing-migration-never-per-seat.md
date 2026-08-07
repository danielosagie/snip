# Migration scope: never per seat, storage tiers, export tripwire

## Status

The public pricing page currently advertises the new offer, but the billing
code still enforces the old offer. In particular, Convex still applies 25 GB
to Free, $25 and 500 GB to Basic, $50 and 2 TB to Pro, and a Free collaborator
cap. Stripe still resolves the old price objects. This gap is intentional for
the copy rollout, but it must close before launch. Do not point checkout at
the new page until every step below is complete and tested in Stripe test mode.

The advertised offer is:

| Plan | Monthly | Annual price | Included storage | Seats |
| --- | ---: | ---: | ---: | --- |
| Free | $0 | n/a | 100 GB | Unlimited |
| Studio | $49 | $41 a month billed yearly | 1 TB | Unlimited |
| Scale | $149 | $124 a month billed yearly | 5 TB | Unlimited |

The advertised overages are $25 per TB a month and $0.02 a minute after the
included export allowance. They need an explicit, tested billing design before
they become chargeable.

## Billing constants and symbols to change

These are the exact current constants and symbols that implement the old
offer. This document lists the future migration only. None are changed by the
pricing-page commit.

| File | Symbol | Required migration change |
| --- | --- | --- |
| `convex/workspaceBilling.ts` | `TIERS.free` | Set the new Free entitlement to 100 GiB and unlimited seats. The Free seat guard below must also change. |
| `convex/workspaceBilling.ts` | `TIERS.basic` | Keep the stable key if practical, change the displayed label to Studio, `baseCents` to 4900, `storageBytes` to 1 TiB, and the feature entitlement list to Studio. |
| `convex/workspaceBilling.ts` | `TIERS.pro` | Keep the stable key if practical, change the displayed label to Scale, `baseCents` to 14900, `storageBytes` to 5 TiB, and the feature entitlement list to Scale. |
| `convex/workspaceBilling.ts` | `assertCanAddWorkspaceSeat` | Remove the Free-only seat-cap branch for new-offer workspaces. Do not remove enforcement for grandfathered workspaces until they opt in. |
| `convex/workspaceBilling.ts` | `LEGACY_STORAGE_BYTES` | Preserve the legacy Basic 2 TiB and Pro 5 TiB values for grandfathered paid subscriptions. Rename or replace it with a versioned entitlement resolver so new Studio is 1 TiB while legacy Basic stays 2 TiB. |
| `convex/workspaceBilling.ts` | `simulateActivate` and `syncWorkspaceSubscriptionFromWebhook` | Snapshot the entitlement version, base amount, storage limit, and unlimited-seat setting when creating or reconciling a new-offer subscription. Existing snapshots must remain unchanged. |
| `convex/billingHelpers.ts` | `TEAM_PLAN_MONTHLY_PRICE_USD` | Change the new-offer values to 0, 49, and 149. Reads for a grandfathered workspace must resolve its stored snapshot, not this default map. |
| `convex/billingHelpers.ts` | `TEAM_PLAN_STORAGE_LIMIT_BYTES` | Change the new-offer values to 100 GiB, 1 TiB, and 5 TiB. Reads for grandfathered workspaces must resolve the stored legacy limit first. |
| `convex/billingHelpers.ts` | `LEGACY_WORKSPACE_STORAGE_LIMIT_BYTES` | Retain the existing Basic 2 TiB and Pro 5 TiB fallbacks only for the legacy entitlement version. |
| `convex/billingHelpers.ts` | `resolvePlanFromStripePriceId` and `getStripePriceIdForPlan` | Recognize both legacy and new Studio and Scale price IDs without remapping a legacy subscriber to the new entitlement. |
| `convex/workspaceBillingActions.ts` | `PRICE_ENV`, `V2_MONTHLY_PRICE_ENV`, and `createCheckout` | Add separate new-offer monthly and annual environment names, select them only for the new entitlement version, and validate the new amounts and intervals before opening Checkout. Do not rotate any legacy environment variable. |
| `convex/schema.ts` | `workspaceSubscriptions` | Add a required-after-backfill `entitlementVersion` field, such as `legacy` or `neverPerSeat`. Persist the resolved limits and prices already stored on the row. Add a durable legacy marker for free workspaces, because they have no subscription row. |
| `convex/billing.ts` | reads of `TEAM_PLAN_MONTHLY_PRICE_USD` and `TEAM_PLAN_STORAGE_LIMIT_BYTES` | Return the entitlement snapshot or versioned resolver result so legacy team billing screens do not suddenly show new limits. |

`convex/usageMeters.ts` does not currently meter exports. Do not alter it as
part of this copy rollout. A future export overage implementation needs its own
schema, idempotent event path, and Stripe meter integration before $0.02 per
minute is collected.

## Stripe objects to create

Create new objects. Never edit or archive a price attached to an existing
subscriber.

1. A Studio product with a recurring USD monthly price of $49.00.
2. A Studio product price for annual billing of $492.00 per year, which is
   $41 a month billed yearly.
3. A Scale product with a recurring USD monthly price of $149.00.
4. A Scale product price for annual billing of $1,488.00 per year, which is
   $124 a month billed yearly.
5. A metered storage overage price of $25.00 per TiB-month. Define and test
   the byte to TiB rounding rule before enabling it.
6. A metered export overage price of $0.02 per minute. Define completed versus
   failed renders, rounding, retries, and cache-hit behavior before enabling
   it.

Store the four base-price IDs in new, versioned Convex environment variables,
for example `STRIPE_PRICE_STUDIO_MONTHLY_V3`,
`STRIPE_PRICE_STUDIO_ANNUAL_V3`, `STRIPE_PRICE_SCALE_MONTHLY_V3`, and
`STRIPE_PRICE_SCALE_ANNUAL_V3`. Store the two overage price or meter IDs in
separate names. Leave every existing `STRIPE_PRICE_BASIC_*`,
`STRIPE_PRICE_PRO_*`, and `_V2` variable set and resolvable for the legacy
cohort.

## Order of operations

1. Export a reconciliation report of all current Free, Basic, and Pro owners,
   their Stripe customer and subscription IDs, current price IDs, billed
   amount, stored bytes, stored subscription snapshots, and collaborator
   count. Save the report in access-controlled operations storage.
2. Choose a cutover timestamp. Backfill every existing paid
   `workspaceSubscriptions` row with `entitlementVersion: "legacy"` and
   preserve its current `baseCents`, `storageLimitBytes`,
   `includedSeats`, and Stripe price ID. Backfill a durable `legacy` marker for
   every Free workspace created before the timestamp.
3. Create the new Stripe base products and prices in test mode. Configure the
   new environment variables in a staging Convex deployment. Keep legacy price
   IDs in the resolver and webhook mapping.
4. Implement and test the versioned entitlement resolver and Free seat
   behavior. New workspaces use the new offer. Legacy workspaces use their
   stored snapshot. Exercise signup, checkout, webhook reconciliation,
   cancellation, reactivation, invitations, storage-limit checks, dashboard
   reads, and the old Stripe prices.
5. Implement storage and export overages as a separate, metered release.
   Enable neither meter until idempotency, rounding, usage visibility, alerts,
   and a hard customer-facing spend guard have passed review.
6. Run a Stripe test-mode migration for one copied subscription of each legacy
   plan. Confirm the old subscription's next invoice, price ID, storage limit,
   and seat behavior are unchanged. Confirm a new signup receives the new
   entitlement and price.
7. Deploy the entitlement code and new Stripe configuration. Monitor webhook
   reconciliation, invoice previews, storage-limit decisions, and invite
   denials. Only then make the checkout links on the pricing page purchase the
   new offer.

## Concrete grandfathering plan

Existing customers do not move automatically.

- Existing Free workspaces remain on their current 25 GB and collaborator cap
  behind the durable legacy marker. Show them an explicit opt-in to the new
  Free entitlement. That opt-in is free, but it is still recorded so the
  changed storage cap and unlimited collaborators are never silent.
- Existing Basic subscribers keep their current Stripe subscription and price,
  current storage cap, and existing behavior. Do not swap their Stripe price,
  even if the new Studio price is higher or lower. Their workspace row retains
  the legacy entitlement version and stored limits.
- Existing Pro subscribers receive the same treatment. Keep the current Stripe
  subscription, price, storage cap, and behavior until they explicitly choose
  Scale or another offered plan.
- New signups after the cutover receive the new Free, Studio, or Scale
  entitlements. New paid checkouts use only the new Stripe price objects.
- An explicit migration flow must show the current plan, current price,
  current storage limit, new price, new storage limit, seat change, effective
  date, and a confirmation step. For a paid upgrade, make the Stripe
  subscription-item replacement with normal proration only after confirmation.
- Keep the legacy price-ID resolver, webhook mapping, and entitlement branch
  until the last legacy subscription has canceled or opted in. Do not use a
  date-only forced migration.

This plan prevents any current Free, Basic, or Pro customer from receiving a
new bill or storage cap without an explicit decision.
