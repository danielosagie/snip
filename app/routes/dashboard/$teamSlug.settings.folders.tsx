import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { seoHead } from "@/lib/seo";
import { useSettingsData } from "./-settings.data";
import {
  softFieldLabel,
  softButton,
  softButtonPrimary,
  softHelperText,
  softInput,
  SoftCard,
  SoftCardHeading,
  SoftField,
  SoftPage,
  SoftPill,
  SoftRow,
} from "@/components/soft";
import { cn } from "@/lib/utils";

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
      <main className="surface-soft flex-1 bg-[#FAFAFA] p-6 font-sans">
        <p className="text-sm text-[#6E6E73]">Loading team…</p>
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
    <SoftPage title="Folder permissions">
      <SoftCard>
        <SoftCardHeading title="Active grants" />
        <div className="mt-3.5">
        {grants === undefined ? (
          <p className="text-sm text-[#6E6E73]">Loading…</p>
        ) : grants.length === 0 ? (
          <p className={softHelperText}>
            No grants yet. Every member can access every folder.
          </p>
        ) : (
          <div>
            {grants.map((g) => (
              <SoftRow key={g._id} className="flex-col sm:flex-row sm:items-start">
                <div className="flex-1 min-w-0">
                  <div className="break-all text-sm font-medium leading-5 text-[#131315]">
                    {g.pathPrefix}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {g.allowedRoles.length > 0 ? (
                      g.allowedRoles.map((r) => (
                        <SoftPill key={r}>{r}</SoftPill>
                      ))
                    ) : (
                      <span className={softHelperText}>
                        No role grants
                      </span>
                    )}
                  </div>
                  {g.allowedClerkIds.length > 0 ? (
                    <div className={cn(softHelperText, "mt-1.5 break-all")}>
                      + {g.allowedClerkIds.length} explicit user
                      {g.allowedClerkIds.length === 1 ? "" : "s"}
                    </div>
                  ) : null}
                  {g.note ? (
                    <div className={cn(softHelperText, "mt-1.5")}>{g.note}</div>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className={softButton}
                  onClick={() => void deleteGrant(g._id)}
                  disabled={busy}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Remove
                </Button>
              </SoftRow>
            ))}
          </div>
        )}
        </div>
      </SoftCard>

      <SoftCard>
        <SoftCardHeading title="Add grant" />
        <div className="mt-4 space-y-4">
          <SoftField label="Path prefix">
            <Input
              placeholder="projects/red-bull-spring/raw/"
              value={draft.pathPrefix}
              onChange={(e) =>
                setDraft((d) => ({ ...d, pathPrefix: e.target.value }))
              }
              className={softInput}
            />
            <p className={cn(softHelperText, "mt-1")}>
              Relative to the bucket root. A trailing slash is added automatically.
            </p>
          </SoftField>

          <div>
            <span className={softFieldLabel}>Roles</span>
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
            <span className={softFieldLabel}>People</span>
            {members === undefined ? (
              <p className={softHelperText}>Loading members…</p>
            ) : members.length === 0 ? (
              <p className={softHelperText}>No team members.</p>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-[11px] border border-[#E8E8EC] bg-white">
                {members.map((m) => (
                  <label
                    key={m.userClerkId}
                    className="flex cursor-pointer items-center gap-2 border-t border-[#F1F1F3] px-3.5 py-3 text-sm first:border-t-0 hover:bg-[#FAFAFA]"
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
                    <SoftPill>{m.role}</SoftPill>
                  </label>
                ))}
              </div>
            )}
          </div>

          <SoftField label="Note">
            <Input
              placeholder="Raw masters, sound team only"
              value={draft.note}
              onChange={(e) =>
                setDraft((d) => ({ ...d, note: e.target.value }))
              }
              className={softInput}
            />
          </SoftField>

          {err ? (
            <p className="text-[13px] leading-[18px] text-[#D8434F]">{err}</p>
          ) : null}

          <Button
            className={softButtonPrimary}
            onClick={() => void add()}
            disabled={busy || !draft.pathPrefix.trim()}
          >
            {busy ? "Saving…" : "Add grant"}
          </Button>
        </div>
      </SoftCard>
    </SoftPage>
  );
}
