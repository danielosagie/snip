"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Globe, Lock, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Drive/Frame.io-style access control for a single share link: general access
 * (anyone-with-link vs invite-only), default role, a per-email people list with
 * roles, and permission toggles (comments / downloads / show all versions).
 * Changes auto-save against the link. Intended to be embedded in the share
 * dialogs under a "Manage access" expander.
 */

type ShareRole = "viewer" | "commenter" | "editor";

const ROLE_OPTIONS: { value: ShareRole; label: string }[] = [
  { value: "viewer", label: "Viewer" },
  { value: "commenter", label: "Commenter" },
  { value: "editor", label: "Editor" },
];

const SELECT_CLASS =
  "h-9 rounded-full border border-[#D8D8DE] bg-white px-3 text-[13px] font-medium text-[#131315] focus:border-[#D14E00] focus:outline-none focus:ring-2 focus:ring-[#FFF0E6]";

function Toggle({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`min-w-12 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        on
          ? "border-transparent bg-[#FFF0E6] text-[#D14E00]"
          : "border-[#D8D8DE] bg-white text-[#6E6E73] hover:bg-[#FAFAFA]"
      }`}
    >
      {on ? "On" : "Off"}
    </button>
  );
}

export function ShareAccessPanel({ linkId }: { linkId: Id<"shareLinks"> }) {
  const config = useQuery(api.shareLinks.getAccessConfig, { linkId });
  const rawSetAccess = useMutation(api.shareLinks.setAccess);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessPending, setAccessPending] = useState(false);

  /**
   * Every access control used to fire-and-forget. A rejected mutation left
   * the UI showing the new value while the link kept its old audience —
   * an owner could believe a link was restricted when it was public.
   * Surface the failure instead; the query is the source of truth and
   * re-renders the real value underneath.
   */
  const setAccess = async (args: Parameters<typeof rawSetAccess>[0]) => {
    setAccessPending(true);
    setAccessError(null);
    try {
      await rawSetAccess(args);
    } catch (error) {
      setAccessError(
        error instanceof Error
          ? error.message
          : "Couldn't update access. It hasn't changed.",
      );
    } finally {
      setAccessPending(false);
    }
  };
  const addInvite = useMutation(api.shareLinks.addInvite);
  const updateInviteRole = useMutation(api.shareLinks.updateInviteRole);
  const removeInvite = useMutation(api.shareLinks.removeInvite);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ShareRole>("commenter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (config === undefined) {
    return <p className="px-1 py-2 text-xs text-[#6E6E73]">Loading access…</p>;
  }
  if (config === null) {
    return <p className="px-1 py-2 text-xs text-[#6E6E73]">Link not found.</p>;
  }

  const isInvite = config.generalAccess === "invite";

  const handleAdd = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await addInvite({ linkId, email: trimmed, role: inviteRole });
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that person.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-[#E8E8EC] bg-[#FAFAFA] p-4">
      {accessError ? (
        <div
          role="status"
          className="rounded-[11px] border border-[#E8E8EC] bg-[#FFF5F5] px-3 py-2 text-sm text-[#8A2B34]"
        >
          {accessError}
        </div>
      ) : null}

      {/* General access */}
      <div className="space-y-1.5">
        <div className="font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
          General access
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="General access"
            value={config.generalAccess}
            onChange={(e) =>
              void setAccess({
                linkId,
                generalAccess: e.target.value as "anyone" | "invite",
              })
            }
            disabled={accessPending}
            className={SELECT_CLASS}
          >
            <option value="anyone">Anyone with the link</option>
            <option value="invite">Invite only</option>
          </select>
          {isInvite ? (
            <span className="flex items-center gap-1 text-xs text-[#6E6E73]">
              <Lock className="h-3.5 w-3.5" /> Restricted
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1 text-xs text-[#6E6E73]">
                <Globe className="h-3.5 w-3.5" /> as
              </span>
              <select
                aria-label="Default role"
                value={config.defaultRole}
                onChange={(e) =>
                  void setAccess({
                    linkId,
                    defaultRole: e.target.value as ShareRole,
                  })
                }
                className={SELECT_CLASS}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        {isInvite ? (
          <div className="flex items-center justify-between rounded-[11px] border border-[#E8E8EC] bg-white px-3 py-2">
            <div className="min-w-0 pr-2">
              <div className="text-sm font-semibold text-[#131315]">Anyone in this workspace</div>
              <div className="text-[11px] text-[#6E6E73]">
                Teammates can open this link without an invite, as{" "}
                {config.defaultRole}.
              </div>
            </div>
            <Toggle
              on={config.allowTeamAccess}
              onClick={() =>
                void setAccess({
                  linkId,
                  allowTeamAccess: !config.allowTeamAccess,
                })
              }
            />
          </div>
        ) : null}
      </div>

      {/* People */}
      <div className="space-y-2">
        <div className="font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
          People with access
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@email.com"
            className="h-8"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAdd();
              }
            }}
          />
          <select
            aria-label="Invite role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as ShareRole)}
            className={SELECT_CLASS}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleAdd()}
            disabled={busy || !email.trim()}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        {error ? <p className="text-xs text-[#8A2B34]">{error}</p> : null}

        {config.invites.length === 0 ? (
          <p className="text-xs text-[#6E6E73]">
            {isInvite
              ? "No one has been invited. Add people above to give them access."
              : "Add people to give specific addresses a fixed role, including if you switch to invite only."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-white divide-y divide-[#F1F1F3]">
            {config.invites.map((invite) => (
              <div
                key={invite._id}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-[#131315]">
                  {invite.email}
                </span>
                <select
                  aria-label={`Role for ${invite.email}`}
                  value={invite.role}
                  onChange={(e) =>
                    void updateInviteRole({
                      inviteId: invite._id,
                      role: e.target.value as ShareRole,
                    })
                  }
                  className={SELECT_CLASS}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-[#D8434F] hover:bg-[#FFF5F5] hover:text-[#D8434F]"
                  onClick={() => void removeInvite({ inviteId: invite._id })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Permissions */}
      <div className="space-y-2">
        <div className="font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
          Permissions
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between rounded-[11px] border border-[#E8E8EC] bg-white px-3 py-2">
            <span className="text-sm font-semibold text-[#131315]">Comments</span>
            <Toggle
              on={config.commentsEnabled}
              onClick={() =>
                void setAccess({ linkId, commentsEnabled: !config.commentsEnabled })
              }
            />
          </div>
          <div className="flex items-center justify-between rounded-[11px] border border-[#E8E8EC] bg-white px-3 py-2">
            <span className="text-sm font-semibold text-[#131315]">Downloads</span>
            <Toggle
              on={config.allowDownload}
              onClick={() =>
                void setAccess({ linkId, allowDownload: !config.allowDownload })
              }
            />
          </div>
          <div className="flex items-center justify-between rounded-[11px] border border-[#E8E8EC] bg-white px-3 py-2">
            <span className="text-sm font-semibold text-[#131315]">Show all versions</span>
            <Toggle
              on={config.showAllVersions}
              onClick={() =>
                void setAccess({ linkId, showAllVersions: !config.showAllVersions })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
