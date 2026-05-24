# Demo quickstart

The fastest path from "fresh clone" to "clicking through every feature."
You'll need two free signups (Convex + Clerk, ~3 min total). Stripe, Mux,
and S3 are all bypassed in demo mode.

## What demo mode does

When `STRIPE_SECRET_KEY` is missing, the app:

- Skips the SaaS subscription gate on project creation
- Replaces the "Pay" button on paywalled share links with a one-click
  "Simulate paying $X" that flips the grant's `paidAt` directly — no
  Stripe redirect, no webhook needed
- Shows a green "Demo mode" banner across the dashboard listing which
  services aren't configured

When `MUX_TOKEN_ID` is missing, video uploads are disabled but the seeded
demo videos still play (they point at Mux's public test asset).

When `R2_*` / `RAILWAY_*` are missing, the desktop sync app shows its
settings screen and refuses to push/pull until creds are entered.

## 1. Sign up for Convex

1. Go to https://convex.dev and click "Sign in" (free tier is enough).
2. In the repo: `cd /path/to/snip`
3. Run `bunx convex dev` and follow the prompts. It will:
   - Open a browser to authorize
   - Create a new deployment for this project
   - Write `.env.local` with `CONVEX_DEPLOYMENT` + `VITE_CONVEX_URL`
4. Leave that terminal running.

## 2. Sign up for Clerk

1. Go to https://clerk.com → "Sign up free."
2. Create a new application (any name; keep email + Google providers on).
3. From **API Keys**, copy:
   - **Publishable key** (starts with `pk_test_...`)
   - **Secret key** (starts with `sk_test_...`)
4. Add them to `.env.local`:
   ```
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   ```

That's all the config you need. **Do not set `STRIPE_SECRET_KEY`** — its
absence is what activates demo mode.

## 3. Run the app

```bash
bun run dev
```

Open http://localhost:5296 and sign in.

## 4. Click through the demo

1. **Dashboard** — you'll see an empty state with two buttons: "Create a
   team" and "Or: load demo data". Click the demo button. The app creates
   a team called "Demo Studio", a project called "Brand Launch Video",
   two sample videos (pointing at Mux's public test asset), and a
   paywalled share link with a simulated $500 price.

2. **Project page** — open "Brand Launch Video". You'll see the two
   videos. The first one already has a share link with paywall attached.

3. **Share page** — open the share link from the share dialog (or look at
   the link list and click the external-link icon). Because Stripe isn't
   configured, the paywall banner reads "Demo mode — simulated payment"
   and the button says "Simulate paying $500.00". Click it → the grant
   flips to paid → the player re-fetches and you're on the full-quality
   stream (with the "Paid — full-resolution unlocked" green banner).
   - Right-click is blocked, PiP is blocked, the rotating watermark
     appears during preview mode.

4. **Payouts settings** — go to
   `/dashboard/demo-studio/settings/payouts`. You'll see the Stripe
   Connect onboarding card grayed out with a "Stripe not configured"
   warning, plus the feature-readiness checklist.

5. **Desktop app** — open a new terminal:
   ```
   cd desktop
   bun run dev
   ```
   The Electron window opens to the settings screen (first run). Enter
   the Convex URL and a session token (see "Getting a Convex token"
   below). Without storage creds, you can browse the project list but
   pulls/pushes will error.

## Getting a Convex session token (for desktop app)

The desktop app needs a Clerk JWT to authenticate against your Convex
deployment. Quickest path:

1. Sign in to the web app at http://localhost:5296
2. Open browser DevTools → Application → Cookies
3. Find the Clerk session cookie (`__session` on `clerk.com`-issued)
4. Copy its value into the desktop app's "Session token" field

This is intentionally hacky for v1. A future version will deep-link the
token directly.

## What still doesn't work in demo mode

- **Real video uploads** — needs Mux + S3. Use the seeded sample videos
  to exercise the player.
- **Real Stripe payments** — payments are simulated, no money moves.
- **Watermark generation** — the seeded share link uses Mux's public
  asset as both "preview" and "full" so they look identical. Add Mux +
  S3 creds to see real watermarking + 360p preview vs. full-res swap.
- **Desktop sync** — the version-folder pull/push needs R2 or Railway S3
  creds in the desktop app's settings.

## Upgrading from demo to real

Add the appropriate env vars to `.env.local` and restart `bun run dev`.
Each integration takes effect immediately — there's no rebuild needed,
the feature flags re-evaluate on every Convex action invocation.

See [`docs/setup.md`](docs/setup.md) for the full env-var reference.
