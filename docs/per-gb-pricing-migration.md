# Migration scope: per-100GB storage pricing

Moving from three fixed plans to a quantity-priced slider, so a customer
can buy 800 GB instead of being pushed from 500 GB to 2 TB.

Status: **scoped, not started.** The billing UI already ships a slider
(`src/components/StoragePlanner.tsx`) that snaps to the three existing
stops. This document is what it takes to make that slider continuous.

## The blocker today

Three things hard-code "one plan = one price":

1. `createCheckout` sends `line_items: [{ price: priceId, quantity: 1 }]`
   and resolves `priceId` from a per-plan env var
   (`convex/workspaceBillingActions.ts`).
2. It then asserts `price.unit_amount === tier.baseCents` before opening
   checkout. That guard is deliberate and worth keeping in some form: it
   is the thing that stops a mispriced Stripe object from silently
   charging the wrong amount.
3. `resolvePlanFromStripePriceId` maps a price ID back to a plan key by
   comparing against six env vars (`convex/billingHelpers.ts:52`). The
   webhook uses it to decide what someone bought.

Storage limits then come from `TIERS[key].storageBytes`, a constant.

## Target model

One Stripe recurring price: **$5.00 per 100 GB block, per month.**
Quantity carries the size.

- 500 GB = quantity 5 = $25/mo — same price as Basic today.
- 2 TB (2048 GB) = quantity 21 = $105/mo.

That second line is the problem, and it is the main decision in this
migration: today Pro sells 2 TB for **$50**, which is 2.4¢/GB. A flat
5¢/GB block price more than doubles it. Either the block price is wrong
or the ladder needs volume tiers. **Stripe graduated pricing** on a single
price object handles this natively:

| Blocks (100 GB each) | Price per block |
| --- | --- |
| 1–5 | $5.00 |
| 6–20 | $3.50 |
| 21+ | $2.40 |

That reproduces both current price points exactly at quantity 5 and
quantity 21, so nobody's bill moves on migration day. Confirm the tier
boundaries against real margins before creating the price — the numbers
above are reverse-engineered from today's list prices, not from cost.

## Work

### 1. Stripe dashboard (manual, do first)

- Create the graduated recurring price. Record the ID.
- Add `STRIPE_PRICE_STORAGE_BLOCK_MONTHLY` to the Convex deployment.
- Keep the existing four price IDs set. They must keep resolving for
  everyone who hasn't been migrated.

### 2. Schema

`workspaceSubscriptions` gains:

- `storageBlocks: v.optional(v.number())` — units of 100 GB.
- `pricingModel: v.optional(v.union(v.literal("tier"), v.literal("blocks")))`

Absent `pricingModel` means legacy tier pricing. Do not backfill it to
`"tier"` — absence is the signal that this row predates the change, and
that is worth being able to see later.

### 3. Pricing math

`src/lib/storagePricing.ts` becomes the single source for both models:

- `blocksForGb(gb)` — `Math.ceil(gb / 100)`.
- `priceForBlocks(blocks)` — walks the graduated table.
- Keep `STORAGE_STOPS` for rendering legacy subscriptions.

Its 14 existing tests stay green; add cases for the tier boundaries
(quantity 5, 6, 20, 21) and for `Math.ceil` rounding at 501 GB.

### 4. Checkout

- `createCheckout` takes `storageBlocks` instead of `plan` when
  `pricingModel === "blocks"`.
- `line_items: [{ price: blockPriceId, quantity: storageBlocks }]`.
- **Replace, don't delete, the price guard.** Assert the price is
  recurring, monthly, correct currency, and that its graduated tiers
  match the table in code. A drifted tier table is exactly the failure
  the current `unit_amount` check exists to catch.
- Write `storageBlocks` into subscription metadata so the webhook can
  recover it without a Stripe round-trip.

### 5. Plan changes without re-checkout

This is new capability, not a port. Today an active subscriber cannot
change size in-app at all — `createCheckout` throws "already has a Stripe
subscription" and sends them to the portal.

Add `updateStorageBlocks`: `stripe.subscriptions.update` with the new
quantity and `proration_behavior: "create_prorations"`. This is what
makes the slider feel like a dial rather than a checkout funnel, and it
is the single biggest UX win in the migration.

Guard it with the same overflow check the planner uses: refuse a
quantity that is smaller than current `storageUsedBytes`.

### 6. Webhook

`resolvePlanFromStripePriceId` returns `null` for the block price, which
currently means "unknown plan". Handle blocks before that call:

- If the subscription item's price is the block price, read `quantity`,
  set `storageBlocks`, `pricingModel: "blocks"`, and
  `storageLimitBytes = blocks * 100 * GIBIBYTE`.
- Otherwise fall through to the existing tier path unchanged.

### 7. Reads

Nothing to do here, which is the nice surprise in this migration.

Both readers already prefer the stored `storageLimitBytes` over the tier
constant and only fall back to `TIERS[key]` when the row has no value:
`getMySubscription` (`workspaceBilling.ts:316`) and `getMyStorageUsage`
(`workspaceBilling.ts:643`). The block path just writes that field and
both surfaces follow. The storage bar, the quota enforcement in
`assertTeamCanStoreBytes`, and the planner all read through them.

## Migrating existing subscribers

Do **not** mass-migrate. Both models can run at once, and the cost of
running them in parallel is one branch in the webhook.

1. Ship the block model for **new** subscriptions only.
2. Let existing tier subscriptions keep running. They render from
   `STORAGE_STOPS` exactly as they do now.
3. Offer migration at the moment someone tries to change size. They are
   already choosing a new number, so a one-time switch is invisible.
4. Revisit a forced migration only once the tier cohort is small enough
   to email individually.

Anyone on an **annual** price is out of scope for phase 1. The block
price above is monthly; converting a paid-up annual subscriber mid-term
means a proration refund, and there is no reason to take that on before
the monthly path is proven.

## Risks

- **Bill shock.** Any customer whose recomputed price differs by a cent
  is a support ticket. The graduated table above is designed to make the
  two current price points exact; verify with a script over real
  subscriptions before enabling migration.
- **Quantity drift.** If someone edits quantity in the Stripe dashboard,
  `storageLimitBytes` follows on the next `customer.subscription.updated`
  webhook. That is correct behavior, but it means the dashboard becomes a
  live control on storage limits. Worth stating in the runbook.
- **Downgrade below usage.** Stripe will happily accept a quantity that
  is smaller than what the customer stores. The guard has to live in our
  code, on both the slider and `updateStorageBlocks`. `wouldOverflow` in
  `storagePricing.ts` already exists and is tested.
- **The 100 GB floor.** `Math.ceil` means 1 GB costs the same as 100 GB.
  Fine, but it should be visible in the UI rather than discovered on the
  invoice.

## Rough size

Schema and pricing math, half a day. Checkout and webhook, one day.
`updateStorageBlocks` with proration and the overflow guard, one day.
Verification script over real subscriptions, half a day. Call it
**three days**, plus the Stripe dashboard work and a decision on the
graduated tier boundaries, which is a pricing call, not an engineering
one.
