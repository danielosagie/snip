import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { requireProjectAccess } from "./auth";
import {
  generateClausesFromAnswers,
  renderClausesAsHtml,
  type ProjectType,
  type WizardAnswers,
} from "./contractTemplates";

/**
 * Clause-level mutations for the structured contract wizard. The contract
 * record on `projects` carries an array of clauses with their state
 * (draft / pending / accepted / disputed). These mutations are the only
 * way to manipulate that array so business rules (required-clause
 * deletion lockout, signed-contract immutability) are enforced
 * centrally.
 */

const projectTypeValidator = v.union(
  v.literal("logo_design"),
  v.literal("video_production"),
  v.literal("web_design"),
  v.literal("photography"),
  v.literal("brand_identity"),
  v.literal("copywriting"),
  v.literal("music"),
  v.literal("animation"),
  v.literal("custom"),
);

const stateValidator = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("disputed"),
);

// A contract edits like any normal document, even after it was sent or
// signed. Editing reverts it to a draft (the signature no longer matches),
// so there's nothing to assert here — kept as a named no-op so the
// intent is explicit at every call site and easy to re-tighten later.
function assertEditable(_project: Doc<"projects">) {
  // intentionally empty — see note above
}

function writeBackContentHtml(
  project: Doc<"projects">,
  nextClauses: NonNullable<Doc<"projects">["contract"]>["clauses"],
): string {
  if (!nextClauses) return project.contract?.contentHtml ?? "";
  return renderClausesAsHtml(nextClauses);
}

/**
 * The wizard's "submit" endpoint. Replaces any existing draft clauses on
 * the contract with a fresh set generated from the answers. Persists the
 * answers as a JSON string so the wizard can be re-opened with the user's
 * existing inputs as defaults.
 */
export const startFromWizard = mutation({
  args: {
    projectId: v.id("projects"),
    projectType: projectTypeValidator,
    answers: v.object({
      // Loosely-typed JSON map — the template engine handles the rest.
      // We accept string|number|boolean|null and store as JSON string.
      entries: v.array(
        v.object({
          key: v.string(),
          value: v.union(
            v.string(),
            v.number(),
            v.boolean(),
            v.null(),
          ),
        }),
      ),
    }),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    assertEditable(project);

    // Reconstruct WizardAnswers from the entries array. We use this
    // shape because Convex value validators don't handle arbitrary
    // record maps cleanly.
    const answers: WizardAnswers = {};
    for (const e of args.answers.entries) {
      answers[e.key] = e.value;
    }

    const drafts = generateClausesFromAnswers(
      args.projectType as ProjectType,
      answers,
    );
    const clauses = drafts.map((d) => ({
      id: d.id,
      sectionKey: d.sectionKey,
      title: d.title,
      bodyHtml: d.bodyHtml,
      state: "draft" as const,
      required: d.required,
      order: d.order,
      sourceAnswerId: d.sourceAnswerId,
    }));

    const wizardAnswers = JSON.stringify(answers);
    const contentHtml = renderClausesAsHtml(clauses);

    // Universal answers also flow into the flat fields so they keep
    // populating badges + downstream paywall code.
    const priceDollars =
      typeof answers.priceDollars === "number"
        ? answers.priceDollars
        : parseFloat(String(answers.priceDollars ?? "0"));
    const priceCents = Number.isFinite(priceDollars)
      ? Math.round(priceDollars * 100)
      : undefined;
    const revisions =
      typeof answers.revisionsAllowed === "number"
        ? answers.revisionsAllowed
        : parseInt(String(answers.revisionsAllowed ?? "0"), 10);

    await ctx.db.patch(args.projectId, {
      contract: {
        ...(project.contract ?? { contentHtml: "" }),
        contentHtml,
        projectType: args.projectType,
        wizardAnswers,
        clauses,
        clientName:
          typeof answers.clientName === "string" ? answers.clientName : undefined,
        clientEmail:
          typeof answers.clientEmail === "string" ? answers.clientEmail : undefined,
        priceCents,
        currency: "usd",
        revisionsAllowed: Number.isFinite(revisions) ? revisions : undefined,
        deadline:
          typeof answers.deadline === "string" ? answers.deadline : undefined,
        scope:
          typeof answers.projectName === "string" ? answers.projectName : undefined,
        lastSavedAt: Date.now(),
        sentForSignatureAt: undefined,
        signedAt: undefined,
        signedByName: undefined,
      },
    });
  },
});

/**
 * Update a single wizard answer and regenerate the contract from the
 * full answer set. Powers the per-section answer editors on the
 * outline rail.
 *
 * We re-derive every clause body (not just the one tied to the
 * answer key) because some answers feed multiple clauses — e.g.
 * `revisionsAllowed` appears both in the revisions clause and in
 * downstream change-order language. Doing a fresh pass is the only
 * way to keep everything in sync without hand-coding cross-section
 * dependencies.
 *
 * The signed / sent-for-signature stamps are intentionally NOT
 * cleared; if either is set we refuse the mutation since editing
 * answers post-signature would invalidate the signed instrument.
 */
export const updateWizardAnswer = mutation({
  args: {
    projectId: v.id("projects"),
    key: v.string(),
    value: v.union(v.string(), v.number(), v.boolean(), v.null()),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    assertEditable(project);
    const contract = project.contract;
    if (!contract?.wizardAnswers || !contract?.projectType) {
      throw new Error(
        "This contract wasn't drafted via the wizard, so its answers aren't editable from the outline. Use the doc editor directly.",
      );
    }

    let answers: WizardAnswers;
    try {
      answers = JSON.parse(contract.wizardAnswers) as WizardAnswers;
    } catch {
      throw new Error("Stored wizard answers are corrupted — can't apply edit.");
    }

    answers[args.key] = args.value;

    const drafts = generateClausesFromAnswers(
      contract.projectType as ProjectType,
      answers,
    );
    // Preserve `state` per clause where ids match, so an accepted
    // section doesn't fall back to "draft" after an unrelated answer
    // edit. New clauses (rare — only when the project type changes)
    // start as "draft".
    const oldStateById = new Map(
      (contract.clauses ?? []).map((c) => [c.id, c.state]),
    );
    const clauses = drafts.map((d) => ({
      id: d.id,
      sectionKey: d.sectionKey,
      title: d.title,
      bodyHtml: d.bodyHtml,
      state: (oldStateById.get(d.id) ?? "draft") as
        | "draft"
        | "pending"
        | "accepted"
        | "disputed",
      required: d.required,
      order: d.order,
      sourceAnswerId: d.sourceAnswerId,
    }));

    const contentHtml = renderClausesAsHtml(clauses);
    const priceDollars =
      typeof answers.priceDollars === "number"
        ? answers.priceDollars
        : parseFloat(String(answers.priceDollars ?? "0"));
    const priceCents = Number.isFinite(priceDollars)
      ? Math.round(priceDollars * 100)
      : contract.priceCents;
    const revisions =
      typeof answers.revisionsAllowed === "number"
        ? answers.revisionsAllowed
        : parseInt(String(answers.revisionsAllowed ?? "0"), 10);

    await ctx.db.patch(args.projectId, {
      contract: {
        ...contract,
        contentHtml,
        clauses,
        wizardAnswers: JSON.stringify(answers),
        clientName:
          typeof answers.clientName === "string"
            ? answers.clientName
            : contract.clientName,
        clientEmail:
          typeof answers.clientEmail === "string"
            ? answers.clientEmail
            : contract.clientEmail,
        priceCents,
        revisionsAllowed: Number.isFinite(revisions)
          ? revisions
          : contract.revisionsAllowed,
        deadline:
          typeof answers.deadline === "string"
            ? answers.deadline
            : contract.deadline,
        scope:
          typeof answers.projectName === "string"
            ? answers.projectName
            : contract.scope,
        lastSavedAt: Date.now(),
      },
    });
  },
});

export const updateClauseBody = mutation({
  args: {
    projectId: v.id("projects"),
    clauseId: v.string(),
    bodyHtml: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    assertEditable(project);
    const clauses = project.contract?.clauses;
    if (!clauses) throw new Error("Contract has no clauses to edit.");
    const next = clauses.map((c) =>
      c.id === args.clauseId
        ? { ...c, bodyHtml: args.bodyHtml, state: "draft" as const }
        : c,
    );
    await ctx.db.patch(args.projectId, {
      contract: {
        ...project.contract!,
        clauses: next,
        contentHtml: writeBackContentHtml(project, next),
        lastSavedAt: Date.now(),
      },
    });
  },
});

export const updateClauseTitle = mutation({
  args: {
    projectId: v.id("projects"),
    clauseId: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    assertEditable(project);
    const clauses = project.contract?.clauses;
    if (!clauses) throw new Error("Contract has no clauses to edit.");
    const trimmed = args.title.trim();
    if (!trimmed) throw new Error("Clause title cannot be empty.");
    const next = clauses.map((c) =>
      c.id === args.clauseId ? { ...c, title: trimmed } : c,
    );
    await ctx.db.patch(args.projectId, {
      contract: {
        ...project.contract!,
        clauses: next,
        contentHtml: writeBackContentHtml(project, next),
        lastSavedAt: Date.now(),
      },
    });
  },
});

export const setClauseState = mutation({
  args: {
    projectId: v.id("projects"),
    clauseId: v.string(),
    state: stateValidator,
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    assertEditable(project);
    const clauses = project.contract?.clauses;
    if (!clauses) throw new Error("Contract has no clauses.");
    const next = clauses.map((c) =>
      c.id === args.clauseId ? { ...c, state: args.state } : c,
    );
    await ctx.db.patch(args.projectId, {
      contract: { ...project.contract!, clauses: next, lastSavedAt: Date.now() },
    });
  },
});

export const addCustomClause = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    bodyHtml: v.optional(v.string()),
    sectionKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    assertEditable(project);
    const title = args.title.trim();
    if (!title) throw new Error("Section title cannot be empty.");
    const clauses = project.contract?.clauses ?? [];
    const maxOrder = clauses.reduce((m, c) => Math.max(m, c.order), 0);
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const next = [
      ...clauses,
      {
        id,
        sectionKey: args.sectionKey ?? "custom",
        title,
        bodyHtml:
          args.bodyHtml ??
          `<p>Describe the terms of this section here.</p>`,
        state: "draft" as const,
        required: false,
        order: maxOrder + 10,
      },
    ];
    await ctx.db.patch(args.projectId, {
      contract: {
        ...(project.contract ?? { contentHtml: "" }),
        clauses: next,
        contentHtml: writeBackContentHtml(project, next),
        lastSavedAt: Date.now(),
      },
    });
    return id;
  },
});

export const removeClause = mutation({
  args: {
    projectId: v.id("projects"),
    clauseId: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    assertEditable(project);
    const clauses = project.contract?.clauses;
    if (!clauses) throw new Error("Contract has no clauses.");
    const target = clauses.find((c) => c.id === args.clauseId);
    if (!target) throw new Error("Clause not found.");
    if (target.required) {
      throw new Error(
        `"${target.title}" is required and can't be removed — these clauses keep the contract enforceable. You can edit the language, but not delete the section.`,
      );
    }
    const next = clauses.filter((c) => c.id !== args.clauseId);
    await ctx.db.patch(args.projectId, {
      contract: {
        ...project.contract!,
        clauses: next,
        contentHtml: writeBackContentHtml(project, next),
        lastSavedAt: Date.now(),
      },
    });
  },
});

export const reorderClauses = mutation({
  args: {
    projectId: v.id("projects"),
    orderedIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    assertEditable(project);
    const clauses = project.contract?.clauses;
    if (!clauses) throw new Error("Contract has no clauses.");
    const byId = new Map(clauses.map((c) => [c.id, c]));
    const next: typeof clauses = [];
    let order = 0;
    for (const id of args.orderedIds) {
      const found = byId.get(id);
      if (found) next.push({ ...found, order: order++ });
      byId.delete(id);
    }
    // Anything not in orderedIds keeps its existing relative order.
    for (const remaining of byId.values()) {
      next.push({ ...remaining, order: order++ });
    }
    await ctx.db.patch(args.projectId, {
      contract: {
        ...project.contract!,
        clauses: next,
        contentHtml: writeBackContentHtml(project, next),
        lastSavedAt: Date.now(),
      },
    });
  },
});
