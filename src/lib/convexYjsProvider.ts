import type { ConvexReactClient } from "convex/react";
import * as Y from "yjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

/**
 * Yjs ↔ Convex bridge — no WebSockets, no Liveblocks, no Hocuspocus.
 *
 * On construct:
 *   1. Subscribe to api.contractDocs.getDoc for this project.
 *   2. Every remote state change → decode base64 → apply to the local
 *      Y.Doc with origin "remote" (so we don't echo it back).
 *   3. Every local change on the Y.Doc → encode the update → mutate
 *      api.contractDocs.appendUpdate. Server merges and broadcasts.
 *
 * That's the whole protocol. Yjs's CRDT guarantees mean two clients
 * editing simultaneously converge on the same final state regardless of
 * mutation order. We don't have to do anything special for concurrent
 * edits.
 *
 * Limitations vs. a "real" provider (y-websocket / Hocuspocus):
 *   - No awareness (cursors / selections of other users). That needs an
 *     ephemeral channel — Convex doesn't have one, but we can fake it
 *     later with a TTL-cleared row or fold it into the same doc.
 *   - Server merges every update (which is fine but slightly more work
 *     than a pure relay).
 */

const ORIGIN_REMOTE = Symbol("convexRemote");

/**
 * Initial HTML is inserted locally so Tiptap can translate it into Yjs. The
 * provider must not enqueue that update through the normal append path because
 * the seed uses a compare-and-set mutation to prevent two new tabs from
 * planting duplicate copies of the same document.
 */
export const ORIGIN_INITIAL_SEED = Symbol("convexInitialSeed");

export function contractYjsField(contractId: Id<"contracts">): string {
  return `contract:${contractId}`;
}

type Unsubscribe = () => void;

interface Options {
  /** Optional display name to record on edits (for the editor banner). */
  editorName?: string;
  /** Debounce in ms between local updates. Smooths out keystroke-rate calls. */
  flushIntervalMs?: number;
  /** Scopes an editor to one row inside the project's shared Y.Doc. */
  contractId?: Id<"contracts">;
  /** Fires only after the first server snapshot (including null) is known. */
  onSynced?: () => void;
}

export class ConvexYjsProvider {
  private remoteUnsubscribe: Unsubscribe | null = null;
  private localUpdateHandler: (update: Uint8Array, origin: unknown) => void;
  private pendingUpdates: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private lastAppliedRemoteState: string | null = null;
  private syncReported = false;
  private retryAttempt = 0;

  constructor(
    public readonly doc: Y.Doc,
    private readonly convex: ConvexReactClient,
    private readonly projectId: Id<"projects">,
    private readonly opts: Options = {},
  ) {
    this.localUpdateHandler = (update, origin) => {
      if (origin === ORIGIN_REMOTE || origin === ORIGIN_INITIAL_SEED) return;
      this.queueUpdate(update);
    };
    this.doc.on("update", this.localUpdateHandler);

    // Reactive subscription to the canonical state. We use watchQuery
    // because ConvexReactClient doesn't expose `onUpdate(query, args, cb)`
    // directly; watchQuery returns a Watch object that does. The first
    // tick fires whenever the query result becomes available.
    const watch = this.convex.watchQuery(api.contractDocs.getDoc, {
      projectId: this.projectId,
    });
    const apply = () => {
      if (this.destroyed) return;
      const state = watch.localQueryResult();
      if (state === undefined) return;
      if (state !== null) {
        const typed = state as { yjsState: string };
        if (this.lastAppliedRemoteState !== typed.yjsState) {
          this.lastAppliedRemoteState = typed.yjsState;
          try {
            Y.applyUpdate(this.doc, base64ToBytes(typed.yjsState), ORIGIN_REMOTE);
          } catch (e) {
            console.error("Failed to apply remote Yjs state", e);
          }
        }
      }
      if (!this.syncReported) {
        this.syncReported = true;
        this.opts.onSynced?.();
      }
    };
    apply();
    this.remoteUnsubscribe = watch.onUpdate(apply);
  }

  private queueUpdate(update: Uint8Array) {
    if (this.destroyed) return;
    this.pendingUpdates.push(update);
    if (this.flushTimer) return;
    const delay = this.opts.flushIntervalMs ?? 250;
    this.flushTimer = setTimeout(() => this.flush(), delay);
  }

  async flush() {
    this.flushTimer = null;
    if (this.pendingUpdates.length === 0) return;
    // Coalesce: merge all queued updates into one Y.update before sending.
    const merged = Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];
    try {
      await this.convex.mutation(api.contractDocs.appendUpdate, {
        projectId: this.projectId,
        update: bytesToBase64(merged),
        editorName: this.opts.editorName,
        contractId: this.opts.contractId,
      });
      this.retryAttempt = 0;
    } catch (e) {
      console.error("Convex Yjs mutation failed; re-queueing.", e);
      this.pendingUpdates.unshift(merged);
      if (!this.destroyed && !this.flushTimer) {
        const retryDelay = Math.min(1000 * 2 ** this.retryAttempt, 10_000);
        this.retryAttempt += 1;
        this.flushTimer = setTimeout(() => void this.flush(), retryDelay);
      }
    }
  }

  /** Push the doc's current full state as a one-time initial seed. The server
   * applies it only while this contract's named fragment is still empty.
   * Returns false ONLY for a compare-and-set rejection (another tab seeded
   * first). Transport and server errors are rethrown — the caller must not
   * confuse them with a lost race, or a broken deployment turns into an
   * infinite reseed loop. */
  async seed(updateBytes: Uint8Array): Promise<boolean> {
    if (this.destroyed) return false;
    const result = await this.convex.mutation(api.contractDocs.appendUpdate, {
      projectId: this.projectId,
      update: bytesToBase64(updateBytes),
      editorName: this.opts.editorName,
      contractId: this.opts.contractId,
      seedIfEmpty: Boolean(this.opts.contractId),
    });
    return result.applied;
  }

  destroy() {
    this.doc.off("update", this.localUpdateHandler);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.remoteUnsubscribe) {
      this.remoteUnsubscribe();
      this.remoteUnsubscribe = null;
    }
    // One last best-effort write so a quick edit-then-navigate-away doesn't
    // drop the buffered keystrokes. It deliberately skips retry bookkeeping
    // because this provider no longer owns a live document after destroy.
    if (this.pendingUpdates.length > 0) {
      const merged = Y.mergeUpdates(this.pendingUpdates);
      this.pendingUpdates = [];
      void this.convex
        .mutation(api.contractDocs.appendUpdate, {
          projectId: this.projectId,
          update: bytesToBase64(merged),
          editorName: this.opts.editorName,
          contractId: this.opts.contractId,
        })
        .catch((error) => {
          console.error("Convex Yjs final flush failed", error);
        });
    }
    this.destroyed = true;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
