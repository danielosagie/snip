import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  applyOps as applyOpsMutation,
  commit as commitMutation,
  ensureForPlugin as ensureForPluginMutation,
  ingestExternalTimeline as ingestExternalTimelineMutation,
  restore as restoreMutation,
} from "../../../convex/timelineDocs";
import { createTimelineDocument } from "./operations";
import { fcpxmlToOtio } from "./otio";

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

function makeExternalIngestHarness() {
  const videoId = "video_1" as Id<"videos">;
  const docs = new Map<Id<"timelineDocs">, Doc<"timelineDocs">>();
  const snapshots = new Map<Id<"timelineSnapshots">, Doc<"timelineSnapshots">>();
  const project = {
    _id: projectId,
    _creationTime: 1,
    teamId,
  } as Doc<"projects">;
  const video = {
    _id: videoId,
    _creationTime: 1,
    projectId,
    teamId,
    publicId: "video-public-1",
    title: "Interview A.mov",
    s3Key: "projects/team/project/Interview A.mov",
  } as unknown as Doc<"videos">;
  let nextDoc = 1;
  let nextSnapshot = 1;

  const rowsFor = (table: string) => {
    if (table === "timelineDocs") return [...docs.values()];
    if (table === "timelineSnapshots") return [...snapshots.values()];
    if (table === "videos") return [video];
    throw new Error(`Unexpected query table ${table}`);
  };

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === projectId) return project;
        if (id === videoId) return video;
        return (
          docs.get(id as Id<"timelineDocs">) ??
          snapshots.get(id as Id<"timelineSnapshots">) ??
          null
        );
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        if (table === "timelineDocs") {
          const id = `timeline_doc_external_${nextDoc++}` as Id<"timelineDocs">;
          docs.set(id, {
            ...value,
            _id: id,
            _creationTime: Date.now(),
          } as Doc<"timelineDocs">);
          return id;
        }
        if (table === "timelineSnapshots") {
          const id = `snapshot_external_${nextSnapshot++}` as Id<"timelineSnapshots">;
          snapshots.set(id, {
            ...value,
            _id: id,
            _creationTime: Date.now(),
          } as Doc<"timelineSnapshots">);
          return id;
        }
        throw new Error(`Unexpected insert table ${table}`);
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const docId = id as Id<"timelineDocs">;
        const current = docs.get(docId);
        if (!current) throw new Error(`Unexpected patch target ${id}`);
        docs.set(docId, { ...current, ...patch });
      },
      normalizeId: (table: string, id: string) =>
        table === "videos" && id === videoId ? videoId : null,
      query: (table: string) => {
        const filters = new Map<string, unknown>();
        const builder = {
          eq: (field: string, value: unknown) => {
            filters.set(field, value);
            return builder;
          },
        };
        const matches = () =>
          rowsFor(table).filter((row) =>
            [...filters].every(
              ([field, value]) =>
                (row as unknown as Record<string, unknown>)[field] === value,
            ),
          );
        const ordered = () => ({ first: async () => matches().at(-1) ?? null });
        return {
          withIndex: (
            _name: string,
            configure: (index: typeof builder) => unknown,
          ) => {
            configure(builder);
            return {
              first: async () => matches()[0] ?? null,
              collect: async () => matches(),
              order: ordered,
            };
          },
        };
      },
    },
  };

  return { ctx, docs, snapshots };
}

test("external OTIO ingest is idempotent by source file hash", async () => {
  const fixture = readFileSync(
    new URL("./fixtures/basic.fcpxml", import.meta.url),
    "utf8",
  );
  const harness = makeExternalIngestHarness();
  const ingest = mutationHandler<
    {
      teamId: Id<"teams">;
      projectId: Id<"projects">;
      branch: string;
      sourceFileHash: string;
      sourceFile: string;
      sourceFormat: { name: string; extension: string };
      otio: unknown;
      createdByName: string;
    },
    {
      status: "created" | "duplicate";
      snapshotId: Id<"timelineSnapshots">;
      timelineDocId: Id<"timelineDocs">;
    }
  >(ingestExternalTimelineMutation);
  const request = {
    teamId,
    projectId,
    branch: "desktop/main",
    sourceFileHash: "sha256:basic-fcpxml-fixture",
    sourceFile: "basic.fcpxml",
    sourceFormat: { name: "Final Cut Pro XML", extension: ".fcpxml" },
    otio: fcpxmlToOtio(fixture),
    createdByName: "Desktop Editor",
  };

  const created = await ingest(harness.ctx, request);
  const duplicate = await ingest(harness.ctx, request);

  assert.equal(created.status, "created");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.snapshotId, created.snapshotId);
  assert.equal(duplicate.timelineDocId, created.timelineDocId);
  assert.equal(harness.snapshots.size, 1);
  assert.equal(harness.docs.size, 1);
  const document = [...harness.docs.values()][0].document;
  assert.equal(document.sequence.properties.name.value, "Assembly v1");
  assert.equal(Object.keys(Object.values(document.sequence.tracks)[0].clips).length, 2);
});

test("plugin branch resolution auto-creates an empty live document", async () => {
  const harness = makeExternalIngestHarness();
  const ensure = mutationHandler<
    {
      teamId: Id<"teams">;
      projectId: Id<"projects">;
      branch: string;
      sequenceName: string;
    },
    { id: Id<"timelineDocs">; branch: string; created: boolean }
  >(ensureForPluginMutation);

  const first = await ensure(harness.ctx, {
    teamId,
    projectId,
    branch: "fresh-resolve-branch",
    sequenceName: "Resolve Assembly",
  });
  const second = await ensure(harness.ctx, {
    teamId,
    projectId,
    branch: "fresh-resolve-branch",
    sequenceName: "Resolve Assembly",
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.id, first.id);
  assert.equal(harness.docs.size, 1);
  const document = harness.docs.get(first.id)?.document;
  assert.ok(document);
  assert.equal(document.sequence.properties.name.value, "Resolve Assembly");
  assert.deepEqual(document.sequence.tracks, {});
});
