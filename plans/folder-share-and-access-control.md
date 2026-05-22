# Folder-Style Sharing, Access Control & App-Wide Selection

## Objective

Make a shared folder behave like the real folder it represents (Google Drive /
Frame.io style), give owners granular access control (roles + invite-only +
per-email), add a Notion-style per-share header, a download manager side-sheet,
a metadata tab on the focus view, and an app-wide selection + right-click
context menu. Also fixes the live `getSharedDownloadUrl` "Video not found"
crash.

## Background / root causes

- `convex/shareBundles.ts` → `resolveBundleVideos` for `folder` bundles only
  returns videos whose `folderId` **equals** the bundle folder. Nested
  subfolders are dropped, so a shared folder with subfolders resolves to
  few/zero items, the share page never sets `activeItemId`, and the header
  Download calls `getSharedDownloadUrl` with no `itemVideoId` →
  `resolveShareTargetVideo` returns null → "Video not found"
  (`convex/videoActions.ts`).
- The share page (`app/routes/-share.tsx`) renders a bundle as a flat grid; it
  has no folder tree, filters, header, access UI, or download manager.
- Share access is "anyone with the link" + optional password + optional
  paywall. No roles, no invite-only, no per-email allowlist
  (`convex/shareLinks.ts`, `convex/shareAccess.ts`).
- The dashboard (`app/routes/dashboard/-project.tsx`) already has shift-range +
  Cmd/Ctrl selection and a floating selection toolbar, but it isn't reused on
  other surfaces, and there's no right-click context menu primitive.

## Decisions (confirmed with owner)

- Access control: **full Drive-style now** — roles (Viewer/Commenter/Editor) +
  Anyone-with-link vs Invite-only + per-email allowlist with per-person roles.
- Header: **cover image + rich-ish description**, stored per-share on the bundle
  (new S3 cover upload + fields).
- Download: a **side-sheet download manager** — per-item or bulk (multiselect);
  **one paywall** unlocks everything; downloads respect the paywall + role.
- Focus view: keep player/preview + comments, **add a Metadata tab**.
- App-wide: add **shift-select + the right-click menu to all of snip**.

---

## Phase 0 — Hotfix: download crash + nested folders  *(ship first)*

- [ ] `resolveBundleVideos` recurses the folder subtree (BFS over
      `folders.by_project_and_parent`, cycle-guarded) for `folder` bundles.
- [ ] `-share.tsx`: guard download so a bundle never calls
      `getSharedDownloadUrl` without a resolved `itemVideoId`.
- [ ] Clearer error copy in `getSharedDownloadUrl`.

## Phase 1 — Folder-aware share page + filters

- [ ] `getShareSummaryByGrant` returns the folder tree + each item's
      `folderId`, type, status, duration, size, thumb.
- [ ] Breadcrumb nav, subfolder tiles + file grid, `?folder=` param.
- [ ] Client-side filters (status / type / sort) + grid/list toggle.

## Phase 2 — Notion-style per-share header

- [ ] Schema: `shareBundles.coverImageS3Key?`, `headerTitle?`,
      `headerDescription?`.
- [ ] Presigned cover upload + `shareBundles.setHeader`; summary returns signed
      cover URL.
- [ ] Editable cover + title + description header on the share page (owner-only
      edit).

## Phase 3 — Full Drive-style access control

- [ ] Schema: `shareLinks.generalAccess` ("anyone"|"invite"), `defaultRole`,
      `permissions { comments, downloads, showAllVersions }`; new `shareInvites`
      table; `shareAccessGrants.role`.
- [ ] `issueAccessGrant` resolves role (invite match for invite-only, else
      `defaultRole`; team/owner always full); role-gate
      `comments.createForShareGrant` and downloads.
- [ ] Invite mutations (add/update/remove); optional Resend invite emails.
- [ ] Rebuild share dialogs (Drive layout): People list, Add people + role,
      General access + role, permission toggles.

## Phase 4 — Download side-sheet (download manager)

- [ ] Right-anchored `Sheet` primitive.
- [ ] Download opens a sheet for per-item/bulk (multiselect) downloads via a
      client queue; one paywall unlocks all; respects paywall + role.
- [ ] Optional follow-up: server-side ZIP "Download all".

## Phase 5 — Focus detail view + Metadata tab

- [ ] Keep player/preview + comments thread.
- [ ] Add Metadata tab (uploader, date, duration, size, type, status, version
      label/number) from the `videos` table.

## Phase 6 — App-wide selection + right-click context menu

- [ ] Extract `useGridSelection` (anchor + shift-range + Cmd/Ctrl) and apply to
      folder rows, list view, file tiles, share grid.
- [ ] Add `@radix-ui/react-context-menu` → `AssetContextMenu`.
  - Wire to existing: Move (folder), Move to Trash, Download / Download proxies.
  - Net-new (small): Bulk Rename, Bulk Edit Metadata, Copy/Duplicate.
  - Net-new (bigger, flagged): Compare 2 Assets, Add to Collection (needs a real
    collections table), Pin to cache (snip-desktop only).

## Sequencing

Phase 0 ships immediately (live crash). Then 1 → 2 → 3 → 4 → 5. Phase 3 is its
own PR (schema + grant semantics + dialog rebuilds). Phase 6 is a separate track
(touches the whole app).
