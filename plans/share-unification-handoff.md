# Handoff: unify snip's share modals (accordion, Drive-style, public==private settings)

Paste the section below to the engineer/agent picking this up. It's self-contained.

---

## Task

Unify snip's **four share-creator modals** into one consistent component with a
Google-Drive information architecture and **progressive-disclosure accordions**
that guide the user through the options. Critically: **a "public" (anyone with
the link) share must support the exact same settings as a "restricted" one** —
expiration, password, allow-download, and paywall all apply to both. The *only*
difference between public and restricted is **who can open it** (the access
scope). Today the video modal wrongly hides those settings in its public branch;
fix that.

Keep snip's brutalist design language (see `CLAUDE.md`): 2px `#1a1a1a` borders,
cream `#f0f0e8` bg, burnt-orange `#C2410C` accent, no rounded corners, **no
native `<select>`** — use the snip `DropdownMenu` (`@/components/ui/dropdown-menu`).

## Current state (what exists)

Four share-CREATOR modals, lots of duplicated logic:

| File | Surface | Has |
|---|---|---|
| `src/components/ShareDialog.tsx` | video | public/private, paywall, expiry, password, allow-download, link list, preview-gen |
| `src/components/ShareFolderDialog.tsx` | folder (live bundle) | paywall, expiry, roles, link list |
| `src/components/ShareSelectionDialog.tsx` | multi-select bundle | paywall |
| `src/components/contracts/ContractShareDialog.tsx` | contract | People+General-access (already Drive-ish) + "Set up signing" |

Plus `src/components/share/ShareDownloadSheet.tsx` — **leave this alone**, it's the
recipient-side download manager (viewer UI), not a share creator.

**Already started (on `main`, HEAD `5bb956c`):** `ShareDialog.tsx` (video) now has
the Drive-IA *header* — a "People with access" row + a "General access"
Restricted⇄Anyone-with-link dropdown. The detailed controls below are NOT yet in
accordions and still only render in the private branch. That header is the
reference look to generalize.

## Backend to PRESERVE (do not change behavior)

- `convex/shareLinks.ts` → `create` (args: `videoId?`, `bundleId?`, `expiresInDays?`,
  `allowDownload`, `password?`, `paywall?: {priceCents,currency,description?}`,
  `clientEmail?`), `list`, `remove`.
- `convex/shareBundles.ts` → `createForFolder` (folder scope), bundle creation for selections.
- `convex/videos.ts` → `setVisibility({videoId, "public"|"private"})`.
- `convex/videoActions.ts` → `ensurePreviewAssetForShareLink` (MUST still fire on
  create for single-video paywalled links — watermark/preview pipeline).
- `convex/projects.ts` → `createContractShareLink({projectId, role:"review"|"edit"})`,
  `startSignableContract`.
- `convex/featureFlags.ts` → `getFeatureStatus().paywallReady` (drives the "demo" badge).

**Revenue-critical guards to keep:** paywalled links require a client email
(`requireRecipientIdentityForPaywall` server-side — surface inline), price ≥ $0.50,
and preview-gen on create. Breaking paywall = breaking revenue; test it on dev.

## Target design (one component)

Build a single `<ShareDialog>` (resource-agnostic: video | folder | selection |
contract), or a shared `<ShareAccessControls>` block the four wrappers render.

Layout, top to bottom:
1. **People with access** — owner/team (Drive-style row; per-person invites later).
2. **General access** — `Restricted ⇄ Anyone with the link` dropdown (= visibility)
   + a **role** dropdown (Viewer / Commenter / Editor; "Download" for media) +
   **Copy link**. This is the ONLY thing that gates *who*.
3. **Settings accordions** (snip-styled, collapsed by default, each header shows a
   one-line summary of its current value so the user can scan without expanding):
   - **Expiration** — Never / 1 / 7 / 30 days.
   - **Password** — optional.
   - **Allow download** — toggle.
   - **Paywall** — toggle → price + currency + client email + description; "demo"
     badge when `!paywallReady`.
   - **(contract only) Signing** — "Set up signing" → opens the signing editor
     (`startSignableContract`).
   These accordions render for **both public and restricted** — they are not gated
   on visibility. (Fix `ShareDialog.tsx`, which currently only shows them when
   private.)
4. **Active links** list (where applicable) — token, views, price, copy, open, delete.

Think Drive's "guide me through it": access first, then expandable settings, so the
user isn't hit with a wall of fields.

## Plan (do it 1-by-1, typecheck each, then delete dupes)

1. Extract the shared accordion + access UI into `<ShareAccessControls>` (or finish
   `<ShareDialog>` as the generic). Use snip `DropdownMenu`, an `<Accordion>` (build a
   small snip-styled one or reuse an existing pattern — no native `<details>` chrome).
2. Migrate **video → folder → selection → contract**, one per commit, preserving
   every existing arg/handler. `bunx tsc --noEmit` must be 0 after each.
3. Delete the now-unused modal(s) and their imports.
4. Verify on a **data-having dev deployment**: create a paywalled public link AND a
   restricted one, confirm price/expiry/password/download all apply to public too;
   confirm preview-gen fires; confirm copy/delete/views.

## Acceptance criteria

- One shared share component used by all 4 creator surfaces; old modals deleted.
- Settings live in **accordions**; **public links expose the same settings as
  restricted** (only access scope differs).
- 100% snip-styled (no native selects); all existing functionality intact
  (paywall + preview-gen + email guard + expiry + password + download + folder
  scope + contract signing + link list).
- `bunx tsc --noEmit` clean; revenue paywall flow tested on dev.

## Notes / gotchas

- Work off `main` (HEAD `5bb956c`) or a fresh branch from it. Don't resurrect the
  pruned `claude/share-team-bypass-…` branch.
- `ShareDownloadSheet` is the viewer side — out of scope.
- `convex/http.ts` signing endpoints + `getStorageBootstrap` scoping are unrelated;
  don't touch.
- Convex backend changes need `convex deploy`/`convex dev` to take effect; the web is
  Vercel off `main`.
