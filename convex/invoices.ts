import { v } from "convex/values";
import { identityName, requireTeamAccess } from "./auth";
import { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { deriveInvoiceStatus } from "./invoicePolicy";
import {
  computeApplicationFee,
  computeBuyerTotal,
  MAX_LINE_ITEM_AMOUNT_CENTS,
} from "./paymentsPolicy";
import { generateUniqueToken } from "./security";

const MAX_MILESTONES = 50;
const MAX_TITLE_LENGTH = 200;
const MAX_LABEL_LENGTH = 160;
const MAX_NOTE_LENGTH = 5_000;
const PAY_TOKEN_LENGTH = 32;

const milestoneInputValidator = v.object({
  id: v.string(),
  label: v.string(),
  amountCents: v.number(),
  dueAt: v.optional(v.number()),
});

const clientInvoiceValidator = v.union(
  v.null(),
  v.object({
    title: v.string(),
    clientLabel: v.optional(v.string()),
    note: v.optional(v.string()),
    currency: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("partially_paid"),
      v.literal("paid"),
      v.literal("void"),
    ),
    sentAt: v.number(),
    milestones: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        amountCents: v.number(),
        dueAt: v.optional(v.number()),
        paidAt: v.optional(v.number()),
        feeCents: v.optional(v.number()),
        buyerTotalCents: v.optional(v.number()),
      }),
    ),
  }),
);

type MilestoneInput = {
  id: string;
  label: string;
  amountCents: number;
  dueAt?: number;
  paidAt?: number;
};

function normalizeText(
  value: string,
  field: string,
  maxLength: number,
): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  if (normalized.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new Error(`Text must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Enter a valid client email address.");
  }
  return email;
}

function requireUsd(currency: string | undefined): "usd" {
  if ((currency ?? "usd").trim().toLowerCase() !== "usd") {
    throw new Error("Invoices currently support USD only.");
  }
  return "usd";
}

function normalizeMilestones(milestones: MilestoneInput[]): MilestoneInput[] {
  if (milestones.length === 0 || milestones.length > MAX_MILESTONES) {
    throw new Error(`Invoices require 1 to ${MAX_MILESTONES} milestones.`);
  }

  const ids = new Set<string>();
  return milestones.map((milestone) => {
    const id = normalizeText(milestone.id, "Milestone id", 100);
    if (ids.has(id)) throw new Error("Milestone ids must be unique.");
    ids.add(id);
    if (
      !Number.isSafeInteger(milestone.amountCents) ||
      milestone.amountCents <= 0 ||
      milestone.amountCents > MAX_LINE_ITEM_AMOUNT_CENTS
    ) {
      throw new Error(
        `Milestone amounts must be positive integer cents up to ${MAX_LINE_ITEM_AMOUNT_CENTS}.`,
      );
    }
    if (
      milestone.dueAt !== undefined &&
      (!Number.isSafeInteger(milestone.dueAt) || milestone.dueAt <= 0)
    ) {
      throw new Error("Milestone due dates must be positive integer timestamps.");
    }
    return {
      id,
      label: normalizeText(milestone.label, "Milestone label", MAX_LABEL_LENGTH),
      amountCents: milestone.amountCents,
      dueAt: milestone.dueAt,
    };
  });
}

function isValidMilestoneAmount(amountCents: number): boolean {
  return (
    Number.isSafeInteger(amountCents) &&
    amountCents > 0 &&
    amountCents <= MAX_LINE_ITEM_AMOUNT_CENTS
  );
}

async function resolveShareLinkProject(
  ctx: QueryCtx | MutationCtx,
  shareLinkId: Id<"shareLinks">,
): Promise<{ teamId: Id<"teams">; projectId: Id<"projects"> }> {
  const link = await ctx.db.get(shareLinkId);
  if (!link) throw new Error("Share link not found.");

  let projectId: Id<"projects"> | undefined;
  if (link.videoId) {
    const video = await ctx.db.get(link.videoId);
    projectId = video?.projectId;
  } else if (link.bundleId) {
    const bundle = await ctx.db.get(link.bundleId);
    projectId = bundle?.projectId;
  }
  if (!projectId) throw new Error("Share link target not found.");
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("Share link project not found.");
  return { teamId: project.teamId, projectId };
}

async function validateInvoiceReferences(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<"teams">,
  projectId?: Id<"projects">,
  shareLinkId?: Id<"shareLinks">,
) {
  if (projectId) {
    const project = await ctx.db.get(projectId);
    if (!project || project.teamId !== teamId) {
      throw new Error("Project does not belong to this team.");
    }
  }
  if (shareLinkId) {
    const resolved = await resolveShareLinkProject(ctx, shareLinkId);
    if (resolved.teamId !== teamId) {
      throw new Error("Share link does not belong to this team.");
    }
    if (projectId && resolved.projectId !== projectId) {
      throw new Error("Share link does not belong to the invoice project.");
    }
  }
}

function statusFor(invoice: Pick<Doc<"invoices">, "milestones" | "sentAt" | "voidedAt">) {
  return deriveInvoiceStatus(invoice);
}

type PayTokenInvoiceSource = {
  payToken?: string;
  title: string;
  clientLabel?: string;
  note?: string;
  currency: string;
  status: Doc<"invoices">["status"];
  sentAt?: number;
  voidedAt?: number;
  milestones: Array<{
    id: string;
    label: string;
    amountCents: number;
    dueAt?: number;
    paidAt?: number;
    stripeCheckoutSessionId?: string;
    stripePaymentIntentId?: string;
  }>;
};

export function projectInvoiceForPayToken(
  invoice: PayTokenInvoiceSource | null,
  payToken: string,
) {
  if (
    !invoice ||
    invoice.sentAt === undefined ||
    invoice.voidedAt !== undefined ||
    invoice.status === "void" ||
    invoice.payToken !== payToken
  ) {
    return null;
  }

  return {
    title: invoice.title,
    clientLabel: invoice.clientLabel,
    note: invoice.note,
    currency: invoice.currency,
    status: statusFor(invoice),
    sentAt: invoice.sentAt,
    milestones: invoice.milestones.map((milestone) => ({
      id: milestone.id,
      label: milestone.label,
      amountCents: milestone.amountCents,
      dueAt: milestone.dueAt,
      paidAt: milestone.paidAt,
      ...(milestone.paidAt === undefined
        ? {
            feeCents: computeApplicationFee(milestone.amountCents),
            buyerTotalCents: computeBuyerTotal(milestone.amountCents),
          }
        : {}),
    })),
  };
}

async function generateInvoicePayToken(ctx: MutationCtx) {
  return await generateUniqueToken(
    PAY_TOKEN_LENGTH,
    async (candidate) =>
      (await ctx.db
        .query("invoices")
        .withIndex("by_pay_token", (q) => q.eq("payToken", candidate))
        .unique()) !== null,
    5,
  );
}

export const create = mutation({
  args: {
    teamId: v.id("teams"),
    projectId: v.optional(v.id("projects")),
    shareLinkId: v.optional(v.id("shareLinks")),
    clientEmail: v.string(),
    clientLabel: v.optional(v.string()),
    title: v.string(),
    currency: v.optional(v.string()),
    milestones: v.array(milestoneInputValidator),
    note: v.optional(v.string()),
  },
  returns: v.id("invoices"),
  handler: async (ctx, args): Promise<Id<"invoices">> => {
    const { user } = await requireTeamAccess(ctx, args.teamId, "member");
    await validateInvoiceReferences(
      ctx,
      args.teamId,
      args.projectId,
      args.shareLinkId,
    );
    const milestones = normalizeMilestones(args.milestones);
    return await ctx.db.insert("invoices", {
      teamId: args.teamId,
      projectId: args.projectId,
      shareLinkId: args.shareLinkId,
      createdByClerkId: user.subject,
      createdByName: identityName(user),
      clientEmail: normalizeEmail(args.clientEmail),
      clientLabel: normalizeOptionalText(args.clientLabel, MAX_LABEL_LENGTH),
      title: normalizeText(args.title, "Invoice title", MAX_TITLE_LENGTH),
      currency: requireUsd(args.currency),
      status: deriveInvoiceStatus({ milestones }),
      milestones,
      note: normalizeOptionalText(args.note, MAX_NOTE_LENGTH),
    });
  },
});

export const update = mutation({
  args: {
    invoiceId: v.id("invoices"),
    projectId: v.optional(v.union(v.id("projects"), v.null())),
    shareLinkId: v.optional(v.union(v.id("shareLinks"), v.null())),
    clientEmail: v.optional(v.string()),
    clientLabel: v.optional(v.union(v.string(), v.null())),
    title: v.optional(v.string()),
    currency: v.optional(v.string()),
    milestones: v.optional(v.array(milestoneInputValidator)),
    note: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    await requireTeamAccess(ctx, invoice.teamId, "member");
    if (invoice.voidedAt !== undefined || statusFor(invoice) === "paid") {
      throw new Error("Paid or void invoices cannot be edited.");
    }

    const draft = statusFor(invoice) === "draft";
    const nextProjectId =
      args.projectId === undefined
        ? invoice.projectId
        : (args.projectId ?? undefined);
    const nextShareLinkId =
      args.shareLinkId === undefined
        ? invoice.shareLinkId
        : (args.shareLinkId ?? undefined);
    if (
      !draft &&
      (nextProjectId !== invoice.projectId ||
        nextShareLinkId !== invoice.shareLinkId)
    ) {
      throw new Error("Sent invoice structure is locked.");
    }
    await validateInvoiceReferences(
      ctx,
      invoice.teamId,
      nextProjectId,
      nextShareLinkId,
    );

    let milestones = invoice.milestones;
    if (args.milestones !== undefined) {
      const normalized = normalizeMilestones(args.milestones);
      if (draft) {
        milestones = normalized;
      } else {
        if (
          normalized.length !== invoice.milestones.length ||
          normalized.some(
            (milestone, index) =>
              milestone.id !== invoice.milestones[index]?.id,
          )
        ) {
          throw new Error("Sent invoice milestone structure is locked.");
        }
        milestones = normalized.map((next, index) => {
          const current = invoice.milestones[index]!;
          const changed =
            next.label !== current.label ||
            next.amountCents !== current.amountCents ||
            next.dueAt !== current.dueAt;
          if (current.paidAt !== undefined && changed) {
            throw new Error("Paid milestones cannot be edited.");
          }
          if (current.stripeCheckoutSessionId && changed) {
            throw new Error(
              "A milestone with an active checkout cannot be edited.",
            );
          }
          return {
            ...next,
            paidAt: current.paidAt,
            stripeCheckoutSessionId: current.stripeCheckoutSessionId,
            stripePaymentIntentId: current.stripePaymentIntentId,
          };
        });
      }
    }

    if (!draft && args.currency !== undefined) {
      if (requireUsd(args.currency) !== invoice.currency) {
        throw new Error("Sent invoice currency is locked.");
      }
    }
    const updates: Partial<Doc<"invoices">> = {
      projectId: nextProjectId,
      shareLinkId: nextShareLinkId,
      clientEmail:
        args.clientEmail === undefined
          ? invoice.clientEmail
          : normalizeEmail(args.clientEmail),
      clientLabel:
        args.clientLabel === undefined
          ? invoice.clientLabel
          : normalizeOptionalText(args.clientLabel, MAX_LABEL_LENGTH),
      title:
        args.title === undefined
          ? invoice.title
          : normalizeText(args.title, "Invoice title", MAX_TITLE_LENGTH),
      currency:
        args.currency === undefined ? invoice.currency : requireUsd(args.currency),
      milestones,
      note:
        args.note === undefined
          ? invoice.note
          : normalizeOptionalText(args.note, MAX_NOTE_LENGTH),
    };
    updates.status = deriveInvoiceStatus({
      milestones,
      sentAt: invoice.sentAt,
      voidedAt: invoice.voidedAt,
    });
    await ctx.db.patch(args.invoiceId, updates);
    return null;
  },
});

export const send = mutation({
  args: { invoiceId: v.id("invoices") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    await requireTeamAccess(ctx, invoice.teamId, "member");
    if (invoice.voidedAt !== undefined) throw new Error("Invoice is void.");
    const payToken = invoice.payToken ?? (await generateInvoicePayToken(ctx));
    if (invoice.sentAt !== undefined) {
      if (!invoice.payToken) await ctx.db.patch(args.invoiceId, { payToken });
      return null;
    }
    normalizeMilestones(invoice.milestones);
    const sentAt = Date.now();
    await ctx.db.patch(args.invoiceId, {
      payToken,
      sentAt,
      status: deriveInvoiceStatus({ milestones: invoice.milestones, sentAt }),
    });
    return null;
  },
});

export const revokePayLink = mutation({
  args: { invoiceId: v.id("invoices") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    await requireTeamAccess(ctx, invoice.teamId, "member");
    if (invoice.payToken !== undefined) {
      await ctx.db.patch(args.invoiceId, { payToken: undefined });
    }
    return null;
  },
});

export const voidInvoice = mutation({
  args: { invoiceId: v.id("invoices") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    await requireTeamAccess(ctx, invoice.teamId, "member");
    if (invoice.voidedAt !== undefined) return null;
    if (invoice.milestones.some((milestone) => milestone.paidAt !== undefined)) {
      throw new Error("An invoice with paid milestones cannot be voided.");
    }
    const voidedAt = Date.now();
    await ctx.db.patch(args.invoiceId, { voidedAt, status: "void" });
    return null;
  },
});

export const listByTeam = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await requireTeamAccess(ctx, args.teamId);
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .order("desc")
      .collect();
    return invoices.map((invoice) => ({
      ...invoice,
      status: statusFor(invoice),
    }));
  },
});

export const get = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return null;
    await requireTeamAccess(ctx, invoice.teamId);
    return { ...invoice, status: statusFor(invoice) };
  },
});

export const getByPayToken = query({
  args: { payToken: v.string() },
  returns: clientInvoiceValidator,
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_pay_token", (q) => q.eq("payToken", args.payToken))
      .unique();
    return projectInvoiceForPayToken(invoice, args.payToken);
  },
});

export const lookupMilestoneForCheckout = internalQuery({
  args: { payToken: v.string(), milestoneId: v.string() },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_pay_token", (q) => q.eq("payToken", args.payToken))
      .unique();
    if (!invoice) return null;
    const status = statusFor(invoice);
    if (status !== "sent" && status !== "partially_paid") return null;
    const milestone = invoice.milestones.find(
      (candidate) => candidate.id === args.milestoneId,
    );
    if (
      !milestone ||
      milestone.paidAt !== undefined ||
      !isValidMilestoneAmount(milestone.amountCents) ||
      invoice.currency !== "usd"
    ) {
      return null;
    }
    const team = await ctx.db.get(invoice.teamId);
    if (!team) return null;
    return { invoice, milestone, team };
  },
});

export const recordMilestoneCheckoutCreated = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    milestoneId: v.string(),
    previousCheckoutSessionId: v.optional(v.string()),
    stripeCheckoutSessionId: v.string(),
    stripeConnectAccountId: v.optional(v.string()),
    settlement: v.union(v.literal("connect"), v.literal("platform")),
  },
  returns: v.id("payments"),
  handler: async (ctx, args): Promise<Id<"payments">> => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    const index = invoice.milestones.findIndex(
      (milestone) => milestone.id === args.milestoneId,
    );
    if (index < 0) throw new Error("Milestone not found.");
    const milestone = invoice.milestones[index]!;
    if (milestone.paidAt !== undefined) throw new Error("Milestone is already paid.");
    if (!isValidMilestoneAmount(milestone.amountCents) || invoice.currency !== "usd") {
      throw new Error("Stored milestone amount or currency is invalid.");
    }
    if (milestone.stripeCheckoutSessionId !== args.previousCheckoutSessionId) {
      throw new Error("Milestone checkout changed. Refresh and try again.");
    }
    const status = statusFor(invoice);
    if (status !== "sent" && status !== "partially_paid") {
      throw new Error("Invoice is not payable.");
    }

    const existing = await ctx.db
      .query("payments")
      .withIndex("by_checkout_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId),
      )
      .unique();
    if (existing) return existing._id;

    const applicationFeeAmountCents = computeApplicationFee(
      milestone.amountCents,
    );
    const amountCents = computeBuyerTotal(milestone.amountCents);
    const paymentId = await ctx.db.insert("payments", {
      teamId: invoice.teamId,
      invoiceId: invoice._id,
      milestoneId: milestone.id,
      kind: "invoice_milestone",
      clientEmail: invoice.clientEmail,
      subtotalCents: milestone.amountCents,
      amountCents,
      currency: invoice.currency,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeConnectAccountId: args.stripeConnectAccountId,
      settlement: args.settlement,
      applicationFeeAmountCents,
      status: "pending",
    });
    const milestones = [...invoice.milestones];
    milestones[index] = {
      ...milestone,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
    };
    await ctx.db.patch(invoice._id, { milestones });
    return paymentId;
  },
});

export const recordMilestonePaymentSucceeded = internalMutation({
  args: {
    stripeCheckoutSessionId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_checkout_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId),
      )
      .unique();
    if (
      payment?.kind !== "invoice_milestone" ||
      payment.status === "refunded" ||
      !payment.invoiceId ||
      !payment.milestoneId
    ) {
      return null;
    }
    const invoice = await ctx.db.get(payment.invoiceId);
    if (!invoice) return null;
    const index = invoice.milestones.findIndex(
      (milestone) => milestone.id === payment.milestoneId,
    );
    if (index < 0) return null;
    const milestone = invoice.milestones[index]!;
    if (milestone.stripeCheckoutSessionId !== args.stripeCheckoutSessionId) {
      return null;
    }
    if (milestone.paidAt !== undefined) return null;

    const milestones = [...invoice.milestones];
    milestones[index] = {
      ...milestone,
      paidAt: Date.now(),
      stripePaymentIntentId:
        args.stripePaymentIntentId ?? milestone.stripePaymentIntentId,
    };
    await ctx.db.patch(invoice._id, {
      milestones,
      status: deriveInvoiceStatus({
        milestones,
        sentAt: invoice.sentAt,
        voidedAt: invoice.voidedAt,
      }),
    });
    return null;
  },
});

export const recordMilestonePaymentRefunded = internalMutation({
  args: { stripePaymentIntentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
      )
      .unique();
    if (
      payment?.kind !== "invoice_milestone" ||
      !payment.invoiceId ||
      !payment.milestoneId
    ) {
      return null;
    }
    const invoice = await ctx.db.get(payment.invoiceId);
    if (!invoice || invoice.voidedAt !== undefined) return null;
    const index = invoice.milestones.findIndex(
      (milestone) => milestone.id === payment.milestoneId,
    );
    if (index < 0) return null;
    const milestone = invoice.milestones[index]!;
    if (milestone.stripePaymentIntentId !== args.stripePaymentIntentId) {
      return null;
    }
    const milestones = [...invoice.milestones];
    milestones[index] = {
      id: milestone.id,
      label: milestone.label,
      amountCents: milestone.amountCents,
      dueAt: milestone.dueAt,
    };
    await ctx.db.patch(invoice._id, {
      milestones,
      status: deriveInvoiceStatus({ milestones, sentAt: invoice.sentAt }),
    });
    return null;
  },
});
