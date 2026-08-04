# One document type, and the soft pass

Two pieces of work that are easy to confuse but should be sequenced apart:

- **Part A** — contracts and documents become one thing everywhere.
- **Part B** — the app-wide soft usability and design pass.

Part A is a bounded refactor. Part B is a strategy decision followed by a
long tail. Doing B first would mean restyling surfaces that A deletes.

---

## Part A — one document, signing is a capability

### The reframe

`docType` reads like a type. It isn't. Look at what it actually does:

- `promoteDocumentToContract` is **deliberately one-way**
  (`contractsTable.ts:407`) and the comment says why: demoting would
  orphan recipients and legal events.
- `get` already serves both shapes from one row — documents just come
  back with empty `recipients`, `fields`, and `audit`
  (`contractsTable.ts:165`).
- `requireSigningCapability` (`contractsTable.ts:105`) throws with
  *"Prepare this document for signing…"* — the error message already
  describes a capability, not a type.

So the data model is nearly right already. What's wrong is that the UI
presents a one-way capability flag as a two-way type choice. That is the
bug behind the toolbar we merged, where a contract/document toggle sits
next to a "Prepare for signing" button doing the same job in opposite
directions.

**Target model:** everything is a document. A document can be *prepared
for signing*, once, which turns on recipients, fields, and the signing
lifecycle. Nothing is ever "a contract" in the UI vocabulary.

### Work

**1. Delete the type toggle.** The contract⇄document switch in the editor
toolbar goes. "Prepare for signing" becomes the only path, and it's
already correctly one-way. This alone removes the contradiction.

**2. Collapse two routes into one.** Today `/contract/$id` and `/doc/$id`
(`src/lib/routes.ts:21,27`) render the same editor with a `mode` prop.
Keep `/doc/$id` as canonical, redirect `/contract/$id` to it. Links are
in the wild — in share emails and audit rows — so the redirect stays
indefinitely; it costs one route file.

**3. One create action.** `ProjectAddButton` currently offers two
(`ProjectAddButton.tsx:67`), differing only in `kind` (`sow` vs `custom`)
and `docType`. Collapse to "New document". `kind` is separate metadata
and can keep defaulting to `custom`.

**4. Rename the capability, not the column.** In the UI say "signing
enabled". In the DB, leave `docType` alone — it's load-bearing in
`list`, `get`, `promoteDocumentToContract`, and the trash. Renaming the
column buys nothing and risks a migration for cosmetics. Add a derived
`signingEnabled` boolean to the query return instead, and let the UI read
only that.

**5. One list section.** `ContractListSection` splits into Contracts and
Documents groups. Merge into one "Documents" grid, with a small signing
badge on rows that have it. Status badges (draft/sent/signed) only render
when signing is on.

**6. Trash follows.** `trash.tsx` has 7 `docType` references choosing
labels and icons; it collapses to one.

### Scope

`docType` / `isDocument` appears in 9 files: `-contractDocEditor.tsx`
(21 refs), `contractsTable.ts` (20), `trash.tsx` (7),
`ProjectAddButton.tsx` (5), `-project.tsx` (5),
`ContractListSection.tsx` (3), plus schema, routes, and the doc route.

The editor is the bulk and it is already the messiest file in the app —
32 brutalist borders and two merged designs. Part A is the right moment
to simplify it, not a separate pass.

**Rough size: two days.** Half of it is the editor.

### What this does not fix

You said contracts and signing "need to be updated and made to actually
work." Unifying the type does not fix the signing flow itself — sending,
reminders, countersigning, what a recipient sees. That's a separate piece
of work and it needs its own scoping session; I haven't audited it and
won't guess at it here.

---

## Part B — the soft pass

### The decision that determines the cost

There are **303** `border-2 border-[#1a1a1a]` occurrences across `app/`
and `src/`. Converting them by hand is weeks and will drift.

You do not have to. A soft skin **already exists**: `data-style="soft"`
on `<html>`, with 12 CSS rules in `app.css:602+` that remap the brutalist
vocabulary wholesale — 2px borders to hairlines, offset shadows to
layered ones, buttons to pills, cards to 16px radius, inputs to 10px.
`ThemeToggle` already switches it and persists to `snip-style`. It
defaults to `classic` (`ThemeToggle.tsx:53`).

So the real question is not "how do we restyle 303 borders" but:

> **Is soft the app, or a skin of the app?**

**Option 1 — make soft the default and delete classic.** Flip the
default in `ThemeToggle` and `__root.tsx`, then fix what looks wrong.
The CSS remap does most of the work in one commit. Cheap, uniform,
reversible. The catch: the remap is mechanical, so places that leaned on
brutalist proportion (the poster-scale `font-black` headings, the
inverted dark sections) will look thin rather than deliberate, and each
needs a real design pass.

**Option 2 — convert page by page** with `.surface-soft`, which is what
billing, team members, and settings now do. Precise per page, but three
pages in and the app is visibly two apps. At 303 borders this never
finishes, and the halfway state is worse than either end.

**Recommendation: Option 1**, with Option 2's scoped classes kept for the
account-level pages that want the tighter Cursor-like density. Flip the
default, then walk the surfaces in priority order fixing proportion.
The scoped `.surface-soft` block stays useful because those pages want
`#FAFAFA` and a 1120px column, which is narrower than a global skin
should impose.

This also settles a real inconsistency: `CLAUDE.md` documents brutalist
as the app language with the marketing page as the exception. If soft
becomes the app, that file needs rewriting, or every future change will
be argued against the wrong spec.

### Surface priority

By brutalist density, weighted by how often people actually look at them:

1. `-contractDocEditor.tsx` (32) — worst offender, and Part A rewrites it anyway
2. `-project.tsx` (8) — the most-visited screen in the app
3. Share surfaces — `ShareFolderDialog` (10), `ShareDialog` (9),
   `ShareFolderBrowser` (8), `ShareAccessPanel` (7), `ShareSelectionDialog` (6).
   These are what *clients* see; they're the brand surface and should lead, not trail.
4. `files/FileTile.tsx` (9) — every project screen
5. `trash.tsx` (5), `settings.folders.tsx` (4), `-video.tsx` (3)
6. `ui/button.tsx` (5) — shared primitive; changing it moves everything at once, so it goes early or not at all

### What "the essence of soft" means here

From what's already built in billing, so the rest matches rather than
reinvents:

- **Hairlines, not walls.** 1px `#E8E8EC`, never 2px black.
- **One ground.** `#FAFAFA` page, `#FFFFFF` cards. No cream.
- **Radius is small and consistent.** 14px cards, 999px buttons, 10–11px inputs.
- **Type does the work, quietly.** 22px semibold page titles, 16px
  semibold section titles, 14px body, `#6E6E73` for everything secondary.
  No 900-weight, no uppercase-mono labels except real spec data.
- **Orange is punctuation.** `#FF6600` for the one thing that needs
  action, never as a fill.
- **Density over drama.** Cursor's billing page is the reference: many
  small facts, generous whitespace, nothing shouting.

### Bugs and usability, separately

You mentioned "so many small bugs and styling issues." I've hit exactly
three so far and fixed them; I have not audited for the rest:

- `-project.tsx` used `filteredVideos` before its declaration, collapsing
  inference to `unknown` and breaking the build. Fixed.
- The merged editor toolbar renders five controls from two designs.
  Part A step 1 resolves it.
- 21 repo-wide lint errors from missing eslint plugins
  (`react-hooks/exhaustive-deps`, `jsx-a11y/no-autofocus`) — the rules
  are referenced but not installed, so those checks aren't running at
  all. Worth fixing before a design pass, since they'd catch real a11y
  regressions.

A proper bug list needs a pass with the app open, signed in. I can't do
that from here — the preview pane has its own session. That's the one
input this plan is missing, and it should probably come before Part B's
long tail so the work is driven by real defects rather than a border count.

---

## Sequence

1. **Part A** — one document type. Bounded, deletes code, fixes the
   toolbar contradiction, and rewrites the worst file anyway.
2. **Decide Option 1 vs 2.** One-line change, but it sets the cost of
   everything after.
3. **Flip the default**, fix proportion on the priority surfaces in order.
4. **Signing flow** — its own scoping pass, after the type unification
   makes the surface legible.
