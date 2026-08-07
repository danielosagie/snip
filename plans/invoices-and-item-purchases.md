# Invoices, milestones, and per-item purchases

## Scope

Phase 1 adds the Convex schema, payment policy, server functions, Stripe Checkout creation, webhook fulfillment, and tests for milestone invoices and per-item purchases. Phase 2 adds the product UI. Existing all-or-nothing paywalled shares remain compatible when the new optional fields are absent.

## Product decisions

### Buyer-paid fee

Snip's fee is 5% plus 30 cents, added on top of the listed subtotal at checkout. For a $100.00 item, the buyer is charged $105.30, Stripe's `application_fee_amount` is $5.30, and the connected creator account receives the full $100.00 listed price (before any Stripe account-level processing treatment).

One dependency-free policy function, `computeBuyerTotal(subtotalCents)`, owns this behavior next to `computeApplicationFee` in `convex/paymentsPolicy.ts`. Checkout code asks the policy for both values rather than duplicating arithmetic. The implementation uses USD integer cents only and no floating-point currency arithmetic. The policy remains configured in one module, so changing from buyer-paid back to seller-deducted is a one-line policy change instead of a checkout-by-checkout rewrite.

Existing UI copy that says the creator receives the listed price "minus the fee" describes the old deducted-fee model and **must change in phase 2**. Buyer-facing checkout summaries should show listed subtotal, Snip fee, and total; creator-facing copy should say that the creator receives the listed subtotal.

### Fee applies per payment

Every milestone payment and every per-item purchase creates its own Stripe Checkout Session. The 5% + 30 cent fee is therefore computed against that payment's subtotal. A project's "total final sale" accumulates the fees of its individual payments. This is the standard processor model: each payment is a separate charge and incurs its own percentage-plus-fixed fee.

### Arbitrary milestones

The default invoice template is 50% deposit and 50% delivery, but the backend stores an arbitrary ordered list of `{ id, label, amountCents, dueAt? }`. Creators may use 30/40/30 or any other positive-cent schedule. The server validates every amount and never derives authoritative prices from client checkout input.

## Money invariants

- Currency is `usd` in this phase and every amount is a positive integer number of cents.
- `MAX_LINE_ITEM_AMOUNT_CENTS` is 5,000,000 ($50,000) for each invoice milestone and each per-item price.
- Checkout subtotals and fees are re-derived from stored invoice milestones or `shareLinks.itemPrices`; client-supplied amounts are never accepted.
- A buyer total is `subtotalCents + computeApplicationFee(subtotalCents)`. Percentage rounding follows the existing fee policy: floor basis-point arithmetic, then add the 30-cent fixed fee. Tiny positive subtotals still pay the fixed fee; checkout minimums remain governed by Stripe.
- Connect destination charges use `application_fee_amount = feeCents` and transfer the remainder, exactly `subtotalCents`, to the connected account. If the current platform-collection fallback is used, accounting still records buyer total, fee, and creator subtotal so the amount owed to the creator is unchanged.

## Data model

### `invoices`

Fields:

- `teamId`
- optional `projectId` and `shareLinkId`
- `createdByClerkId`, `createdByName`
- optional revocable `payToken`, generated when the invoice is first sent
- `clientEmail`, optional `clientLabel`
- `title`, `currency`
- `status`: `draft | sent | partially_paid | paid | void`
- `milestones`: ordered objects containing `id`, `label`, `amountCents`, optional `dueAt`, `paidAt`, `stripeCheckoutSessionId`, and `stripePaymentIntentId`
- optional `sentAt`, `voidedAt`, and `note`

Indexes are `by_team`, `by_share_link`, `by_pay_token`, and `by_client_email` on `[teamId, clientEmail]`.

Stored status is updated only through the shared pure status policy. `void` is explicit; otherwise the status is derived from milestone payment coverage: all unpaid is `draft` before send and `sent` after send, some paid is `partially_paid`, and all paid is `paid`. No write may persist a status that contradicts milestone `paidAt` fields.

### Share links and grants

- `shareLinks.paywall.mode` is optional: `all | per_item`. Missing means `all` and follows the legacy path.
- `shareLinks.itemPrices` is optional and contains `{ videoId, priceCents }` entries.
- `shareAccessGrants.unlockedVideoIds` is optional.

For `per_item`, access to a video is unlocked when its id is present in `unlockedVideoIds`. For legacy/full-share payments, `paidAt` with no `unlockedVideoIds` means every item is unlocked. This preserves old grants. A successful per-item payment appends ids without duplicates and does not turn the grant into an all-items grant.

### Payment accounting

Payment rows gain optional `kind`, `invoiceId`, `milestoneId`, `itemVideoIds`, and `subtotalCents` fields; `videoId` becomes optional because a team-level invoice may not reference a file. The authoritative `amountCents` on new rows is the buyer total, while fee and seller subtotal are stored explicitly for earnings math. Legacy rows without the new fields retain their existing deducted-fee interpretation. The team earnings accumulator counts successful milestone and item payments exactly once using the same webhook-idempotent transition used by existing payments.

## Server API and authorization

### Invoice CRUD (`convex/invoices.ts`)

- `create`: requires an authenticated team member (`member` or higher); validates that optional project/share references belong to the team; validates email, USD currency, labels, unique milestone ids, due dates, and bounded positive amounts. Creates a draft with derived status.
- `update`: requires `member` or higher on the invoice's team. Drafts may edit invoice details and milestone structure. Once sent, invoice structure and paid milestones are locked; only invoice details and unpaid milestone fields may change. Paid milestone ids, labels, amounts, due dates, and payment fields cannot change.
- `send`: requires `member` or higher, accepts only a valid non-void draft, stamps `sentAt`, and derives `sent`/payment status.
- `void`: requires `member` or higher and rejects invoices with any paid milestone; stamps `voidedAt` and stores `void`.
- `listByTeam`: requires team membership and returns invoices with status rolled up from milestones.
- `get`: requires team membership for creator management. A separate checkout lookup exposes only the minimum invoice/client-safe data needed for payment and does not trust a public id alone for management.

All public creator write paths re-check team ownership and `member`-or-higher role in Convex; UI state is never an authorization boundary. Internal checkout/webhook mutations are not client-callable and instead validate the stored team/reference, Checkout Session, payment kind, and milestone/item relationship before writing.

### Milestone checkout (`convex/invoicesActions.ts`)

`createMilestoneCheckout(payToken, milestoneId, successUrl, cancelUrl)` resolves the revocable invoice payment token server-side, verifies that the invoice is sent or partially paid, not void, and the milestone is unpaid. It re-reads the stored amount, computes buyer total and application fee, resolves the team's Connect settlement using the existing paywall pattern, and creates a Stripe Checkout Session prefilled with the stored client email. Metadata includes `kind=invoice_milestone`, `invoiceId`, `milestoneId`, and `teamId`. Phase 2 replaced the phase-1 opaque Convex invoice id capability with this dedicated token. Resends preserve an active token, and an authenticated team member can revoke it.

The client never sends an amount. Reusing an already completed milestone is rejected; parallel pending sessions are made harmless by webhook idempotency and milestone payment-intent checks.

### Share checkout

`createCheckoutForGrant` gains optional `itemVideoIds`. When absent and `paywall.mode` is absent/`all`, it executes the current full-share flow. In `per_item` mode it requires a non-empty, duplicate-free list of at most 10 items, confirms every video belongs to the share, looks up every price in stored `itemPrices`, rejects already-unlocked items, sums with safe integer arithmetic, and computes the buyer total. Metadata contains `kind=share_item`, the grant/link/team ids, and encoded video ids. The corresponding pending payment row stores those ids.

All-share and existing per-video checkouts also use the buyer-total policy. Their metadata is tagged so the webhook can route explicitly while still accepting legacy sessions without `kind`.

### Playback and downloads

`getSharedPaywalledPlayback` and every share download capability use one access predicate:

- no paywall: existing access behavior;
- absent/`all` mode: legacy `grant.paidAt` behavior;
- `per_item`: the requested video must be listed in `unlockedVideoIds`, except a legacy/full-share grant with `paidAt` and absent `unlockedVideoIds`, which unlocks all items.

## Webhook routing and idempotency

`checkout.session.completed` routes on `metadata.kind`:

- missing/legacy or `share_all`/existing per-video: existing fulfillment;
- `share_item`: mark its payment succeeded, union the stored item ids into the grant's `unlockedVideoIds`, and never create duplicates;
- `invoice_milestone`: match the server-recorded Checkout Session, set that milestone's `paidAt`, Checkout Session id, and PaymentIntent id once, then recompute invoice status.

The Checkout Session id is the payment idempotency key. Existing payment rows are uniquely looked up through `by_checkout_session`; terminal succeeded/refunded transitions are no-ops on replay, so earnings move only once. Invoice Checkout creation also sends Stripe an idempotency key derived from invoice, milestone, and prior session, preventing concurrent requests from creating two payable sessions. Invoice fulfillment additionally requires the session id recorded on the milestone/payment record and treats an already-paid milestone as a no-op. Item fulfillment uses a set union. Replayed Stripe events therefore neither double-count earnings nor change already-finalized fulfillment.

Full-charge refunds reverse earnings once. A refunded full-share payment clears the full unlock while preserving any separately purchased items; a refunded item purchase rebuilds the grant's item union from its other successful payments; a refunded milestone clears that milestone's payment fields and re-derives invoice status. Allocation and access behavior for partial refunds remains an explicit decision below.

## Phase 2 UI surfaces

- Billing: an **Invoices** management area with list/filter/status, create, preview, edit, send, void, copy/share payment link, paid/unpaid milestone state, client, due date, totals, and receipt affordances.
- Invoice composer: default 50/50 deposit/delivery rows with add/remove/reorder support for arbitrary schedules such as 30/40/30.
- Share modal: switch between full-share and per-item pricing, edit each item's price, validate missing prices, and preview buyer totals.
- Client share page: select and buy only wanted items, clearly show subtotal + buyer-paid fee = total, preserve purchased-item state, and expose original playback/download only for unlocked items.
- Client milestone payment: invoice summary, due/paid milestones, one-at-a-time hosted checkout, receipt state, and clear creator/client identity.
- Existing creator payout and paywall copy: remove "minus the fee" language and state that the buyer pays the fee on top while the creator nets the listed subtotal.

## Open questions

1. **Invoice payment access (resolved in phase 2):** client payment uses a dedicated, revocable opaque token. Raw Convex invoice ids are never public payment capabilities.
2. **Invoice delivery:** should `send` only change state, or also send transactional email? Phase 1 only changes state because no email provider/sender contract is specified.
3. **Tax:** are taxes added through Stripe Tax, included in listed price, or unsupported? Phase 1 does not calculate tax.
4. **Partial refunds and disputes:** full refunds revoke the corresponding milestone/item in phase 1. How should a partial refund of a multi-item Checkout Session allocate revocation, and should disputes suspend access before they are resolved?
5. **Editing sent invoices:** may client/title/note change after payment, or should all presentation fields freeze once any payment succeeds? The backend permits descriptive edits but locks paid milestone terms; product copy should make this visible.
6. **Invoice totals and caps:** the per-line cap is $50,000 as required. Is there also a maximum milestone count or invoice-total cap? A modest milestone-count limit is advisable to bound document size and Checkout metadata.
7. **Per-item checkout size:** Stripe metadata is size-limited. Should UI cap the number of items in one purchase or split very large selections? Phase 1 should enforce a conservative bounded selection count.
8. **Currency expansion:** this phase is USD-only. Multi-currency support needs currency-specific minimums, zero-decimal currency handling, and explicit fee configuration before enabling other codes.
9. **Creator settlement fallback:** the current paywall path can collect on the platform when Connect is incomplete. Should invoice payments do the same, or require an active connected account? Matching the current friction-minimizing fallback is recommended, provided accounting and operations clearly track money owed.
10. **Invoice numbering and legal fields:** no human-readable invoice number, business address, tax id, or PDF/email artifact is specified. Those should be designed before marketing this as a legal/tax invoice rather than a payment schedule.
