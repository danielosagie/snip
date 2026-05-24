# Setup

## Development

Install dependencies:

```bash
bun install
```

Run app + Convex locally:

```bash
bun run dev
```

Run only the web app:

```bash
bun run dev:web
```

## Build / Run

```bash
bun run build
bun run start
```

## Quality checks

```bash
bun run typecheck
bun run lint
```

## Environment variables

The app boots and runs without any of these — every feature gracefully
degrades to a "configure X" state via `convex/featureFlags.ts`. Set the ones
you need.

### Core (required to run)

- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CONVEX_DEPLOYMENT` (auto-set by `bunx convex dev`)

### Mux — video ingest + playback

- `MUX_TOKEN_ID`
- `MUX_TOKEN_SECRET`
- `MUX_WEBHOOK_SECRET`
- `MUX_SIGNING_KEY` (signing-key ID — required for paywalled signed playback)
- `MUX_PRIVATE_KEY` (PEM contents of the matching signing key)

### Stripe — both SaaS billing AND Connect (client payments)

- `STRIPE_SECRET_KEY` (shared by both)
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_BASIC_MONTHLY` (the team subscription)
- `STRIPE_PRICE_PRO_MONTHLY`
- `VIDEOINFRA_PLATFORM_FEE_BASIS_POINTS` (optional, default 0 — set to e.g. 100 for 1%)

For Stripe Connect you also need to **enable Connect in the Stripe Dashboard**
under Connect → Settings. Express accounts are created on-demand by
`stripeConnect.createConnectAccount`.

### Object storage — pick ONE

Cloudflare R2 (recommended for desktop sync — no egress fees):

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT` (e.g. `https://<account>.r2.cloudflarestorage.com`)
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL` (the public r2.dev or custom-domain URL for the bucket)
- `R2_REGION` (optional, defaults to `auto`)

Or Railway S3 (the original setup):

- `RAILWAY_ACCESS_KEY_ID`
- `RAILWAY_SECRET_ACCESS_KEY`
- `RAILWAY_ENDPOINT`
- `RAILWAY_BUCKET_NAME`
- `RAILWAY_PUBLIC_URL`
- `RAILWAY_REGION` (optional, defaults to `us-east-1`)

### Webhook endpoints to register

- Stripe → `https://<your-deployment>.convex.site/stripe/webhook` — events:
  - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
  - `account.updated` (Connect)
  - `checkout.session.completed`
  - `charge.refunded`
- Mux → `https://<your-deployment>.convex.site/webhooks/mux`

### What works when nothing is set

Run `bun run dev` and the app boots. The marketing pages render fully. The
dashboard requires Clerk to sign in. The share dialog shows a "configure
Stripe + Mux + storage" hint instead of the paywall toggle. The payouts
settings page shows feature-readiness checklist.
