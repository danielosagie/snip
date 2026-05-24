import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { identityName, requireProjectAccess, requireUser } from "./auth";
import { generateUniqueToken } from "./security";

/**
 * Multi-contract management. Replaces the singleton `projects.contract`
 * embedded field with a table of contracts, each with its own
 * recipients + fields + audit log. Documenso-equivalent signing flow
 * is implemented natively here — no external API calls. See the
 * schema notes on `contracts`, `contractRecipients`, `contractFields`
 * and `contractAuditEvents` for the data model.
 *
 * Status state machine:
 *   draft → pending → completed
 *                  ↘ declined
 *                  ↘ voided
 *                  ↘ expired
 *
 * Transitions are enforced by the mutations below — the UI never
 * patches `status` directly.
 */

// ─── Helpers ─────────────────────────────────────────────────────────

const SIGNING_TOKEN_LENGTH = 24;

// SHA-256 hex of the frozen contract body — the tamper-evidence anchor. Uses
// the Web Crypto API available in the Convex runtime; deterministic, so safe in
// a mutation. Anyone can re-hash the stored body and compare to prove integrity.
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function appendAudit(
  ctx: MutationCtx,
  args: {
    contractId: Id<"contracts">;
    recipientId?: Id<"contractRecipients">;
    action: Doc<"contractAuditEvents">["action"];
    actorName?: string;
    actorEmail?: string;
    ip?: string;
    userAgent?: string;
    metadata?: string;
  },
) {
  await ctx.db.insert("contractAuditEvents", {
    contractId: args.contractId,
    recipientId: args.recipientId,
    action: args.action,
    actorName: args.actorName,
    actorEmail: args.actorEmail,
    ip: args.ip,
    userAgent: args.userAgent,
    metadata: args.metadata,
    createdAt: Date.now(),
  });
}

async function requireContractAccess(
  ctx: MutationCtx | QueryCtx,
  contractId: Id<"contracts">,
  role: "viewer" | "member" | "admin" | "owner" = "member",
) {
  const contract = await ctx.db.get(contractId);
  if (!contract) {
    throw new Error("Contract not found.");
  }
  await requireProjectAccess(ctx as MutationCtx, contract.projectId, role);
  return contract;
}

// ─── Queries ─────────────────────────────────────────────────────────

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, "viewer");
    const rows = await ctx.db
      .query("contracts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const visible = rows.filter((r) => !r.deletedAt);
    visible.sort((a, b) => b._creationTime - a._creationTime);

    // Attach recipient counts so the list UI can render the signer
    // pill without an N+1 round trip.
    const withCounts = await Promise.all(
      visible.map(async (contract) => {
        const recipients = await ctx.db
          .query("contractRecipients")
          .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
          .collect();
        const signedCount = recipients.filter((r) => r.status === "signed").length;
        return {
          ...contract,
          recipientCount: recipients.length,
          signedCount,
        };
      }),
    );
    return withCounts;
  },
});

export const get = query({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, args) => {
    const contract = await requireContractAccess(ctx, args.contractId, "viewer");
    const [recipients, fields, audit] = await Promise.all([
      ctx.db
        .query("contractRecipients")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect(),
      ctx.db
        .query("contractFields")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect(),
      ctx.db
        .query("contractAuditEvents")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect(),
    ]);
    recipients.sort((a, b) => a.order - b.order);
    audit.sort((a, b) => a.createdAt - b.createdAt);
    return { contract, recipients, fields, audit };
  },
});

/**
 * Public query for the signing page. Looks the contract up by the
 * opaque token on a recipient row — no auth needed because the token
 * IS the auth. Returns minimal fields (no audit log, no other
 * recipients' tokens) to avoid leaking data to the signer.
 */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const recipient = await ctx.db
      .query("contractRecipients")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!recipient) return null;
    const contract = await ctx.db.get(recipient.contractId);
    if (!contract || contract.deletedAt) return null;
    if (contract.status !== "pending") {
      return {
        recipient,
        contract,
        fields: [],
        finalStatus: contract.status,
      };
    }
    if (recipient.tokenExpiresAt < Date.now()) {
      return { recipient, contract, fields: [], finalStatus: "expired" as const };
    }
    const fields = await ctx.db
      .query("contractFields")
      .withIndex("by_recipient", (q) => q.eq("recipientId", recipient._id))
      .collect();
    return { recipient, contract, fields, finalStatus: null };
  },
});

// ─── Mutations: contract CRUD ────────────────────────────────────────

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    kind: v.union(
      v.literal("master"),
      v.literal("sow"),
      v.literal("nda"),
      v.literal("release"),
      v.literal("custom"),
    ),
    contentHtml: v.optional(v.string()),
  },
  returns: v.id("contracts"),
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectAccess(ctx, args.projectId, "member");

    const contractId = await ctx.db.insert("contracts", {
      projectId: args.projectId,
      teamId: project.teamId,
      title: args.title,
      kind: args.kind,
      contentHtml: args.contentHtml ?? "",
      status: "draft",
      createdByClerkId: user.subject,
      createdByName: identityName(user),
      lastSavedAt: Date.now(),
    });

    await appendAudit(ctx, {
      contractId,
      action: "created",
      actorName: identityName(user),
      actorEmail: typeof user.email === "string" ? user.email : undefined,
    });

    return contractId;
  },
});

export const update = mutation({
  args: {
    contractId: v.id("contracts"),
    title: v.optional(v.string()),
    contentHtml: v.optional(v.string()),
    priceCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    deadline: v.optional(v.string()),
    clientName: v.optional(v.string()),
    clientEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const contract = await requireContractAccess(ctx, args.contractId, "member");
    if (contract.status !== "draft") {
      throw new Error("Only draft contracts can be edited.");
    }
    const patch: Partial<Doc<"contracts">> = { lastSavedAt: Date.now() };
    if (args.title !== undefined) patch.title = args.title;
    if (args.contentHtml !== undefined) patch.contentHtml = args.contentHtml;
    if (args.priceCents !== undefined) patch.priceCents = args.priceCents;
    if (args.currency !== undefined) patch.currency = args.currency;
    if (args.deadline !== undefined) patch.deadline = args.deadline;
    if (args.clientName !== undefined) patch.clientName = args.clientName;
    if (args.clientEmail !== undefined) patch.clientEmail = args.clientEmail;
    await ctx.db.patch(args.contractId, patch);
  },
});

export const softDelete = mutation({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, args) => {
    const contract = await requireContractAccess(ctx, args.contractId, "admin");
    if (contract.status === "pending") {
      throw new Error(
        "Void the contract before deleting — recipients have outstanding signing links.",
      );
    }
    await ctx.db.patch(args.contractId, { deletedAt: Date.now() });
  },
});

// ─── Recipients ──────────────────────────────────────────────────────

export const addRecipient = mutation({
  args: {
    contractId: v.id("contracts"),
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("signer"),
      v.literal("approver"),
      v.literal("viewer"),
      v.literal("cc"),
    ),
  },
  returns: v.id("contractRecipients"),
  handler: async (ctx, args) => {
    const contract = await requireContractAccess(ctx, args.contractId, "member");
    if (contract.status !== "draft") {
      throw new Error("Recipients can only be added to draft contracts.");
    }
    const existing = await ctx.db
      .query("contractRecipients")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
      .collect();
    const nextOrder = existing.length + 1;
    // Token is placeholder until `sendForSignature` runs. We still
    // generate a unique one now so the field stays NOT NULL.
    const token = await generateUniqueToken(SIGNING_TOKEN_LENGTH, async (t) => {
      const hit = await ctx.db
        .query("contractRecipients")
        .withIndex("by_token", (q) => q.eq("token", t))
        .unique();
      return hit !== null;
    });
    return await ctx.db.insert("contractRecipients", {
      contractId: args.contractId,
      projectId: contract.projectId,
      name: args.name,
      email: args.email,
      role: args.role,
      order: nextOrder,
      token,
      tokenExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      status: "pending",
    });
  },
});

export const removeRecipient = mutation({
  args: { recipientId: v.id("contractRecipients") },
  handler: async (ctx, args) => {
    const recipient = await ctx.db.get(args.recipientId);
    if (!recipient) throw new Error("Recipient not found.");
    const contract = await requireContractAccess(ctx, recipient.contractId, "member");
    if (contract.status !== "draft") {
      throw new Error("Recipients can only be removed from draft contracts.");
    }
    await ctx.db.delete(args.recipientId);
    // Compact the order numbers.
    const remaining = await ctx.db
      .query("contractRecipients")
      .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
      .collect();
    remaining.sort((a, b) => a.order - b.order);
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].order !== i + 1) {
        await ctx.db.patch(remaining[i]._id, { order: i + 1 });
      }
    }
  },
});

// ─── Fields ──────────────────────────────────────────────────────────

const FIELD_TYPES = [
  "signature",
  "initials",
  "date",
  "text",
  "checkbox",
  "name",
  "email",
] as const;

const fieldTypeValidator = v.union(
  ...FIELD_TYPES.map((t) => v.literal(t)),
);

export const addField = mutation({
  args: {
    contractId: v.id("contracts"),
    recipientId: v.id("contractRecipients"),
    type: fieldTypeValidator,
    pageIndex: v.optional(v.number()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    required: v.optional(v.boolean()),
  },
  returns: v.id("contractFields"),
  handler: async (ctx, args) => {
    const contract = await requireContractAccess(ctx, args.contractId, "member");
    if (contract.status !== "draft") {
      throw new Error("Fields can only be edited on draft contracts.");
    }
    const recipient = await ctx.db.get(args.recipientId);
    if (!recipient || recipient.contractId !== args.contractId) {
      throw new Error("Recipient does not belong to this contract.");
    }
    return await ctx.db.insert("contractFields", {
      contractId: args.contractId,
      recipientId: args.recipientId,
      type: args.type,
      pageIndex: args.pageIndex ?? 0,
      // Defaults are sensible centered-bottom for a signature-shaped
      // field; the future drag-on-PDF editor will overwrite these.
      x: args.x ?? 0.1,
      y: args.y ?? 0.85,
      width: args.width ?? 0.3,
      height: args.height ?? 0.06,
      required: args.required ?? true,
    });
  },
});

export const updateField = mutation({
  args: {
    fieldId: v.id("contractFields"),
    pageIndex: v.optional(v.number()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    required: v.optional(v.boolean()),
    type: v.optional(fieldTypeValidator),
    recipientId: v.optional(v.id("contractRecipients")),
  },
  handler: async (ctx, args) => {
    const field = await ctx.db.get(args.fieldId);
    if (!field) throw new Error("Field not found.");
    const contract = await requireContractAccess(ctx, field.contractId, "member");
    if (contract.status !== "draft") {
      throw new Error("Fields can only be edited on draft contracts.");
    }
    if (args.recipientId) {
      const newRecipient = await ctx.db.get(args.recipientId);
      if (!newRecipient || newRecipient.contractId !== field.contractId) {
        throw new Error("Target recipient does not belong to this contract.");
      }
    }
    const patch: Partial<Doc<"contractFields">> = {};
    if (args.pageIndex !== undefined) patch.pageIndex = args.pageIndex;
    if (args.x !== undefined) patch.x = args.x;
    if (args.y !== undefined) patch.y = args.y;
    if (args.width !== undefined) patch.width = args.width;
    if (args.height !== undefined) patch.height = args.height;
    if (args.required !== undefined) patch.required = args.required;
    if (args.type !== undefined) patch.type = args.type;
    if (args.recipientId !== undefined) patch.recipientId = args.recipientId;
    await ctx.db.patch(args.fieldId, patch);
  },
});

export const removeField = mutation({
  args: { fieldId: v.id("contractFields") },
  handler: async (ctx, args) => {
    const field = await ctx.db.get(args.fieldId);
    if (!field) return;
    const contract = await requireContractAccess(ctx, field.contractId, "member");
    if (contract.status !== "draft") {
      throw new Error("Fields can only be edited on draft contracts.");
    }
    await ctx.db.delete(args.fieldId);
  },
});

// ─── State machine: send for signature ───────────────────────────────

export const sendForSignature = mutation({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, args) => {
    const contract = await requireContractAccess(ctx, args.contractId, "member");
    if (contract.status !== "draft") {
      throw new Error("Only draft contracts can be sent.");
    }
    const user = await requireUser(ctx);
    const recipients = await ctx.db
      .query("contractRecipients")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
      .collect();
    const signers = recipients.filter((r) => r.role === "signer");
    if (signers.length === 0) {
      throw new Error("Add at least one signer before sending.");
    }

    const now = Date.now();
    // Freeze the exact body the recipients will sign + hash it. This is the
    // record they're bound to; the hash makes any later edit detectable.
    const frozenContentHtml = contract.contentHtml;
    const contentHash = await sha256Hex(frozenContentHtml);
    await ctx.db.patch(args.contractId, {
      status: "pending",
      sentForSignatureAt: now,
      frozenContentHtml,
      contentHash,
      // 30 days to sign by default.
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
    });
    await appendAudit(ctx, {
      contractId: args.contractId,
      action: "sent",
      actorName: identityName(user),
      actorEmail: typeof user.email === "string" ? user.email : undefined,
      metadata: JSON.stringify({
        recipientCount: recipients.length,
        contentHash,
        hashAlgorithm: "SHA-256",
      }),
    });
    return { ok: true, contentHash };
  },
});

export const voidContract = mutation({
  args: { contractId: v.id("contracts"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const contract = await requireContractAccess(ctx, args.contractId, "admin");
    if (contract.status !== "pending") {
      throw new Error("Only pending contracts can be voided.");
    }
    const user = await requireUser(ctx);
    await ctx.db.patch(args.contractId, { status: "voided" });
    await appendAudit(ctx, {
      contractId: args.contractId,
      action: "voided",
      actorName: identityName(user),
      metadata: args.reason ? JSON.stringify({ reason: args.reason }) : undefined,
    });
  },
});

// ─── State machine: sign / decline (public, token-authed) ────────────

// Internal: only callable via the /contracts/sign-view HTTP action, which
// injects the server-observed IP. Keeping it internal means a client can't
// self-report (spoof) its IP — court-grade attribution.
export const recordSigningView = internalMutation({
  args: {
    token: v.string(),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const recipient = await ctx.db
      .query("contractRecipients")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!recipient) return;
    if (recipient.status === "pending") {
      await ctx.db.patch(recipient._id, {
        status: "viewed",
        viewedAt: Date.now(),
      });
      await appendAudit(ctx, {
        contractId: recipient.contractId,
        recipientId: recipient._id,
        action: "viewed",
        actorName: recipient.name,
        actorEmail: recipient.email,
        ip: args.ip,
        userAgent: args.userAgent,
      });
    }
  },
});

// Issue a one-time email code for identity verification. Internal — called by
// the /contracts/sign-otp HTTP action, which then emails the plaintext code.
// Returns the code to the HTTP action (server-side only); we store only its
// hash. Randomness is deterministic-per-execution in Convex, so this is safe in
// a mutation.
export const issueSignOtp = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      code: v.string(),
      email: v.string(),
      name: v.string(),
      contractTitle: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const recipient = await ctx.db
      .query("contractRecipients")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!recipient) return null;
    if (recipient.status === "signed" || recipient.status === "declined") {
      return null;
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const otpCodeHash = await sha256Hex(`${args.token}:${code}`);
    await ctx.db.patch(recipient._id, {
      otpCodeHash,
      otpExpiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });
    const contract = await ctx.db.get(recipient.contractId);
    return {
      code,
      email: recipient.email,
      name: recipient.name,
      contractTitle: contract?.title ?? "your contract",
    };
  },
});

// Internal: only callable via the /contracts/sign HTTP action (server IP).
export const sign = internalMutation({
  args: {
    token: v.string(),
    signatureDataUrl: v.optional(v.string()),
    typedSignatureName: v.optional(v.string()),
    // ESIGN/UETA: the signer must affirmatively consent to do business
    // electronically BEFORE the signature is binding. The sign page gates the
    // button on this; we hard-require it server-side too.
    consented: v.boolean(),
    // Email OTP — required for identity verification only when one was issued
    // for this recipient (requestSignOtp). Optional otherwise.
    otpCode: v.optional(v.string()),
    fieldValues: v.optional(
      v.array(v.object({ fieldId: v.id("contractFields"), value: v.string() })),
    ),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const recipient = await ctx.db
      .query("contractRecipients")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!recipient) throw new Error("Invalid signing link.");
    if (recipient.tokenExpiresAt < Date.now()) {
      throw new Error("This signing link has expired.");
    }
    if (recipient.status === "signed") {
      throw new Error("This contract has already been signed by this recipient.");
    }
    if (recipient.status === "declined") {
      throw new Error("This contract was declined.");
    }
    if (!args.consented) {
      throw new Error(
        "You must consent to sign electronically before signing.",
      );
    }
    // Identity verification: if an OTP was issued for this recipient, it must be
    // presented + valid + unexpired before we accept the signature.
    if (recipient.otpCodeHash) {
      if (!args.otpCode) {
        throw new Error("Enter the verification code emailed to you.");
      }
      if ((recipient.otpExpiresAt ?? 0) < Date.now()) {
        throw new Error("Your verification code expired. Request a new one.");
      }
      const presentedHash = await sha256Hex(`${args.token}:${args.otpCode.trim()}`);
      if (presentedHash !== recipient.otpCodeHash) {
        throw new Error("That verification code is incorrect.");
      }
    }
    if (!args.signatureDataUrl && !args.typedSignatureName) {
      throw new Error("Either a drawn signature or a typed name is required.");
    }

    const contract = await ctx.db.get(recipient.contractId);
    if (!contract) throw new Error("Contract not found.");
    if (contract.status !== "pending") {
      throw new Error("This contract is not awaiting signature.");
    }

    const now = Date.now();
    await ctx.db.patch(recipient._id, {
      status: "signed",
      signedAt: now,
      consentedAt: now,
      signatureDataUrl: args.signatureDataUrl,
      typedSignatureName: args.typedSignatureName,
      signedIp: args.ip,
      signedUserAgent: args.userAgent,
      // Burn the one-time code so it can't be reused.
      otpCodeHash: undefined,
      otpExpiresAt: undefined,
    });
    // Record consent as its own audit event (the ESIGN affirmative act),
    // immediately before the signature event.
    await appendAudit(ctx, {
      contractId: recipient.contractId,
      recipientId: recipient._id,
      action: "consented",
      actorName: recipient.name,
      actorEmail: recipient.email,
      ip: args.ip,
      userAgent: args.userAgent,
      metadata: JSON.stringify({ contentHash: contract.contentHash ?? null }),
    });

    // Persist any field values the signer filled in.
    if (args.fieldValues) {
      for (const fv of args.fieldValues) {
        const field = await ctx.db.get(fv.fieldId);
        if (!field || field.recipientId !== recipient._id) continue;
        await ctx.db.patch(fv.fieldId, { value: fv.value });
        await appendAudit(ctx, {
          contractId: recipient.contractId,
          recipientId: recipient._id,
          action: "field_filled",
          actorName: recipient.name,
          actorEmail: recipient.email,
          ip: args.ip,
          userAgent: args.userAgent,
          metadata: JSON.stringify({ fieldId: fv.fieldId, fieldType: field.type }),
        });
      }
    }

    await appendAudit(ctx, {
      contractId: recipient.contractId,
      recipientId: recipient._id,
      action: "signed",
      actorName: recipient.name,
      actorEmail: recipient.email,
      ip: args.ip,
      userAgent: args.userAgent,
    });

    // Check whether ALL signers have now signed. Approvers are
    // optional gates; viewers/cc are notification-only.
    const allRecipients = await ctx.db
      .query("contractRecipients")
      .withIndex("by_contract", (q) => q.eq("contractId", recipient.contractId))
      .collect();
    const signersDone = allRecipients
      .filter((r) => r.role === "signer")
      .every((r) => r.status === "signed");
    const approversDone = allRecipients
      .filter((r) => r.role === "approver")
      .every((r) => r.status === "signed" || r.status === "declined");
    if (signersDone && approversDone) {
      await ctx.db.patch(recipient.contractId, {
        status: "completed",
        completedAt: now,
      });
      await appendAudit(ctx, {
        contractId: recipient.contractId,
        action: "completed",
      });
      // Render + store the self-contained signed package (HTML) in R2.
      await ctx.scheduler.runAfter(
        0,
        internal.contractSigning.finalizeSignedPackage,
        { contractId: recipient.contractId },
      );
    }
    return { completed: signersDone && approversDone };
  },
});

// Internal: only callable via the /contracts/sign-decline HTTP action (server IP).
export const decline = internalMutation({
  args: {
    token: v.string(),
    reason: v.optional(v.string()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const recipient = await ctx.db
      .query("contractRecipients")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!recipient) throw new Error("Invalid signing link.");
    if (recipient.status === "signed" || recipient.status === "declined") {
      throw new Error("This recipient has already responded.");
    }
    const contract = await ctx.db.get(recipient.contractId);
    if (!contract || contract.status !== "pending") {
      throw new Error("This contract is no longer accepting responses.");
    }
    await ctx.db.patch(recipient._id, {
      status: "declined",
      signedIp: args.ip,
      signedUserAgent: args.userAgent,
    });
    await ctx.db.patch(recipient.contractId, { status: "declined" });
    await appendAudit(ctx, {
      contractId: recipient.contractId,
      recipientId: recipient._id,
      action: "declined",
      actorName: recipient.name,
      actorEmail: recipient.email,
      ip: args.ip,
      userAgent: args.userAgent,
      metadata: args.reason ? JSON.stringify({ reason: args.reason }) : undefined,
    });
  },
});

// ─── Certificate of Completion (court-admissible evidence record) ────

/**
 * The defensible artifact for litigation: who signed, when (UTC), from what IP +
 * user agent, by what method, with explicit ESIGN consent, against which
 * document hash, plus the full timestamped audit trail. Member-gated read.
 * `contentHash` lets anyone re-hash `frozenContentHtml` to prove the signed body
 * was never altered. Render to PDF for the signed package (follow-up).
 */
export const getCertificate = query({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, args) => {
    const contract = await requireContractAccess(ctx, args.contractId);
    const [recipients, audit] = await Promise.all([
      ctx.db
        .query("contractRecipients")
        .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
        .collect(),
      ctx.db
        .query("contractAuditEvents")
        .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
        .collect(),
    ]);
    recipients.sort((a, b) => a.order - b.order);
    audit.sort((a, b) => a.createdAt - b.createdAt);
    return {
      contract: {
        _id: contract._id,
        title: contract.title,
        status: contract.status,
        sentForSignatureAt: contract.sentForSignatureAt ?? null,
        completedAt: contract.completedAt ?? null,
        contentHash: contract.contentHash ?? null,
        hashAlgorithm: contract.contentHash ? ("SHA-256" as const) : null,
        frozenContentHtml: contract.frozenContentHtml ?? null,
      },
      signers: recipients.map((r) => ({
        name: r.name,
        email: r.email,
        role: r.role,
        status: r.status,
        viewedAt: r.viewedAt ?? null,
        consentedAt: r.consentedAt ?? null,
        signedAt: r.signedAt ?? null,
        ip: r.signedIp ?? null,
        userAgent: r.signedUserAgent ?? null,
        signatureMethod: r.signatureDataUrl
          ? ("drawn" as const)
          : r.typedSignatureName
            ? ("typed" as const)
            : null,
        typedSignatureName: r.typedSignatureName ?? null,
      })),
      auditTrail: audit.map((e) => ({
        action: e.action,
        actorName: e.actorName ?? null,
        actorEmail: e.actorEmail ?? null,
        ip: e.ip ?? null,
        userAgent: e.userAgent ?? null,
        at: e.createdAt,
        metadata: e.metadata ?? null,
      })),
    };
  },
});

// ─── Signed package (HTML to R2) ─────────────────────────────────────

// Internal data feed for the finalize action (no auth — action-only). Returns
// everything needed to render the self-contained signed package.
export const getSignedPackageData = internalQuery({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, args) => {
    const contract = await ctx.db.get(args.contractId);
    if (!contract) return null;
    const [recipients, audit] = await Promise.all([
      ctx.db
        .query("contractRecipients")
        .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
        .collect(),
      ctx.db
        .query("contractAuditEvents")
        .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
        .collect(),
    ]);
    recipients.sort((a, b) => a.order - b.order);
    audit.sort((a, b) => a.createdAt - b.createdAt);
    return {
      title: contract.title,
      contentHash: contract.contentHash ?? null,
      completedAt: contract.completedAt ?? null,
      frozenContentHtml: contract.frozenContentHtml ?? contract.contentHtml,
      signers: recipients.map((r) => ({
        name: r.name,
        email: r.email,
        role: r.role,
        status: r.status,
        signedAt: r.signedAt ?? null,
        consentedAt: r.consentedAt ?? null,
        ip: r.signedIp ?? null,
        userAgent: r.signedUserAgent ?? null,
        typedSignatureName: r.typedSignatureName ?? null,
        signatureDataUrl: r.signatureDataUrl ?? null,
      })),
      audit: audit.map((e) => ({
        action: e.action,
        actorName: e.actorName ?? null,
        ip: e.ip ?? null,
        at: e.createdAt,
        metadata: e.metadata ?? null,
      })),
    };
  },
});

export const setSignedPackageKey = internalMutation({
  args: { contractId: v.id("contracts"), key: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.contractId, { signedPackageS3Key: args.key });
  },
});

// Member-gated: resolve the signed package's R2 key for a download link.
export const getSignedPackageKey = query({
  args: { contractId: v.id("contracts") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const contract = await requireContractAccess(ctx, args.contractId);
    return contract.signedPackageS3Key ?? null;
  },
});

// ─── Backfill (one-off) ──────────────────────────────────────────────

/**
 * One-off backfill: copies every project's embedded `projects.contract`
 * into a new `contracts` row so existing data is reachable through the
 * new multi-contract UI. Leaves the embedded copy intact for one
 * release as a safety net.
 *
 * Run with `npx convex run contractsTable:backfillFromEmbedded`.
 */
export const backfillFromEmbedded = internalMutation({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    let copied = 0;
    for (const project of projects) {
      const embedded = project.contract;
      if (!embedded || !embedded.contentHtml) continue;
      // Skip if the new table already has a contract for this project.
      const existing = await ctx.db
        .query("contracts")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      if (existing.length > 0) continue;

      // Map the embedded signing state onto the new state machine:
      //   signedAt set       → completed
      //   sentForSignatureAt → pending
      //   otherwise          → draft
      let status: Doc<"contracts">["status"] = "draft";
      if (embedded.signedAt) status = "completed";
      else if (embedded.sentForSignatureAt) status = "pending";

      await ctx.db.insert("contracts", {
        projectId: project._id,
        teamId: project.teamId,
        title: `${project.name} — contract`,
        kind: "master",
        contentHtml: embedded.contentHtml,
        clauses: embedded.clauses,
        projectType: embedded.projectType,
        wizardAnswers: embedded.wizardAnswers,
        priceCents: embedded.priceCents,
        currency: embedded.currency,
        deadline: embedded.deadline,
        clientName: embedded.clientName,
        clientEmail: embedded.clientEmail,
        docxS3Key: embedded.docxS3Key,
        originalFilename: embedded.originalFilename,
        lastSavedAt: embedded.lastSavedAt,
        signablePdfS3Key: undefined,
        signedPdfS3Key: undefined,
        status,
        sentForSignatureAt: embedded.sentForSignatureAt,
        completedAt: embedded.signedAt,
        createdByClerkId: "system:backfill",
        createdByName: "Migration",
      });
      copied++;
    }
    return { copied };
  },
});
