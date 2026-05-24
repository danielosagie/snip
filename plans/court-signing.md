# Court-admissible e-signatures for snip contracts

Goal: signatures that hold up in litigation — tamper-evident audit trail, signer
identity verification, and ESIGN/UETA compliance — for the contracts snip already
drafts. Today's "Send for signature" (`ContractShareDialog` → `projects.sendContractForSignature`)
is a **stub** (Dropbox-Sign-style placeholder); there is no real signing ceremony,
audit trail, or certificate.

## ⚠️ Read first: the Documenso licensing trap

Documenso is **AGPLv3**. "Taking the parts we need out of it" into snip (a
proprietary SaaS) makes snip a *derivative work* — AGPL then requires you to
**release snip's complete source under AGPL** to every user over the network.
That's almost certainly not what you want for a commercial product. Three legal
ways to get Documenso-grade signing without that obligation:

1. **Documenso Cloud / their hosted API + embeds** — call their API, embed their
   signing flow. No source copying → no AGPL reach into snip. Cleanest + fastest.
   (Verify their commercial/API terms.)
2. **Clean-room reimplementation** — build the signing ceremony + audit trail
   ourselves from the ESIGN/UETA spec (below), looking at Documenso only as a
   *reference for what to build*, not copying code. No AGPL exposure. More work.
3. **Adopt AGPL** — only if snip is (or will be) open source. Unlikely.

The legal weight comes from the **process + evidence**, not from any specific
library — so a clean-room build (option 2) is fully court-admissible if it
captures the right evidence. Documenso's value is the reference design, not
secret code.

## What actually makes a signature court-admissible (ESIGN / UETA)

US ESIGN Act + state UETA make e-signatures enforceable when you can show:

1. **Intent to sign** — an affirmative act (click "Sign", draw/type signature).
2. **Consent to do business electronically** — explicit checkbox + disclosure,
   with a right to opt out / request paper.
3. **Attribution (identity)** — evidence the signature is *that person's*. Tiers:
   - email possession (signing link to a verified address) — baseline,
   - + access code / OTP (SMS or email) — stronger,
   - + ID document / KYC — strongest (for high-value).
4. **Association with the record** — the signature is bound to *this exact
   document version* (hash it).
5. **Record integrity / tamper-evidence** — detect any post-signing change
   (document hash + signed audit log).
6. **Retention & reproducibility** — both parties can retain/reproduce the signed
   PDF + certificate.

The defensible artifact is a **Certificate of Completion**: who signed, when (UTC),
from what IP + user agent, by what auth method, against which document hash, with a
full timestamped event log.

## Data model (clean-room, snip-styled)

New Convex tables (mirror snip's existing patterns):

- `signatureEnvelopes` — one signing request per contract version:
  `{ contractId, projectId, contentHash (SHA-256 of the frozen PDF/HTML),
     status: draft|sent|partially_signed|completed|declined|voided,
     createdBy, createdAt, completedAt }`. **Freeze** the document at send time
  (snapshot → immutable) so what's signed can't change underneath.
- `signatureRecipients` — `{ envelopeId, name, email, role: signer|viewer|approver,
     order (for sequential signing), authMethod: email|otp|id,
     status, signedAt, ipAddress, userAgent, signatureImageKey }`.
- `signatureFields` — the "plus"-placed fields: `{ envelopeId, recipientId,
     type: signature|initials|date|text|checkbox, page, x, y, w, h, required, value }`.
- `signatureAuditEvents` — append-only: `{ envelopeId, recipientId?, type:
     created|sent|opened|consented|otp_sent|otp_verified|field_filled|signed|
     declined|completed|downloaded, at, ip, userAgent, meta }`. This log IS the
  evidence.

## Flow

1. **Place fields ("the plus")** — on the contract preview, the sender drops
   signature/date/text fields per recipient (drag, or click-to-add at cursor).
   This is the missing "+" the user wants. Snip-styled overlay on the doc canvas.
2. **Send** — freeze the doc (hash it), create envelope + recipients + fields,
   email each signer a unique signing link (token, short-TTL per session).
3. **Sign ceremony** (public `/sign/$token` route — one already exists as a stub):
   - show ESIGN consent disclosure + checkbox (record `consented`),
   - verify identity per `authMethod` (email link = baseline; OTP = email/SMS code),
   - render the frozen doc + the recipient's fields; they fill/draw/type,
   - on submit: stamp `signedAt`, IP, UA; append audit events; recompute status.
4. **Complete** — when all required signers done: mark `completed`, generate the
   **signed PDF + Certificate of Completion** (embed signatures + append the audit
   log + document hash), store in R2, notify all parties.
5. **Verify** — anyone can re-hash the stored PDF and compare to `contentHash` to
   prove no tampering.

## Identity verification tiers (pick per contract value)
- **Baseline:** unique tokenized link to a verified email (possession factor).
- **Standard:** + one-time passcode (email or SMS) before signing. ~90% of needs.
- **High:** + government-ID upload / KYC vendor (Persona, Stripe Identity) for
  high-dollar or disputed-risk contracts. Pluggable.

## Phased plan

- **Phase A — evidence backbone (clean-room):** the 4 tables, freeze-on-send
  (hash), the audit log, and a Certificate-of-Completion generator. This alone
  makes the *existing* sign stub court-admissible at the baseline tier.
- **Phase B — field placement UI ("the plus"):** snip-styled drag-to-place
  overlay on the contract canvas; wire to `signatureFields`.
- **Phase C — sign ceremony:** flesh out `/sign/$token` with consent + draw/type
  signature + field fill + audit capture. (Route exists; currently a stub.)
- **Phase D — OTP identity** (email code first, SMS via Twilio later).
- **Phase E — signed-PDF + certificate render** to R2; verification endpoint.
- **Phase F (optional) — Documenso Cloud API** as an alternative backend if you'd
  rather outsource the ceremony than maintain it.

## Decisions needed from you
1. **Licensing path:** Documenso *hosted API* (fast, check terms) vs **clean-room**
   (no AGPL, more build). Recommendation: clean-room for the evidence backbone
   (Phase A–C) — it's not that much code and avoids all AGPL risk; revisit hosted
   only if you want to skip maintaining the ceremony.
2. **Identity tier** to ship first (recommend Standard = email + OTP).
3. **PDF generation** lib (server-side) for the signed output + certificate.

## What was already built (multi-contract path) — corrected
The `contractsTable` system is NOT a stub. It already has the full
Documenso-equivalent flow: recipients (`addRecipient`), field placement
(`addField`/`updateField` — the "+"), `sendForSignature`, public `sign`/`decline`
by token, `recordSigningView`, and a full append-only `contractAuditEvents` log
with signature image + typed name. The **multi-contract editor**
(`$teamSlug.$projectId.contract.$contractId.tsx`) renders the recipient + field
+ send UI; `app/routes/sign.$token.tsx` is the working signing ceremony. The user
hit "can't press plus" because they were on the **legacy single-contract wizard**
(`project.contract`), whose signing IS a stub. New contracts (via "Add contract")
now land in the real multi-contract editor.

## Built this pass (court-admissibility, typecheck clean)
- **Freeze + SHA-256 hash on send** (`sendForSignature`): snapshots
  `frozenContentHtml` + `contentHash`; audit records the hash. Tamper-evidence +
  association-with-record. (schema: `contracts.frozenContentHtml`, `contentHash`.)
- **ESIGN consent**: `sign` now hard-requires `consented`, records
  `contractRecipients.consentedAt` + a `"consented"` audit event; the sign page
  shows explicit E-SIGN/UETA disclosure (electronic consent, recorded IP/time,
  right to paper) gating the button.
- **Certificate of Completion**: `contractsTable.getCertificate` returns the full
  evidence record (hash, per-signer name/email/method/timestamps/consent/IP/UA,
  complete audit trail). Re-hash `frozenContentHtml` vs `contentHash` to verify.

## Built (round 2 — court-grade hardening, typecheck+codegen clean, NOT live-tested)
- **#1 Server-authoritative IP** — `convex/http.ts` now has `/contracts/sign`,
  `/sign-view`, `/sign-decline`, `/sign-otp` httpActions that read the real IP
  (`cf-connecting-ip`/`x-forwarded-for`/`x-real-ip`) + UA. `sign`/`recordSigningView`/
  `decline` are now **internalMutation** (the HTTP actions are the only way in), so
  IP can't be client-spoofed. The sign page POSTs to `${VITE_CONVEX_URL→.site}`.
  CORS + OPTIONS handled.
- **#5 OTP identity tier** — `issueSignOtp` (mutation, hashed code) + `email.sendContractOtp`
  (Resend); sign page has "Email me a code" → enter code; `sign` requires a matching,
  unexpired code when one was issued, then burns it. Schema: `contractRecipients.otpCodeHash/otpExpiresAt`.
- **#2 Signed package to R2** — on completion, `contractSigning.finalizeSignedPackage`
  (use-node action) renders a self-contained HTML package (frozen body + signature
  blocks + Certificate-of-Completion audit table + content hash) to
  `contracts/<id>/signed-package.html`; `getSignedPackageUrl` serves a member-gated
  link. Schema: `contracts.signedPackageS3Key`. (True server-rendered PDF still
  needs a renderer — HTML is printable to PDF meanwhile.)
- **#4 Legacy stub retired** — `projects.startSignableContract` creates a REAL
  `contracts` row from the embedded `project.contract`; `ContractShareDialog`'s
  "Set up signing" (and the old demo-sign) now bridge into the multi-contract
  signing editor. The `signContractDemo` fake stamp is no longer reachable from the dialog.

## Remaining
- **#3 Drag field-placement on the rendered document** (explicitly v3; backend
  `addField`/`updateField` with normalized x/y already exist — needs a rendered-doc
  coordinate surface + live testing; not shipped blind).
- **Live end-to-end test** of the whole ceremony (OTP email needs RESEND_API_KEY;
  IP needs a real request through the .site origin) against a data-having deployment.
- True **server-rendered PDF** (vs the HTML package) if a renderer is added.
- Retire the remaining legacy `signContractDemo`/`sendContractForSignature` mutations
  + any legacy editor buttons still referencing them.
