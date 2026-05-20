import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { dashboardHomePath, teamHomePath } from "@/lib/routes";
import { getInitials } from "@/lib/utils";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";
import { useSettingsData } from "./-settings.data";
import { prewarmTeam } from "./-team.data";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Id } from "@convex/_generated/dataModel";

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
  const updateTeam = useMutation(api.teams.update);
  const deleteTeam = useMutation(api.teams.deleteTeam);
  const inviteMember = useMutation(api.teams.inviteMember);
  const removeMember = useMutation(api.teams.removeMember);
  const updateRole = useMutation(api.teams.updateMemberRole);
  const revokeInvite = useMutation(api.teams.revokeInvite);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
      <div className="flex items-center justify-center h-full">
        <div className="text-[#888]">Loading…</div>
      </div>
    );
  }

  if (context === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#888]">Team not found</div>
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

  const handleDeleteTeam = async () => {
    if (
      !confirm(
        "Delete this team? Every project, video, and member is removed permanently.",
      )
    ) {
      return;
    }
    if (!confirm(`Type the team name to confirm: ${team.name}`)) return;

    try {
      await deleteTeam({ teamId: team._id });
      navigate({ to: dashboardHomePath() });
    } catch (error) {
      console.error("Failed to delete team:", error);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || inviting) return;
    setInviteError(null);
    setInviting(true);
    try {
      const token = await inviteMember({
        teamId: team._id,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      const baseUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      setLastInviteLink(`${baseUrl}/invite/${token}`);
      setInviteEmail("");
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
      alert(e instanceof Error ? e.message : "Couldn't update role.");
    }
  };

  const handleRemoveMember = async (
    membershipId: Id<"teamMembers">,
    name: string,
  ) => {
    if (!confirm(`Remove ${name} from ${team.name}?`)) return;
    try {
      await removeMember({ teamId: team._id, membershipId });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't remove member.");
    }
  };

  const handleRevoke = async (inviteId: Id<"teamInvites">) => {
    try {
      await revokeInvite({ teamId: team._id, inviteId });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't revoke invite.");
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
          { label: "members" },
        ]}
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 py-8 space-y-10">
          {/* ── Team identity ── */}
          <section>
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-1">
              Workspace · members
            </p>
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="text-3xl font-black tracking-tight h-auto py-1 px-2"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveName();
                    if (e.key === "Escape") setIsEditingName(false);
                  }}
                />
                <Button size="sm" onClick={() => void handleSaveName()}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsEditingName(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-baseline gap-3 group">
                <h1 className="text-3xl lg:text-4xl font-black tracking-tight text-[#1a1a1a]">
                  {team.name}
                </h1>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setEditedName(team.name);
                      setIsEditingName(true);
                    }}
                    className="text-[#888] hover:text-[#1a1a1a] transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            <p className="text-sm text-[#666] mt-2 max-w-prose">
              Invite collaborators, set roles, and manage who has access to
              this workspace's projects.
            </p>
            <p className="text-xs font-mono text-[#888] mt-3">
              {typeof window !== "undefined"
                ? `${window.location.origin}${teamHomePath(team.slug)}`
                : teamHomePath(team.slug)}
            </p>
          </section>

          {/* ── Invite member (inline, no dialog) ── */}
          {isAdmin ? (
            <section className="border-2 border-[#1a1a1a] p-5 bg-[#f0f0e8]">
              <div className="flex items-center gap-2 mb-3">
                <UserPlus className="h-4 w-4" />
                <h2 className="font-black text-sm uppercase tracking-tight">
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
                  className="flex-1"
                />
                <RolePicker
                  value={inviteRole}
                  onChange={setInviteRole}
                  disabled={inviting}
                />
                <Button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="bg-[#FF6600] hover:bg-[#FF7A1F]"
                >
                  <Mail className="h-4 w-4 mr-1.5" />
                  {inviting ? "Sending…" : "Invite"}
                </Button>
              </form>
              {inviteError ? (
                <div className="text-xs font-bold text-[#dc2626] mt-2">
                  {inviteError}
                </div>
              ) : null}
              {lastInviteLink ? (
                <div className="mt-3 border-2 border-[#1a1a1a] bg-[#e8e8e0] p-2 flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono truncate">
                    {lastInviteLink}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
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
              <p className="text-xs text-[#666] mt-3">
                {ROLE_HELP[inviteRole]}
              </p>
            </section>
          ) : null}

          {/* ── Pending invites ── */}
          {invites && invites.length > 0 ? (
            <section>
              <h2 className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-3">
                Pending invites ({invites.length})
              </h2>
              <div className="border-2 border-[#1a1a1a] divide-y divide-[#ccc] bg-[#f0f0e8]">
                {invites.map((inv) => (
                  <div
                    key={inv._id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <Mail className="h-4 w-4 text-[#888] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-[#1a1a1a] truncate">
                        {inv.email}
                      </div>
                      <div className="text-xs font-mono text-[#888]">
                        Invited as {ROLE_LABEL[inv.role as Role] ?? inv.role}{" "}
                        · expires{" "}
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                    {isAdmin ? (
                      <Button
                        size="sm"
                        variant="outline"
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
            <h2 className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-3">
              Members ({members?.length ?? 0})
            </h2>
            <div className="border-2 border-[#1a1a1a] divide-y divide-[#ccc] bg-[#f0f0e8]">
              {members === undefined ? (
                <div className="px-4 py-3 text-sm text-[#888]">Loading…</div>
              ) : members.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[#888]">
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
                        <div className="font-bold text-sm text-[#1a1a1a] truncate flex items-center gap-2">
                          {member.userName}
                          {isTeamOwner ? (
                            <Badge variant="secondary">Owner</Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-[#888] truncate">
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
                            className="text-[#dc2626] hover:text-[#dc2626]"
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
                        <Badge variant="secondary">
                          {ROLE_LABEL[member.role as Role] ?? member.role}
                        </Badge>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* ── Danger zone ── */}
          {isOwner ? (
            <section className="border-t-2 border-[#dc2626]/30 pt-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-[#1a1a1a]">Delete team</p>
                <p className="text-xs text-[#888] mt-0.5">
                  Permanently remove this team, all projects, and videos.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDeleteTeam()}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </section>
          ) : null}
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
          className={
            "inline-flex items-center gap-1 border-2 border-[#1a1a1a] bg-[#f0f0e8] text-xs font-bold uppercase tracking-wider hover:bg-[#e8e8e0] " +
            (compact ? "px-2 py-1" : "px-3 py-2")
          }
        >
          {ROLE_LABEL[value]}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
          <DropdownMenuItem
            key={r}
            onClick={() => onChange(r)}
            className="flex-col items-start gap-0.5"
          >
            <span className="font-bold">{ROLE_LABEL[r]}</span>
            <span className="text-[10px] text-[#888] normal-case font-normal">
              {ROLE_HELP[r]}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
