# Multiplayer cloud editing — build plan for 6 parallel agents

The strategy this executes (from the architecture discussions):

- **Stream data, not pixels.** No cloud desktops. Media lives in R2 (zero
  egress), immutable and content-addressed; only the bytes you touch travel.
- **The edit is data.** Timelines are JSON (OTIO-shaped), synced live through
  Convex. Playback composites from proxies; nothing renders until delivery.
- **Render on our servers, Depot-style.** Warm conform workers with a
  content-addressed segment cache; smart-render re-encodes only changed GOPs.
- **Multiplayer is the cheap feature.** Collaborators sync kilobytes while
  streaming shared immutable media — COGS scales with unique bytes, not seats.
  Unlimited free viewers/commenters; only editors pay; storage metered ~2× R2.
- **Any NLE, same files, everyone visible.** True co-editing lives in the
  browser editor (our format). Native NLEs get the ladder: file-layer presence
  + soft locks + auto-versioning (universal), panels with live playheads and
  timeline sync (per-NLE), pull-don't-merge for sequences. Never pretend
  binary project files merge.

What already exists and must be built on, not duplicated:

- `convex/timelines.ts` — append-only timeline **snapshots** (git-like:
  branch + parentSnapshotId), sources `resolve | premiere | manual`, with an
  HTTP ingest endpoint in `convex/http.ts` for the Resolve plugin.
- `convex/videoPresence.ts`, `convex/desktopPresence.ts` — presence via
  `@convex-dev/presence`.
- Proxy pipeline per `plans/proxies-unified.md` — Mux static renditions
  mirrored to R2 (`staticRenditions[]`, `mirrorRenditionToR2`); step 6
  (mount proxy/full-res toggle) is still open.
- Desktop app (`desktop/`) — Electron + WebDAV mount, pairing, ACLs,
  `TimelinesView.tsx`.
- `convex/usageMeters.ts` / `usageMetersActions.ts` — egress/usage metering.
- `@remotion/player`, `@ffmpeg/ffmpeg` (wasm) already in deps.

## Ground rules for running 6 agents in parallel

1. **Contracts before code.** Phase 0 lands one PR (Agent A) defining the
   shared types: the live timeline doc shape, presence channel payloads, and
   the render-job record. Everyone else codes against those types from day 1.
2. **Ownership = directories.** Each agent owns the files listed in its
   section. Cross-boundary needs go through the owning agent's exported
   API/types, never by editing another agent's files. `convex/schema.ts` is
   Agent A's — schema changes from others arrive as a request in the PR
   description, A lands them. Two shared surfaces get explicit rules so no
   file has two owners:
   - `convex/http.ts` **route registration is Agent A's.** D and E implement
     their HTTP handlers in agent-owned modules (`convex/ingestDesktop.ts`,
     `convex/ingestPanels.ts`) and A lands the one-line route registrations.
   - **`renderJobs` rows are written only by Agent F.** B (and anyone else)
     creates/reads jobs through F's exported API (`renderJobs.enqueue`,
     `renderJobs.get`), never by inserting rows directly.
3. **One branch per agent** (`agent/<letter>-<slug>`), rebased on the
   integration branch daily. Small PRs, each leaving `bun run typecheck`,
   `typecheck:convex`, and `lint` green.
4. **Feature-flag everything** through the existing `convex/featureFlags.ts`
   graceful-degradation pattern — the app must boot with none of the new
   env/infra configured.
5. **Design language** per CLAUDE.md — brutalist app UI; don't touch
   `app/routes/-home.tsx` art direction.

---

## Agent A — Timeline core: the live document (owns the contracts)

The canonical, multiplayer timeline doc that everything else reads/writes.
Snapshots exist; this adds the *live* layer between snapshots.

**Owns:** `convex/schema.ts`, `convex/timelines.ts`, new
`convex/timelineDocs.ts`, `src/lib/timeline/` (shared types + OTIO
conversion).

1. **Doc model.** `timelineDocs` table: object tree `sequence → tracks →
   clips → properties` keyed by stable IDs, referencing `videos` rows as
   media. Last-writer-wins per property (Figma-style), no full CRDT.
   Mutations are small ops (`setClipRange`, `moveClip`, `addClip`, …) so
   Convex reactivity gives every client live updates for free.
   **Compound-edit semantics** (ripple, split, reorder, undo touch many
   properties): every edit is an *op batch* — `{opId, baseRevision, ops[]}`
   applied in one Convex mutation, so batches are atomic (Convex mutations
   are transactional) and collaborators never observe a partial ripple.
   The doc carries a monotonically increasing `revision`; a batch whose
   `baseRevision` is stale is rebased property-wise (LWW, ties broken
   deterministically by `(revision, opId)`) or rejected for the client to
   retry. Undo is the *conditional* inverse of your own batch: it applies
   only to properties still at the value your batch wrote — it never
   overwrites a newer remote change.
2. **Branches + snapshots.** A doc lives on a branch; "commit" freezes the
   doc into the existing `timelines.ts` snapshot log (same
   branch/parentSnapshotId semantics). Restore = load snapshot into a doc.
3. **OTIO in/out.** `src/lib/timeline/otio.ts`: doc ⇄ OTIO JSON, plus
   FCPXML → OTIO import (the Resolve endpoint already receives FCPXML).
   This is the hub every NLE adapter converges on. Three flows, kept
   explicitly separate:
   - **Import**: FCPXML → OTIO → materialize/update a `timelineDocs` doc
     (not just stored fields alongside a snapshot, as the current endpoint
     does).
   - **Commit**: serialize doc → snapshot via `recordSnapshot`, which is
     reserved for explicit commits only.
   - **Live ops**: an authenticated op-batch API (the same mutations the
     browser uses) exposed over HTTP for panels/desktop — live updates
     never go through the append-only snapshot path.
4. **Contracts PR (Phase 0, week 1):** TypeScript types for the doc, ops,
   presence payloads (playhead, selection, lock claims), and `renderJobs`
   schema. Land before B–F write feature code.

**Done when:** two browser tabs mutate one doc and both see sub-second
updates; commit/restore round-trips through snapshots; FCPXML from the
existing Resolve endpoint imports into a doc.

## Agent B — Browser editor: cut without downloading

The Figma-grade surface where true multiplayer lives.

**Owns:** `src/components/editor/`, `app/routes/dashboard/` editor route,
`src/lib/playback/`.

1. **Playback engine.** WebCodecs decode of the R2-mirrored proxy MP4s via
   HTTP range requests; OPFS cache of fetched GOPs; fall back to
   `@remotion/player` composition where WebCodecs is unavailable. Fetch only
   around the playhead — never whole files.
2. **Timeline UI.** Tracks/clips rendering Agent A's doc; trim, split, move,
   reorder; ripple; per-clip audio gain. Assembly-editor scope — selects,
   trims, stitching versions — not a Premiere clone.
3. **Edits = ops.** Every interaction calls Agent A's mutations; undo/redo is
   op inversion, versions are branch commits. No local files, no render.
4. **Watermark/export hooks.** "Export" creates a `renderJobs` row (Agent F)
   and shows progress; nothing encodes client-side except a wasm-ffmpeg
   fallback for short clips.

**Done when:** a 4K project scrubs smoothly from proxies on a mid laptop;
two people edit the same sequence live; export lands via F's worker.

## Agent C — Presence & awareness: the cursors

Every surface shows who's here and what they're touching.

**Owns:** `convex/videoPresence.ts` extensions, new
`convex/editPresence.ts`, `src/components/presence/`, lock UX.

1. **Edit presence.** Extend the presence component: per-doc channels
   carrying playhead, selected clip IDs, and viewport — ghost playheads and
   selection highlights in B's editor and on the web timeline strip.
2. **Soft locks.** Lock claims on sequences (browser) and on project *files*
   (desktop, with D): claim on open, everyone sees it, opening anyway warns.
   Avid bin-locking semantics, advisory not mandatory.
3. **File-activity presence.** Render D's watcher events ("Dara is in
   cut_v3.prproj, saved 2m ago") in the dashboard, project view, and desktop
   app.
4. **Watch-together.** Presence-synced playhead on the share/review player —
   "close enough" sync (each client streams its own copy), host-follows
   toggle.

**Done when:** editor shows live ghost playheads; opening a locked .prproj
warns with who/when; a share-page review session follows the host's
playhead.

## Agent D — Desktop & drive: the universal tier

Works with ANY editor because it's the file layer.

**Owns:** `desktop/` (except panel code, E's), `convex/desktopPresence.ts`,
`convex/ingestDesktop.ts` (handlers; A registers the routes in `http.ts`).

1. **File watcher.** Watch the mount/local project dirs; publish open/save
   events as presence + lock claims (C's channels, D's transport).
2. **Auto-versioning.** Persist every project-file save as a
   content-addressed file version first (dedup by content hash — identical
   saves are no-ops), into the project's version history
   (`itemVersions`/`projectVersions` pattern). Browsable "their version vs
   mine" history in the desktop app. Versioning is unconditional — it never
   depends on parsing.
3. **Project-file parsing.** After the version is persisted: `.prproj` =
   gunzip → XML; `.fcpxml` = XML. Parse to OTIO and POST to A's import
   flow, recording a per-version import status (`parsed` / `failed` /
   `unsupported`, with the error). A timeline snapshot is created only on
   `parsed`; a failed parse still leaves the file version safe.
   **Auth**: a device/user-scoped, revocable desktop credential (extend the
   existing desktop pairing/`desktopAuth` machinery) — not the team-wide
   Resolve plugin token. The server enforces project scope and derives the
   actor's identity from the credential; it never trusts a client-supplied
   `createdByName`.
4. **Proxy/full-res toggle** — close out `plans/proxies-unified.md` step 6:
   mount resolves `proxies/` by default, full-res on demand, cached after
   first touch. Plus the streaming R2 mirror for GB-scale renditions
   (`@aws-sdk/lib-storage` in the desktop/worker context, not Convex).

**Done when:** saving a .prproj on the mount auto-versions it, updates the
web timeline within seconds, and teammates see presence/locks — with zero
plugins installed.

## Agent E — NLE panels: cursors inside the editor

Per-NLE adapters on the vendors' extension surfaces (the Frame.io route).

**Owns:** new `panels/` workspace (`panels/resolve/`, `panels/premiere/`),
`convex/ingestPanels.ts` (handlers; A registers the routes in `http.ts`).

1. **Resolve first** — scripting API already half-integrated (the snapshot
   endpoint exists). Panel: presence out (open timeline, playhead), presence
   in (teammates, frame-pinned comments), push timeline state live rather
   than only on save.
2. **Premiere UXP/CEP panel** — same triad: presence out, presence in,
   sequence export → OTIO → hub. Reuse D's parser where the API is thin.
3. **Pull, don't merge.** One click imports a teammate's branch/snapshot as
   a *new sequence* in the open project (Premiere panel import; Resolve API
   timeline build). Snip web shows the diff; the editor reconciles.
4. **Stretch: hosted Resolve collaboration server.** Managed Postgres
   project server per team — Resolve's real native multiplayer as a plan
   checkbox. Near-zero COGS; provisioning + connection UX only.

**Done when:** a Resolve editor and a Premiere editor each see the other's
playhead and latest cut in-panel, and can pull it as a sequence.

## Agent F — Render fleet & metering: the margin

Server-side conform + the billing that sells it back.

**Owns:** new `workers/render/` (containerized ffmpeg worker),
`convex/renderJobs.ts`, `convex/usageMeters.ts` extensions, pricing surface
in billing.

1. **Conform worker.** Pulls originals from R2 (free egress), renders a doc
   snapshot to MP4/HLS, uploads to R2, marks the job. Spot/interruptible
   compute, so the `renderJobs` state machine (schema from A's contracts
   PR) must survive worker death: jobs are *leased* (`leaseOwner`,
   `leaseExpiresAt`, renewed by heartbeat; expiry requeues the job with
   `attempt + 1`), output keys are deterministic
   (`renders/<jobId>/<attempt>/…`) so R2 uploads are idempotent, and
   completion is a single atomic compare-and-set on `(jobId, leaseOwner)` —
   a restarted worker whose lease lapsed can't double-complete a job.
2. **Smart render.** Content-addressed segment cache per GOP-aligned
   segment, keyed by *everything that affects output bytes*: source media
   content hash (not IDs), in/out, effect params, output codec + container
   + profile/level, dimensions, frame rate, audio settings, color
   management, worker/FFmpeg version, and a cache-schema version —
   changing export settings or upgrading the encoder can never serve stale
   segments. Stream-copy cache hits, encode only misses. v2 of a cut
   re-encodes seconds, not minutes. This is the moat — instrument
   cache-hit rate from day 1.
3. **Mux replacement path.** The same worker writes HLS ladders into R2
   behind a flag — new uploads can bypass Mux per-minute pricing when the
   flag is on. Keep Mux as the default until parity is proven.
4. **Metering + pricing.** Extend `usageMeters` to storage-GB-months and
   render-minutes; wire Stripe metered billing for storage beyond quota
   (~2× R2 cost) and export minutes. Free viewer/commenter seats stay free.

**Done when:** browser export works end-to-end; an unchanged re-export is
more than 90% stream-copied; a team's bill reflects metered storage.

---

## Phasing & integration milestones

- **Phase 0 (week 1):** A lands the contracts PR. B/C/D/E/F scaffold their
  areas against the types; D ships the watcher skeleton; F stands up the
  worker container running a hardcoded job.
- **Phase 1 (weeks 2–4), fully parallel:** A doc CRUD + OTIO; B playback +
  timeline read-only → editable; C edit presence; D versioning + parsing;
  E Resolve panel; F conform worker + renderJobs.
  - **Milestone M1 (end wk 3):** two tabs co-edit a doc with ghost playheads
    (A+B+C).
  - **Milestone M2 (end wk 4):** .prproj save → web timeline update (D+A).
- **Phase 2 (weeks 5–7), integration:** B export → F jobs; E Premiere panel
  + pull-don't-merge; D proxy toggle; C locks across web+desktop; F smart
  render cache.
  - **Milestone M3:** the demo — cut a 4K delivery in the browser from a
    phone-sized laptop, teammate watches live from Resolve's panel, export
    in seconds via cache, client gets a paywalled share link.
- **Phase 3 (week 8+):** F metered billing + Mux-bypass flag; E hosted
  Resolve server; hardening, docs, pricing page update.

**5-agent variant:** fold C into B (presence is mostly consumed in the
editor; D keeps file-layer lock UX). Do not fold F — the render fleet and
metering are the margin and deserve a dedicated owner.

## Cross-agent interface summary

| Producer | Artifact | Consumers |
|---|---|---|
| A | timeline doc types, ops API, OTIO lib, `renderJobs` schema | everyone |
| B | editor surface, export trigger | C (mount points), F (jobs) |
| C | presence channels + lock claims | B, D, E render them |
| D | watcher events, file versions, parsed OTIO pushes | A (ingest), C (presence) |
| E | panel presence + live timeline pushes | A (ingest), C (channels) |
| F | render results, cache stats, meters | B (progress UI), billing |

## Risks to watch

- **WebCodecs codec coverage** (esp. HEVC sources): mitigated because B
  plays *proxies* (H.264), never originals; keep the Remotion fallback.
- **.prproj format drift** across Premiere versions: parser must
  fail-soft to "version saved, timeline not parsed" — never block the save
  path on parse success.
- **LWW granularity:** property-level LWW can interleave two people's
  ripple edits confusingly; C's soft locks on sequences are the pressure
  valve — encourage branch-per-editor for divergent cuts.
- **Worker cold starts** undermine the "export in seconds" demo: keep one
  warm worker per region once usage justifies it; measure queue-to-start.
- **Convex doc-size limits:** long timelines must stay under row limits —
  shard clips per track if a sequence tree approaches the cap.
