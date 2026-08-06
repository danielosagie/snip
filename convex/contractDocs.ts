import { v } from "convex/values";
import * as Y from "yjs";
import { mutation, query } from "./_generated/server";
import { requireProjectAccess } from "./auth";

/**
 * Real-time collaborative contract editor — Convex-backed Yjs persistence.
 *
 * Architecture:
 *   - Each project has at most one `contractDocs` row holding the full
 *     Yjs document state as a base64-encoded blob. Multi-document projects
 *     use one named XML fragment per contracts-table row.
 *   - Clients run Tiptap with the Collaboration extension. Local edits
 *     produce Yjs "updates" (small binary deltas); we ship those to
 *     `appendUpdate`, server merges into the canonical state via
 *     `Y.applyUpdate`, persists the merged blob.
 *   - Every other client subscribed to `getDoc` sees the new state reactively
 *     and applies the diff locally. No WebSocket server, no Hocuspocus, no
 *     Liveblocks — just Convex's reactive query layer.
 *
 * Why this works without OT/CRDT plumbing: Yjs IS the CRDT. The server
 * doesn't need to know anything about ProseMirror, it just merges
 * binary updates. Two simultaneous edits = two updates that both get
 * applied in some order, Yjs guarantees the final state is the same
 * regardless of order.
 */

// ─── base64 helpers ──────────────────────────────────────────────────────
// Convex's V8 isolate has Buffer-like atob/btoa but not Node Buffer, so we
// route through Uint8Array for portability.

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  // btoa is available in Convex's V8 runtime.
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function contractField(contractId: string): string {
  return `contract:${contractId}`;
}

// ─── Public API ──────────────────────────────────────────────────────────

export const getDoc = query({
  args: { projectId: v.id("projects") },
  returns: v.union(
    v.object({
      _id: v.id("contractDocs"),
      yjsState: v.string(),
      lastEditedAt: v.union(v.number(), v.null()),
      lastEditedBy: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const row = await ctx.db
      .query("contractDocs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!row) return null;
    return {
      _id: row._id,
      yjsState: row.yjsState,
      lastEditedAt: row.lastEditedAt ?? null,
      lastEditedBy: row.lastEditedBy ?? null,
    };
  },
});

/**
 * Apply a Yjs update from one client. Server materializes the current doc,
 * merges the incoming delta, re-encodes the full state, persists it.
 *
 * We accept the WHOLE doc state on first write (when nothing exists yet)
 * AND incremental updates afterward — both encode as `Y.encodeStateAsUpdate`
 * binary, indistinguishable to `Y.applyUpdate`. Clients can therefore push
 * either "I just started, here's my initial state" or "here's a 12-byte
 * edit" through the same mutation.
 */
export const appendUpdate = mutation({
  args: {
    projectId: v.id("projects"),
    update: v.string(), // base64-encoded Yjs update
    editorName: v.optional(v.string()),
    contractId: v.optional(v.id("contracts")),
    seedIfEmpty: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.literal(true),
    bytes: v.number(),
    applied: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireProjectAccess(ctx, args.projectId, "member");

    if (args.contractId) {
      const contract = await ctx.db.get(args.contractId);
      if (!contract || contract.projectId !== args.projectId || contract.deletedAt) {
        throw new Error("Document not found in this project.");
      }
      if (contract.status !== "draft") {
        throw new Error("Only drafts can be edited.");
      }
    }

    const existing = await ctx.db
      .query("contractDocs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();

    const yDoc = new Y.Doc();
    if (existing?.yjsState) {
      try {
        Y.applyUpdate(yDoc, base64ToBytes(existing.yjsState));
      } catch (e) {
        console.error("Could not load existing Yjs state", e);
        throw new Error("The collaborative document could not be loaded.");
      }
    }

    if (args.seedIfEmpty) {
      if (!args.contractId) {
        throw new Error("A document is required for an initial seed.");
      }
      if (yDoc.getXmlFragment(contractField(args.contractId)).length > 0) {
        return {
          ok: true as const,
          bytes: existing?.yjsState.length ?? 0,
          applied: false,
        };
      }
    }
    Y.applyUpdate(yDoc, base64ToBytes(args.update));

    const merged = bytesToBase64(Y.encodeStateAsUpdate(yDoc));
    const editorName =
      args.editorName ??
      (user as { name?: string; email?: string }).name ??
      (user as { email?: string }).email ??
      "Unknown";
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        yjsState: merged,
        lastEditedAt: now,
        lastEditedBy: editorName,
      });
    } else {
      await ctx.db.insert("contractDocs", {
        projectId: args.projectId,
        yjsState: merged,
        lastEditedAt: now,
        lastEditedBy: editorName,
      });
    }

    return { ok: true as const, bytes: merged.length, applied: true };
  },
});

/** Clear one contracts-table row's fragment without disturbing the other
 * documents stored in the same project Y.Doc. Used before a version restore. */
export const resetItemDoc = mutation({
  args: {
    projectId: v.id("projects"),
    contractId: v.id("contracts"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, "member");
    const contract = await ctx.db.get(args.contractId);
    if (!contract || contract.projectId !== args.projectId || contract.deletedAt) {
      throw new Error("Document not found in this project.");
    }
    if (contract.status !== "draft") {
      throw new Error("Only drafts can be restored.");
    }
    const existing = await ctx.db
      .query("contractDocs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!existing) return null;

    const yDoc = new Y.Doc();
    Y.applyUpdate(yDoc, base64ToBytes(existing.yjsState));
    const fragment = yDoc.getXmlFragment(contractField(args.contractId));
    if (fragment.length === 0) return null;
    fragment.delete(0, fragment.length);
    await ctx.db.patch(existing._id, {
      yjsState: bytesToBase64(Y.encodeStateAsUpdate(yDoc)),
      lastEditedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Reset the doc — used when the agency clears + redrafts a contract.
 * Member-only (admins shouldn't have to step in for normal redraft flow).
 */
export const resetDoc = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, "member");
    const existing = await ctx.db
      .query("contractDocs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!existing) return;
    const yDoc = new Y.Doc();
    Y.applyUpdate(yDoc, base64ToBytes(existing.yjsState));
    const fragment = yDoc.getXmlFragment("default");
    if (fragment.length === 0) return;
    fragment.delete(0, fragment.length);
    await ctx.db.patch(existing._id, {
      yjsState: bytesToBase64(Y.encodeStateAsUpdate(yDoc)),
      lastEditedAt: Date.now(),
    });
  },
});
