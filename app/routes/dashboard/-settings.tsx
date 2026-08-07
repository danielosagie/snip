import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  softButton,
  softButtonDanger,
  softButtonPrimary,
  softCard,
  softHelperText,
  softInput,
  SoftPill,
} from "@/components/soft";
import {
  Trash2,
  Pencil,
  UserPlus,
  Mail,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { dashboardHomePath, teamHomePath } from "@/lib/routes";
import { cn, getInitials } from "@/lib/utils";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";
import { useSettingsData } from "./-settings.data";
import { prewarmTeam } from "./-team.data";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Id } from "@convex/_generated/dataModel";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

type Role = "admin" | "member" | "viewer";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

const ROLE_HELP: Record<Role, string> = {
  admin: "Can manage members and team settings.",
  member: "Can create projects, upload, comment, edit.",
  viewer: "Read-only: watch + comment, no uploads.",
};

/**
 * Team Members page. Used to also house SaaS billing + plan
 * selection, but those moved to /dashboard/billing once we went to
 * account-level workspace billing. This page is now focused entirely
 * on membership:
 *
 *   - Team identity (name, slug, delete)
 *   - Invite by email (inline, with role picker + copyable link)
 *   - Pending invites with revoke
 *   - Members with role change + remove
 *   - Pointer to per-team payouts (Stripe Connect) since *receiving*
 *     client money is still team-scoped
 */
export default function TeamSettingsPage() {
  const params = useParams({ strict: false });
  const navigate = useNavigate({});
  const convex = useConvex();
  const teamSlug = typeof params.teamSlug === "string" ? params.teamSlug : "";

  const { context, team, members } = useSettingsData({ teamSlug });
  const invites = useQuery(
    api.teams.getInvites,
    team ? { teamId: team._id } : "skip",
  );
  const projects = useQuery(
    api.projects.list,
    team ? { teamId: team._id } : "skip",
  );
  const updateTeam = useMutation(api.teams.update);
  const deleteTeam = useMutation(api.teams.deleteTeam);
  const inviteMember = useMutation(api.teams.inviteMember);
  const removeMember = useMutation(api.teams.removeMember);
  const updateRole = useMutation(api.teams.updateMemberRole);
  const revokeInvite = useMutation(api.teams.revokeInvite);
  const confirmDialog = useConfirmDialog();
  const toast = useToast();

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  // Optional invite-time storage scope: when on, the invitee is
  // restricted to the selected projects (storage-enforced via the vended
  // credential). Off = full team access.
  const [scopeRestricted, setScopeRestricted] = useState(false);
  const [scopedProjectIds, setScopedProjectIds] = useState<Set<string>>(
    new Set(),
  );
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const prewarmTeamIntentHandlers = useRoutePrewarmIntent(() => {
    if (!team?.slug) return;
    return prewarmTeam(convex, { teamSlug: team.slug });
  });

  // resolveContext looks the team up by exact slug, so a team that
  // resolves is already canonical for this route. The previous
  // hand-rolled `pathname.endsWith("/settings")` comparison could stay
  // true forever (canonicalPath never matching pathname), which both
  // wedged the page on "Loading…" and fired an endless replace-navigate
  // loop — that's the "settings won't load" bug. Trust the server's
  // authoritative `isCanonical` signal instead, and never block the
  // render on a redirect that's merely in flight.
  const needsCanonicalRedirect =
    context != null && context.isCanonical === false;

  useEffect(() => {
    if (needsCanonicalRedirect && context) {
      navigate({ to: `${context.canonicalPath}/settings`, replace: true });
    }
  }, [needsCanonicalRedirect, context, navigate]);

  if (context === undefined) {
    return (
      <div className="surface-soft flex h-full items-center justify-center bg-[#FAFAFA]">
        <div className="text-sm text-[#6E6E73]">Loading…</div>
      </div>
    );
  }

  if (context === null) {
    return (
      <div className="surface-soft flex h-full items-center justify-center bg-[#FAFAFA]">
        <div className="text-sm text-[#6E6E73]">Team not found</div>
      </div>
    );
  }

  const isOwner = team.role === "owner";
  const isAdmin = team.role === "owner" || team.role === "admin";

  const handleSaveName = async () => {
    if (!editedName.trim()) return;
    try {
      await updateTeam({ teamId: team._id, name: editedName.trim() });
      setIsEditingName(false);
    } catch (error) {
      console.error("Failed to update team name:", error);
    }
  };

  // The old native confirmation could only return OK or Cancel. It could not collect the
  // team name it was asking for, so the old second prompt was satisfied
  // by a second OK. Deleting every project, video and member needs a
  // real typed confirmation and a visible failure.
  const handleDeleteTeam = async () => {
    if (deleteConfirmName.trim() !== team.name) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteTeam({ teamId: team._id });
      navigate({ to: dashboardHomePath() });
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Could not delete this team.",
      );
      setDeleting(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || inviting) return;
    setInviteError(null);
    setInviting(true);
    try {
      const folderScope =
        scopeRestricted && team.slug
          ? [...scopedProjectIds].map(
              (pid) => `projects/${team.slug}/${pid}/`,
            )
          : [];
      const token = await inviteMember({
        teamId: team._id,
        email: inviteEmail.trim(),
        role: inviteRole,
        folderScope: folderScope.length > 0 ? folderScope : undefined,
      });
      const baseUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      setLastInviteLink(`${baseUrl}/invite/${token}`);
      setInviteEmail("");
      setScopeRestricted(false);
      setScopedProjectIds(new Set());
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Couldn't send invite.");
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = async () => {
    if (!lastInviteLink) return;
    try {
      await navigator.clipboard.writeText(lastInviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignored — clipboard may be blocked
    }
  };

  const handleRoleChange = async (
    membershipId: Id<"teamMembers">,
    role: Role,
  ) => {
    try {
      await updateRole({ teamId: team._id, membershipId, role });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update role.");
    }
  };

  const handleRemoveMember = async (
    membershipId: Id<"teamMembers">,
    name: string,
  ) => {
    await confirmDialog({
      title: "Remove member",
      description: `${name} will lose access to ${team.name}.`,
      confirmLabel: "Remove",
      variant: "destructive",
      action: () => removeMember({ teamId: team._id, membershipId }),
      errorMessage: (error) =>
        error instanceof Error ? error.message : "Couldn't remove member.",
    });
  };

  const handleRevoke = async (inviteId: Id<"teamInvites">) => {
    try {
      await revokeInvite({ teamId: team._id, inviteId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't revoke invite.");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <DashboardHeader
        paths={[
          {
            label: team.slug,
            href: teamHomePath(team.slug),
            prewarmIntentHandlers: prewarmTeamIntentHandlers,
          },
          { label: "Members" },
        ]}
      />

      <div className="surface-soft flex-1 overflow-auto bg-[#FAFAFA] text-[#131315]">
        <div className="w-full max-w-[1120px] space-y-3.5 px-4 py-8 sm:px-8 lg:px-14 lg:py-10">
          {/* ── Team identity ── */}
          <section className={softCard}>
            <SoftPill>Workspace</SoftPill>
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="h-auto px-2 py-1 text-[22px] font-semibold tracking-[-0.02em]"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveName();
                    if (e.key === "Escape") setIsEditingName(false);
                  }}
                />
                <Button
                  size="sm"
                  className={softButtonPrimary}
                  onClick={() => void handleSaveName()}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={softButton}
                  onClick={() => setIsEditingName(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-baseline gap-3 group">
                <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em]">
                  {team.name}
                </h1>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setEditedName(team.name);
                      setIsEditingName(true);
                    }}
                    className="text-[#A0A0A5] transition-colors hover:text-[#131315] opacity-0 group-hover:opacity-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {team.onboarding ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <SoftPill>{team.onboarding.makes}</SoftPill>
                <SoftPill>{team.onboarding.size}</SoftPill>
              </div>
            ) : null}
            <p className={cn(softHelperText, "mt-3 break-all")}>
              {typeof window !== "undefined"
                ? `${window.location.origin}${teamHomePath(team.slug)}`
                : teamHomePath(team.slug)}
            </p>
          </section>

          {/* ── Invite member (inline, no dialog) ── */}
          {isAdmin ? (
            <section className={softCard}>
              <div className="mb-3 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[#6E6E73]" />
                <h2 className="text-base font-semibold leading-[22px]">
                  Invite a member
                </h2>
              </div>
              <form
                onSubmit={(e) => void handleInvite(e)}
                className="flex flex-col sm:flex-row gap-2"
              >
                <Input
                  type="email"
                  placeholder="teammate@studio.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={inviting}
                  className={cn(softInput, "flex-1")}
                />
                <RolePicker
                  value={inviteRole}
                  onChange={setInviteRole}
                  disabled={inviting}
                />
                <Button
                  type="submit"
                  className={softButtonPrimary}
                  disabled={
                    inviting ||
                    !inviteEmail.trim() ||
                    (scopeRestricted && scopedProjectIds.size === 0)
                  }
                >
                  <Mail className="h-4 w-4 mr-1.5" />
                  {inviting ? "Sending…" : "Invite"}
                </Button>
              </form>

              {/* Optional storage scope: restrict the invitee to specific
                  projects. Off → full team access (the efficient default). */}
              {projects && projects.length > 0 ? (
                <div className="mt-3 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-3.5">
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium leading-[18px] text-[#6E6E73]">
                    <input
                      type="checkbox"
                      checked={scopeRestricted}
                      onChange={(e) => setScopeRestricted(e.target.checked)}
                      disabled={inviting}
                      className="h-4 w-4 accent-[#FF6600]"
                    />
                    Project access
                  </label>
                  {scopeRestricted ? (
                    <div className="mt-2 max-h-40 overflow-auto space-y-1">
                      {projects.map((p) => (
                        <label
                          key={p._id}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={scopedProjectIds.has(p._id)}
                            onChange={(e) =>
                              setScopedProjectIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(p._id);
                                else next.delete(p._id);
                                return next;
                              })
                            }
                            disabled={inviting}
                            className="h-4 w-4 accent-[#FF6600]"
                          />
                          {p.name}
                        </label>
                      ))}
                      {scopedProjectIds.size === 0 ? (
                        <p className="text-[13px] leading-[18px] text-[#D8434F]">
                          Pick a project, or clear the restriction.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className={cn(softHelperText, "mt-1")}>
                      Full access to all current and future team projects.
                    </p>
                  )}
                </div>
              ) : null}
              {inviteError ? (
                <div className="mt-2 text-[13px] leading-[18px] text-[#D8434F]">
                  {inviteError}
                </div>
              ) : null}
              {lastInviteLink ? (
                <div className="mt-3 flex items-center gap-2 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-2.5">
                  <code className="flex-1 text-xs font-mono truncate">
                    {lastInviteLink}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={softButton}
                    onClick={() => void copyInviteLink()}
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        Copy link
                      </>
                    )}
                  </Button>
                </div>
              ) : null}
              <p className={cn(softHelperText, "mt-3")}>
                {ROLE_HELP[inviteRole]}
              </p>
            </section>
          ) : null}

          {/* ── Pending invites ── */}
          {invites && invites.length > 0 ? (
            <section>
              <h2 className="mb-2 text-base font-semibold leading-[22px]">
                Pending invites ({invites.length})
              </h2>
              <div className="divide-y divide-[#F1F1F3] rounded-[14px] border border-[#E8E8EC] bg-white">
                {invites.map((inv) => (
                  <div
                    key={inv._id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <Mail className="h-4 w-4 flex-shrink-0 text-[#A0A0A5]" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium leading-5 text-[#131315]">
                        {inv.email}
                      </div>
                      <div className="text-[13px] leading-[18px] text-[#A0A0A5]">
                        Invited as {ROLE_LABEL[inv.role as Role] ?? inv.role},{" "}
                        {inv.folderScope && inv.folderScope.length > 0
                          ? `scoped to ${inv.folderScope.length} project${inv.folderScope.length === 1 ? "" : "s"}`
                          : "full access"}, expires{" "}
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                    {isAdmin ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className={softButton}
                        onClick={() => void handleRevoke(inv._id)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* ── Members list ── */}
          <section>
            <h2 className="mb-2 text-base font-semibold leading-[22px]">
              Members ({members?.length ?? 0})
            </h2>
            <div className="divide-y divide-[#F1F1F3] rounded-[14px] border border-[#E8E8EC] bg-white">
              {members === undefined ? (
                <div className="px-4 py-3 text-sm text-[#6E6E73]">Loading…</div>
              ) : members.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[#6E6E73]">
                  No members yet.
                </div>
              ) : (
                members.map((member) => {
                  const isTeamOwner =
                    team.ownerClerkId === member.userClerkId;
                  return (
                    <div
                      key={member._id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        {member.userAvatarUrl ? (
                          <AvatarImage
                            src={member.userAvatarUrl}
                            alt={member.userName}
                          />
                        ) : null}
                        <AvatarFallback>
                          {getInitials(member.userName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 truncate text-sm font-medium leading-5 text-[#131315]">
                          {member.userName}
                          {isTeamOwner ? (
                            <SoftPill>Owner</SoftPill>
                          ) : null}
                        </div>
                        <div className="truncate text-[13px] leading-[18px] text-[#A0A0A5]">
                          {member.userEmail}
                        </div>
                      </div>
                      {isAdmin && !isTeamOwner ? (
                        <>
                          <RolePicker
                            value={member.role as Role}
                            onChange={(role) =>
                              void handleRoleChange(member._id, role)
                            }
                            compact
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className={softButtonDanger}
                            onClick={() =>
                              void handleRemoveMember(
                                member._id,
                                member.userName,
                              )
                            }
                            title="Remove"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <SoftPill>
                          {ROLE_LABEL[member.role as Role] ?? member.role}
                        </SoftPill>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* ── Danger zone ── */}
          {isOwner ? (
            <section className="flex items-center justify-between border-t border-[#F0D2D4] pt-6">
              <div>
                <p className="text-sm font-semibold text-[#131315]">Delete team</p>
                <p className="mt-0.5 text-sm text-[#6E6E73]">
                  Permanently remove this team, all projects, and videos.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className={softButtonDanger}
                onClick={() => {
                  setDeleteConfirmName("");
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </section>
          ) : null}

          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogContent className="surface-soft max-w-md rounded-[14px] border border-[#E8E8EC] bg-white p-6 text-[#131315] shadow-none">
              <DialogHeader>
                <DialogTitle className="text-base font-semibold">
                  Delete {team.name}?
                </DialogTitle>
                <DialogDescription className="text-sm text-[#6E6E73]">
                  This removes every project, video, folder and member in this
                  team. It cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <label
                htmlFor="delete-confirm"
                className="mt-4 block text-sm text-[#6E6E73]"
              >
                Type <span className="font-medium text-[#131315]">{team.name}</span> to confirm
              </label>
              <Input
                id="delete-confirm"
                value={deleteConfirmName}
                autoComplete="off"
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                className={cn(softInput, "mt-1.5")}
              />
              {deleteError ? (
                <p className="mt-2 text-sm text-[#D8434F]">{deleteError}</p>
              ) : null}
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className={softButton}
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className={softButtonDanger}
                  disabled={deleting || deleteConfirmName.trim() !== team.name}
                  onClick={() => void handleDeleteTeam()}
                >
                  {deleting ? "Deleting…" : "Delete team"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

function RolePicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: Role;
  onChange: (next: Role) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            softButton,
            "inline-flex items-center gap-1",
            compact ? "px-2 py-1" : "px-3 py-2",
          )}
        >
          {ROLE_LABEL[value]}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="surface-soft min-w-[180px] rounded-[11px] border border-[#E8E8EC] bg-white p-1 shadow-none"
      >
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
          <DropdownMenuItem
            key={r}
            onClick={() => onChange(r)}
            className="flex-col items-start gap-0.5 rounded-[10px]"
          >
            <span className="font-medium">{ROLE_LABEL[r]}</span>
            <span className="text-[13px] font-normal leading-[18px] text-[#A0A0A5]">
              {ROLE_HELP[r]}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
