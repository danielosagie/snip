import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { insert as insertMutation } from "../../../convex/desktopWatcherEvents";

type MutationHandler<Args, Result> = (
  ctx: unknown,
  args: Args,
) => Promise<Result>;

function mutationHandler<Args, Result>(value: unknown) {
  return (value as { _handler: MutationHandler<Args, Result> })._handler;
}

const projectId = "project_1" as Id<"projects">;
const teamId = "team_1" as Id<"teams">;

function makeHarness(authenticated: boolean) {
  const inserted: Array<Record<string, unknown>> = [];
  const project = { _id: projectId, teamId } as Doc<"projects">;
  const indexBuilder = { eq: () => indexBuilder };
  return {
    inserted,
    ctx: {
      auth: {
        getUserIdentity: async () =>
          authenticated
            ? { subject: "user_1", name: "Desktop Editor" }
            : null,
      },
      db: {
        get: async (id: string) => (id === projectId ? project : null),
        insert: async (table: string, value: Record<string, unknown>) => {
          assert.equal(table, "desktopWatcherEvents");
          inserted.push(value);
          return `watcher_event_${inserted.length}`;
        },
        query: (table: string) => {
          assert.equal(table, "teamMembers");
          return {
            withIndex: (
              _name: string,
              configure: (builder: typeof indexBuilder) => unknown,
            ) => {
              configure(indexBuilder);
              return {
                unique: async () => ({ role: "member", teamId }),
              };
            },
          };
        },
      },
    },
  };
}

const insert = mutationHandler<
  {
    projectId: Id<"projects">;
    clientId: string;
    events: Array<{
      kind: "save";
      file: string;
      root: string;
      mtime: number;
      observedAt: number;
      hash: string;
      parseStatus: "parsed";
    }>;
  },
  { ids: string[] }
>(insertMutation);

test("watcher event insert derives authenticated project, team, client, and user scope", async () => {
  const harness = makeHarness(true);
  const result = await insert(harness.ctx, {
    projectId,
    clientId: "desktop_a",
    events: [
      {
        kind: "save",
        file: "cuts/assembly.fcpxml",
        root: "/Volumes/Project",
        mtime: 100,
        observedAt: 110,
        hash: "sha256:fixture",
        parseStatus: "parsed",
      },
    ],
  });

  assert.deepEqual(result.ids, ["watcher_event_1"]);
  assert.deepEqual(harness.inserted[0], {
    projectId,
    teamId,
    clientId: "desktop_a",
    userClerkId: "user_1",
    userName: "Desktop Editor",
    kind: "save",
    file: "cuts/assembly.fcpxml",
    root: "/Volumes/Project",
    mtime: 100,
    observedAt: 110,
    hash: "sha256:fixture",
    parseStatus: "parsed",
    parseError: undefined,
  });
});

test("watcher event insert rejects an unauthenticated desktop", async () => {
  const harness = makeHarness(false);
  await assert.rejects(
    insert(harness.ctx, {
      projectId,
      clientId: "desktop_a",
      events: [
        {
          kind: "save",
          file: "assembly.fcpxml",
          root: "/Volumes/Project",
          mtime: 100,
          observedAt: 110,
          hash: "sha256:fixture",
          parseStatus: "parsed",
        },
      ],
    }),
    /Not authenticated/,
  );
  assert.equal(harness.inserted.length, 0);
});
