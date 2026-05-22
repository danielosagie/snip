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
  "h-8 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2 text-xs font-bold text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#C2410C]";

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
      className={`px-3 py-1 border-2 border-[#1a1a1a] font-bold text-xs disabled:opacity-50 ${
        on ? "bg-[#FF6600] text-[#f0f0e8]" : "bg-[#e8e8e0] text-[#1a1a1a]"
      }`}
    >
      {on ? "ON" : "OFF"}
    </button>
  );
}

export function ShareAccessPanel({ linkId }: { linkId: Id<"shareLinks"> }) {
  const config = useQuery(api.shareLinks.getAccessConfig, { linkId });
  const setAccess = useMutation(api.shareLinks.setAccess);
  const addInvite = useMutation(api.shareLinks.addInvite);
  const updateInviteRole = useMutation(api.shareLinks.updateInviteRole);
  const removeInvite = useMutation(api.shareLinks.removeInvite);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ShareRole>("commenter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (config === undefined) {
    return <p className="text-xs text-[#888] px-1 py-2">Loading access…</p>;
  }
  if (config === null) {
    return <p className="text-xs text-[#888] px-1 py-2">Link not found.</p>;
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
    <div className="space-y-4 border-t-2 border-[#1a1a1a] bg-[#e8e8e0] p-3">
      {/* General access */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#888]">
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
            className={SELECT_CLASS}
          >
            <option value="anyone">Anyone with the link</option>
            <option value="invite">Invite only</option>
          </select>
          {isInvite ? (
            <span className="flex items-center gap-1 text-xs text-[#888]">
              <Lock className="h-3.5 w-3.5" /> Restricted
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1 text-xs text-[#888]">
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
      </div>

      {/* People */}
      <div className="space-y-2">
        <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#888]">
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
        {error ? <p className="text-xs text-[#dc2626]">{error}</p> : null}

        {config.invites.length === 0 ? (
          <p className="text-xs text-[#888]">
            {isInvite
              ? "No one's been invited yet — add people above so they can open this link."
              : "Add people to give specific addresses a fixed role (also used if you switch to Invite only)."}
          </p>
        ) : (
          <div className="divide-y-2 divide-[#1a1a1a] border-2 border-[#1a1a1a] bg-[#f0f0e8]">
            {config.invites.map((invite) => (
              <div
                key={invite._id}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-[#1a1a1a]">
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
                  className="text-[#dc2626] hover:text-[#dc2626]"
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
        <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#888]">
          Permissions
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between border-2 border-[#1a1a1a] bg-[#f0f0e8] px-3 py-2">
            <span className="text-sm font-bold">Comments</span>
            <Toggle
              on={config.commentsEnabled}
              onClick={() =>
                void setAccess({ linkId, commentsEnabled: !config.commentsEnabled })
              }
            />
          </div>
          <div className="flex items-center justify-between border-2 border-[#1a1a1a] bg-[#f0f0e8] px-3 py-2">
            <span className="text-sm font-bold">Downloads</span>
            <Toggle
              on={config.allowDownload}
              onClick={() =>
                void setAccess({ linkId, allowDownload: !config.allowDownload })
              }
            />
          </div>
          <div className="flex items-center justify-between border-2 border-[#1a1a1a] bg-[#f0f0e8] px-3 py-2">
            <span className="text-sm font-bold">Show all versions</span>
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
