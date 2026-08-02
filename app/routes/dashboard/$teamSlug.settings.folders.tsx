import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trash2, FolderTree } from "lucide-react";
import { seoHead } from "@/lib/seo";
import { useSettingsData } from "./-settings.data";

export const Route = createFileRoute(
  "/dashboard/$teamSlug/settings/folders",
)({
  head: () =>
    seoHead({
      title: "Folder permissions",
      description: "Per-folder team permission grants for the snip Desktop mount.",
      path: "/dashboard/$teamSlug/settings/folders",
      noIndex: true,
    }),
  component: FolderPermissionsRoute,
});

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
] as const;

const DEFAULT_ROLES = ["owner", "admin", "member"] as string[];

/**
 * Team-scoped folder access grants. Each row scopes a path prefix in
 * the team's bucket / mount tree to a set of roles + specific Clerk
 * user IDs. snip Desktop reads these via folderPermissions:listForTeam
 * to (a) filter the mount with rclone --filter-from and (b) vend
 * scoped object-storage credentials when the user opens the mount.
 *
 * Without any grants on a team, all folders are accessible to all
 * members (default-allow). Adding even one grant flips the team into
 * explicit-grant mode for every path that the grant's prefix touches.
 */
function FolderPermissionsRoute() {
  const params = useParams({ strict: false });
  const teamSlug = typeof params.teamSlug === "string" ? params.teamSlug : "";
  const { team } = useSettingsData({ teamSlug });

  const grants = useQuery(
    api.folderPermissions.listForTeam,
    team ? { teamId: team._id } : "skip",
  );
  const members = useQuery(
    api.teams.getMembers,
    team ? { teamId: team._id } : "skip",
  );
  const create = useMutation(api.folderPermissions.create);
  const remove = useMutation(api.folderPermissions.remove);

  const [draft, setDraft] = useState({
    pathPrefix: "",
    allowedRoles: DEFAULT_ROLES,
    allowedClerkIds: [] as string[],
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!team) {
    return (
      <main className="max-w-3xl p-6">
        <p className="text-sm text-[#666]">Loading team…</p>
      </main>
    );
  }

  const add = async () => {
    const normalizedPrefix = draft.pathPrefix.trim();
    if (!normalizedPrefix) return;
    setBusy(true);
    setErr(null);
    try {
      await create({
        teamId: team._id,
        pathPrefix: normalizedPrefix,
        allowedRoles: draft.allowedRoles,
        allowedClerkIds: draft.allowedClerkIds,
        note: draft.note || undefined,
      });
      setDraft({
        pathPrefix: "",
        allowedRoles: DEFAULT_ROLES,
        allowedClerkIds: [],
        note: "",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteGrant = async (id: Id<"folderPermissions">) => {
    setBusy(true);
    setErr(null);
    try {
      await remove({ permissionId: id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="max-w-3xl p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2 text-[#888] text-xs font-bold uppercase tracking-wider">
          <FolderTree className="h-3.5 w-3.5" />
          snip Desktop · {team.name}
        </div>
        <h1 className="text-4xl font-black text-[#1a1a1a] mt-1">
          Folder permissions
        </h1>
        <p className="text-[#666] mt-1 text-sm">
          Scope a path prefix in your team's bucket to a set of roles or
          specific people. snip Desktop applies these as an{" "}
          <code>rclone --filter-from</code> at mount time and (when
          configured) restricts the vended object-storage credentials
          to the matching prefixes. Members not covered by any grant
          retain default-allow access; add a grant to start gating.
        </p>
      </div>

      <section className="border-2 border-[#1a1a1a] bg-[#f0f0e8] p-6">
        <h2 className="font-black text-lg tracking-tight mb-3">
          Active grants
        </h2>
        {grants === undefined ? (
          <p className="text-sm text-[#666]">Loading…</p>
        ) : grants.length === 0 ? (
          <p className="text-sm text-[#666]">
            No grants yet — every team member can see every folder. Add
            your first grant below to start scoping access.
          </p>
        ) : (
          <ul className="space-y-2">
            {grants.map((g) => (
              <li
                key={g._id}
                className="border-2 border-[#1a1a1a] bg-white p-3 flex flex-col sm:flex-row gap-3 sm:items-start"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm font-bold break-all">
                    {g.pathPrefix}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {g.allowedRoles.length > 0 ? (
                      g.allowedRoles.map((r) => (
                        <Badge key={r} variant="secondary">
                          {r}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-[#888]">
                        no role grants
                      </span>
                    )}
                  </div>
                  {g.allowedClerkIds.length > 0 ? (
                    <div className="mt-1.5 text-xs text-[#666] font-mono break-all">
                      + {g.allowedClerkIds.length} explicit user
                      {g.allowedClerkIds.length === 1 ? "" : "s"}
                    </div>
                  ) : null}
                  {g.note ? (
                    <div className="mt-1.5 text-xs text-[#666]">{g.note}</div>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void deleteGrant(g._id)}
                  disabled={busy}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-2 border-[#1a1a1a] bg-[#f0f0e8] p-6">
        <h2 className="font-black text-lg tracking-tight mb-3">Add grant</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.15em] text-[#888] font-bold mb-1">
              Path prefix
            </label>
            <Input
              placeholder="projects/red-bull-spring/raw/"
              value={draft.pathPrefix}
              onChange={(e) =>
                setDraft((d) => ({ ...d, pathPrefix: e.target.value }))
              }
              className="font-mono"
            />
            <p className="text-xs text-[#666] mt-1">
              Relative to your bucket root. A trailing slash is added
              automatically so <code>projects/foo</code> can't match{" "}
              <code>projects/foobar</code>.
            </p>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-[0.15em] text-[#888] font-bold mb-1">
              Roles with access
            </label>
            <div className="flex flex-wrap gap-3">
              {ROLE_OPTIONS.map((role) => (
                <label
                  key={role.value}
                  className="flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#FF6600]"
                    checked={draft.allowedRoles.includes(role.value)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        allowedRoles: e.target.checked
                          ? [...d.allowedRoles, role.value]
                          : d.allowedRoles.filter((r) => r !== role.value),
                      }))
                    }
                  />
                  {role.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-[0.15em] text-[#888] font-bold mb-1">
              Specific people (optional)
            </label>
            {members === undefined ? (
              <p className="text-xs text-[#666]">Loading members…</p>
            ) : members.length === 0 ? (
              <p className="text-xs text-[#666]">No members in this team.</p>
            ) : (
              <div className="max-h-40 overflow-y-auto border-2 border-[#1a1a1a] bg-white">
                {members.map((m) => (
                  <label
                    key={m.userClerkId}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-[#FFEDD5] border-b border-[#eee] last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#FF6600]"
                      checked={draft.allowedClerkIds.includes(m.userClerkId)}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          allowedClerkIds: e.target.checked
                            ? [...d.allowedClerkIds, m.userClerkId]
                            : d.allowedClerkIds.filter(
                                (id) => id !== m.userClerkId,
                              ),
                        }))
                      }
                    />
                    <span className="flex-1 min-w-0 truncate">
                      {m.userName || m.userEmail || m.userClerkId}
                    </span>
                    <Badge variant="secondary">{m.role}</Badge>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-[0.15em] text-[#888] font-bold mb-1">
              Note (optional)
            </label>
            <Input
              placeholder="Raw masters — sound team only"
              value={draft.note}
              onChange={(e) =>
                setDraft((d) => ({ ...d, note: e.target.value }))
              }
            />
          </div>

          {err ? (
            <p className="text-sm text-[#7f1d1d] font-mono">{err}</p>
          ) : null}

          <Button
            onClick={() => void add()}
            disabled={busy || !draft.pathPrefix.trim()}
          >
            {busy ? "Saving…" : "Add grant"}
          </Button>
        </div>
      </section>
    </main>
  );
}
