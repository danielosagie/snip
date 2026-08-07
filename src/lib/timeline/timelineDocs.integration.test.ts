import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  applyOps as applyOpsMutation,
  commit as commitMutation,
  restore as restoreMutation,
} from "../../../convex/timelineDocs";
import { createTimelineDocument } from "./operations";

type MutationHandler<Args, Result> = (
  ctx: unknown,
  args: Args,
) => Promise<Result>;

function mutationHandler<Args, Result>(value: unknown) {
  return (value as { _handler: MutationHandler<Args, Result> })._handler;
}

const projectId = "project_1" as Id<"projects">;
const teamId = "team_1" as Id<"teams">;
const timelineDocId = "timeline_doc_1" as Id<"timelineDocs">;

function makeHarness() {
  let currentUser = "user_b";
  let nextSnapshot = 1;
  let timelineDoc = {
    _id: timelineDocId,
    _creationTime: 1,
    teamId,
    projectId,
    branch: "main",
    revision: 0,
    document: createTimelineDocument({
      sequenceId: "sequence_1",
      actorId: "seed",
      timestamp: 1,
      properties: { name: "Assembly" },
    }),
    updatedAt: 1,
    updatedBy: "seed",
  } as Doc<"timelineDocs">;
  const project = {
    _id: projectId,
    _creationTime: 1,
    teamId,
  } as Doc<"projects">;
  const membership = {
    _id: "membership_1" as Id<"teamMembers">,
    _creationTime: 1,
    teamId,
    userClerkId: currentUser,
    role: "member",
  } as Doc<"teamMembers">;
  const snapshots = new Map<Id<"timelineSnapshots">, Doc<"timelineSnapshots">>();
  const indexBuilder = {
    eq: () => indexBuilder,
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: currentUser }),
    },
    db: {
      get: async (id: string) => {
        if (id === timelineDocId) return timelineDoc;
        if (id === projectId) return project;
        return snapshots.get(id as Id<"timelineSnapshots">) ?? null;
      },
      patch: async (id: string, patch: Partial<Doc<"timelineDocs">>) => {
        if (id !== timelineDocId) throw new Error(`Unexpected patch target ${id}`);
        timelineDoc = { ...timelineDoc, ...patch };
      },
      insert: async (table: string, value: Omit<Doc<"timelineSnapshots">, "_id" | "_creationTime">) => {
        if (table !== "timelineSnapshots") throw new Error(`Unexpected insert table ${table}`);
        const id = `snapshot_${nextSnapshot}` as Id<"timelineSnapshots">;
        nextSnapshot += 1;
        snapshots.set(id, {
          ...value,
          _id: id,
          _creationTime: Date.now(),
        } as Doc<"timelineSnapshots">);
        return id;
      },
      query: (table: string) => {
        if (table === "teamMembers") {
          return {
            withIndex: (_name: string, configure: (builder: typeof indexBuilder) => unknown) => {
              configure(indexBuilder);
              return { unique: async () => ({ ...membership, userClerkId: currentUser }) };
            },
          };
        }
        if (table === "timelineSnapshots") {
          return {
            withIndex: (_name: string, configure: (builder: typeof indexBuilder) => unknown) => {
              configure(indexBuilder);
              return {
                order: () => ({
                  first: async () => Array.from(snapshots.values()).at(-1) ?? null,
                }),
              };
            },
          };
        }
        throw new Error(`Unexpected query table ${table}`);
      },
      normalizeId: (table: string, id: string) =>
        table === "videos" ? (id as Id<"videos">) : null,
    },
  };

  return {
    ctx,
    setCurrentUser: (userId: string) => {
      currentUser = userId;
    },
    getTimelineDoc: () => timelineDoc,
    getSnapshot: (id: Id<"timelineSnapshots">) => snapshots.get(id),
  };
}

test("two clients converge through the mutation and commit/restore round-trips", async () => {
  const harness = makeHarness();
  const applyOps = mutationHandler<
    { timelineDocId: Id<"timelineDocs">; ops: Array<Record<string, unknown>> },
    { revision: number }
  >(applyOpsMutation);
  const commit = mutationHandler<
    { timelineDocId: Id<"timelineDocs">; message: string },
    { snapshotId: Id<"timelineSnapshots">; revision: number }
  >(commitMutation);
  const restore = mutationHandler<
    { timelineDocId: Id<"timelineDocs">; snapshotId: Id<"timelineSnapshots"> },
    { revision: number }
  >(restoreMutation);

  harness.setCurrentUser("user_b");
  const first = await applyOps(harness.ctx, {
    timelineDocId,
    ops: [
      {
        type: "setSequenceProperty",
        opId: "tab_b",
        actorId: "user_b",
        timestamp: 100,
        property: "status",
        value: "tab b",
      },
    ],
  });
  harness.setCurrentUser("user_a");
  const staleTie = await applyOps(harness.ctx, {
    timelineDocId,
    ops: [
      {
        type: "setSequenceProperty",
        opId: "tab_a",
        actorId: "user_a",
        timestamp: 100,
        property: "status",
        value: "tab a",
      },
    ],
  });

  assert.equal(first.revision, 1);
  assert.equal(staleTie.revision, 1);
  assert.equal(harness.getTimelineDoc().document.sequence.properties.status.value, "tab b");

  harness.setCurrentUser("user_b");
  const committed = await commit(harness.ctx, {
    timelineDocId,
    message: "Concurrent cut",
  });
  const snapshot = harness.getSnapshot(committed.snapshotId);
  assert.ok(snapshot);
  assert.deepEqual(JSON.parse(snapshot.cuts), harness.getTimelineDoc().document);

  harness.setCurrentUser("user_a");
  await applyOps(harness.ctx, {
    timelineDocId,
    ops: [
      {
        type: "setSequenceProperty",
        opId: "later_edit",
        actorId: "user_a",
        timestamp: 200,
        property: "status",
        value: "later edit",
      },
    ],
  });
  assert.equal(
    harness.getTimelineDoc().document.sequence.properties.status.value,
    "later edit",
  );

  harness.setCurrentUser("user_b");
  const restored = await restore(harness.ctx, {
    timelineDocId,
    snapshotId: committed.snapshotId,
  });
  assert.equal(restored.revision, 3);
  assert.equal(harness.getTimelineDoc().document.sequence.properties.status.value, "tab b");
  assert.equal(harness.getTimelineDoc().headSnapshotId, committed.snapshotId);
});
