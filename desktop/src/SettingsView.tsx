/**
 * Settings — mirrors the web app's settings surfaces, no search, everything
 * in one tabbed page:
 *
 *   Profile · Notifications · Integrations · Team · Folders · Drive
 *
 * Account/team data comes from the same Convex functions the web settings
 * use. The Drive tab is desktop-only (mount + auto-update + a tucked-away
 * Advanced escape hatch for self-host credentials).
 */

import { useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import type { ConvexClient } from "convex/browser";
import { api, DesktopSettings, MountState, UpdateState } from "./api";
import { useConvexQuery, callMutation } from "./useConvex";
import { C, mono, Eyebrow, Field, Pill, Banner, Glyph } from "./ui";

type Tab = "profile" | "notifications" | "integrations" | "team" | "folders" | "drive";
const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "notifications", label: "Notifications" },
  { id: "integrations", label: "Integrations" },
  { id: "team", label: "Team" },
  { id: "folders", label: "Folders" },
  { id: "drive", label: "Drive" },
];

interface Props {
  client: ConvexClient | null;
  settings: DesktopSettings;
  onChange: (next: DesktopSettings) => Promise<void>;
  mount: MountState | null;
}

interface TeamLite {
  _id: string;
  name: string;
  slug: string;
  role: string;
}

export function SettingsView({ client, settings, mount }: Props) {
  const [tab, setTab] = useState<Tab>("profile");
  const teams = useConvexQuery<TeamLite[]>(client, "teams:listWithProjects", {});
  const [teamId, setTeamId] = useState<string | null>(null);
  const activeTeamId = teamId ?? teams?.[0]?._id ?? null;

  return (
    <div style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <Eyebrow>Settings</Eyebrow>
      <h1 style={{ fontSize: 30, marginTop: 6, marginBottom: 16 }}>
        Settings<span style={{ color: C.accent }}>.</span>
      </h1>

      {/* Tab strip */}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 20,
          borderBottom: `2px solid ${C.border}`,
          paddingBottom: 12,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 12px",
              fontFamily: mono,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              background: tab === t.id ? C.fg : "transparent",
              color: tab === t.id ? C.bg : C.fg,
              border: `2px solid ${tab === t.id ? C.border : "transparent"}`,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" ? (
        <ProfileTab />
      ) : tab === "notifications" ? (
        <NotificationsTab client={client} />
      ) : tab === "integrations" ? (
        <IntegrationsTab client={client} />
      ) : tab === "team" ? (
        <TeamTab client={client} teams={teams ?? []} activeTeamId={activeTeamId} onSelectTeam={setTeamId} />
      ) : tab === "folders" ? (
        <FoldersTab client={client} teams={teams ?? []} activeTeamId={activeTeamId} onSelectTeam={setTeamId} />
      ) : (
        <DriveTab settings={settings} mount={mount} />
      )}
    </div>
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────

function ProfileTab() {
  const { user } = useUser();
  return (
    <Panel title="Profile">
      <ReadField label="Name" value={user?.fullName ?? user?.firstName ?? "—"} />
      <ReadField label="Email" value={user?.primaryEmailAddress?.emailAddress ?? "—"} />
      <p style={{ fontSize: 11, color: C.muted, margin: "6px 0 0" }}>
        Name and email come from your snip account. Manage them from the account
        menu in the web app.
      </p>
    </Panel>
  );
}

// ─── Notifications ──────────────────────────────────────────────────────────

interface Prefs {
  commentReply: boolean;
  contractSigned: boolean;
  uploadFinished: boolean;
}

function NotificationsTab({ client }: { client: ConvexClient | null }) {
  const prefs = useConvexQuery<Prefs>(client, "notifications:getMyPrefs", {});
  const set = (patch: Partial<Prefs>) =>
    void callMutation(client, "notifications:updateMyPrefs", patch).catch(() => {});

  return (
    <Panel title="Email notifications">
      {prefs === undefined ? (
        <Muted>Loading…</Muted>
      ) : (
        <>
          <Toggle
            label="Comment replies"
            hint="Email me when someone replies to a thread I'm in."
            checked={prefs.commentReply}
            onChange={(v) => set({ commentReply: v })}
          />
          <Toggle
            label="Contract signatures"
            hint="Email me when a contract on one of my projects is signed."
            checked={prefs.contractSigned}
            onChange={(v) => set({ contractSigned: v })}
          />
          <Toggle
            label="Upload completion"
            hint="Email me when a long upload finishes (over 5 minutes)."
            checked={prefs.uploadFinished}
            onChange={(v) => set({ uploadFinished: v })}
          />
        </>
      )}
    </Panel>
  );
}

// ─── Integrations ───────────────────────────────────────────────────────────

interface FeatureStatus {
  stripeConnect: boolean;
  muxIngest: boolean;
  muxSignedPlayback: boolean;
  objectStorage: boolean;
  usingR2: boolean;
}

function IntegrationsTab({ client }: { client: ConvexClient | null }) {
  const status = useConvexQuery<FeatureStatus>(client, "featureFlags:getFeatureStatus", {});
  return (
    <Panel title="Connected services">
      {status === undefined ? (
        <Muted>Loading…</Muted>
      ) : (
        <>
          <StatusRow label="Object storage" ok={status.objectStorage} note={status.usingR2 ? "Cloudflare R2" : "Railway S3"} />
          <StatusRow label="Mux ingest" ok={status.muxIngest} />
          <StatusRow label="Mux signed playback" ok={status.muxSignedPlayback} />
          <StatusRow label="Stripe Connect (payouts)" ok={status.stripeConnect} />
        </>
      )}
    </Panel>
  );
}

// ─── Team ───────────────────────────────────────────────────────────────────

interface Member {
  _id: string;
  userClerkId: string;
  userName?: string;
  userEmail?: string;
  role: "owner" | "admin" | "member" | "viewer" | string;
}
interface Invite {
  _id: string;
  email: string;
  role: string;
  expiresAt: number;
}
type InviteRole = "admin" | "member" | "viewer";

function TeamTab({
  client,
  teams,
  activeTeamId,
  onSelectTeam,
}: {
  client: ConvexClient | null;
  teams: TeamLite[];
  activeTeamId: string | null;
  onSelectTeam: (id: string) => void;
}) {
  const members = useConvexQuery<Member[]>(
    client,
    "teams:getMembers",
    activeTeamId ? { teamId: activeTeamId } : "skip",
  );
  const invites = useConvexQuery<Invite[]>(
    client,
    "teams:getInvites",
    activeTeamId ? { teamId: activeTeamId } : "skip",
  );

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!activeTeamId)
    return (
      <Panel title="Team">
        <Muted>No workspace.</Muted>
      </Panel>
    );

  const invite = async () => {
    setErr(null);
    setInviteToken(null);
    try {
      const res = await callMutation<{ token: string }>(client, "teams:inviteMember", {
        teamId: activeTeamId,
        email: email.trim(),
        role,
      });
      setEmail("");
      setInviteToken(res.token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invite failed.");
    }
  };

  return (
    <>
      <TeamPicker teams={teams} activeTeamId={activeTeamId} onSelect={onSelectTeam} />

      <Panel title="Invite a member">
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Field label="Email">
              <input
                type="email"
                placeholder="teammate@studio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: "100%" }}
              />
            </Field>
          </div>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </Field>
          <button className="primary" onClick={() => void invite()} disabled={!email.trim()}>
            Invite
          </button>
        </div>
        {err ? (
          <div style={{ marginTop: 10 }}>
            <Banner tone="danger">{err}</Banner>
          </div>
        ) : null}
        {inviteToken ? (
          <div style={{ marginTop: 10 }}>
            <Banner tone="ok">
              Invite created. Share this link:{" "}
              <code style={{ fontSize: 11, wordBreak: "break-all" }}>/invite/{inviteToken}</code>
            </Banner>
          </div>
        ) : null}
      </Panel>

      {invites && invites.length > 0 ? (
        <Panel title="Pending invites">
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {invites.map((iv) => (
              <li key={iv._id} style={rowLi}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{iv.email}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>invited as {iv.role}</div>
                </div>
                <button
                  className="ghost"
                  onClick={() =>
                    void callMutation(client, "teams:revokeInvite", {
                      teamId: activeTeamId,
                      inviteId: iv._id,
                    }).catch(() => {})
                  }
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Members">
        {members === undefined ? (
          <Muted>Loading…</Muted>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {members.map((m) => (
              <li key={m._id} style={rowLi}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    {m.userName || m.userEmail || m.userClerkId.slice(0, 8)}
                  </div>
                  {m.userEmail ? <div style={{ fontSize: 11, color: C.muted }}>{m.userEmail}</div> : null}
                </div>
                {m.role === "owner" ? (
                  <Pill tone="accent">owner</Pill>
                ) : (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) =>
                        void callMutation(client, "teams:updateMemberRole", {
                          teamId: activeTeamId,
                          membershipId: m._id,
                          role: e.target.value,
                        }).catch(() => {})
                      }
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      className="ghost"
                      onClick={() => {
                        if (confirm(`Remove ${m.userName || m.userEmail || "this member"}?`))
                          void callMutation(client, "teams:removeMember", {
                            teamId: activeTeamId,
                            membershipId: m._id,
                          }).catch(() => {});
                      }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

// ─── Folder permissions ─────────────────────────────────────────────────────

interface Grant {
  _id: string;
  pathPrefix: string;
  allowedRoles: string[];
  allowedClerkIds: string[];
  note?: string;
}
const ALL_ROLES = ["owner", "admin", "member", "viewer"];

function FoldersTab({
  client,
  teams,
  activeTeamId,
  onSelectTeam,
}: {
  client: ConvexClient | null;
  teams: TeamLite[];
  activeTeamId: string | null;
  onSelectTeam: (id: string) => void;
}) {
  const grants = useConvexQuery<Grant[]>(
    client,
    "folderPermissions:listForTeam",
    activeTeamId ? { teamId: activeTeamId } : "skip",
  );
  const [prefix, setPrefix] = useState("");
  const [roles, setRoles] = useState<string[]>(["owner", "admin", "member"]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (!activeTeamId)
    return (
      <Panel title="Folder permissions">
        <Muted>No workspace.</Muted>
      </Panel>
    );

  const add = async () => {
    setErr(null);
    try {
      await callMutation(client, "folderPermissions:create", {
        teamId: activeTeamId,
        pathPrefix: prefix.trim(),
        allowedRoles: roles,
        allowedClerkIds: [],
        note: note.trim() || undefined,
      });
      setPrefix("");
      setNote("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add grant.");
    }
  };

  return (
    <>
      <TeamPicker teams={teams} activeTeamId={activeTeamId} onSelect={onSelectTeam} />

      <Panel title="Active grants">
        {grants === undefined ? (
          <Muted>Loading…</Muted>
        ) : grants.length === 0 ? (
          <Muted>No grants — every team member can see every folder.</Muted>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {grants.map((g) => (
              <li key={g._id} style={rowLi}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{g.pathPrefix}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>
                    {g.allowedRoles.join(", ")}
                    {g.allowedClerkIds.length ? ` · +${g.allowedClerkIds.length} people` : ""}
                    {g.note ? ` · ${g.note}` : ""}
                  </div>
                </div>
                <button
                  className="ghost"
                  onClick={() =>
                    void callMutation(client, "folderPermissions:remove", { permissionId: g._id }).catch(() => {})
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Add grant">
        <Field label="Path prefix">
          <input
            placeholder="projects/red-bull-spring/raw/"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            style={{ width: "100%", fontFamily: mono, fontSize: 12 }}
          />
        </Field>
        <div>
          <div
            style={{
              fontFamily: mono,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: C.muted,
              marginBottom: 6,
            }}
          >
            Allowed roles
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {ALL_ROLES.map((r) => (
              <label key={r} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={roles.includes(r)}
                  onChange={(e) =>
                    setRoles((cur) => (e.target.checked ? [...cur, r] : cur.filter((x) => x !== r)))
                  }
                />
                {r}
              </label>
            ))}
          </div>
        </div>
        <Field label="Note (optional)">
          <input
            placeholder="Raw masters — sound team only"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: "100%" }}
          />
        </Field>
        {err ? <Banner tone="danger">{err}</Banner> : null}
        <div>
          <button className="primary" onClick={() => void add()} disabled={!prefix.trim() || roles.length === 0}>
            Add grant
          </button>
        </div>
      </Panel>
    </>
  );
}

// ─── Drive (desktop-only) ───────────────────────────────────────────────────

function DriveTab({
  settings,
  mount,
}: {
  settings: DesktopSettings;
  mount: MountState | null;
}) {
  const status = mount?.status ?? "unmounted";
  const [busy, setBusy] = useState(false);

  const toggleMount = async () => {
    setBusy(true);
    try {
      if (status === "mounted" || status === "mounting") await api.mount.stop();
      else await api.mount.start({ mountPath: settings.rootDir });
    } catch {
      // surfaced via status chip
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel title="Cloud drive">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 14,
              height: 14,
              border: `2px solid ${C.border}`,
              background:
                status === "mounted"
                  ? C.ok
                  : status === "error"
                    ? C.danger
                    : status === "mounting"
                      ? "#b45309"
                      : C.muted,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {status === "mounted"
                ? "Connected"
                : status === "mounting"
                  ? "Connecting…"
                  : status === "error"
                    ? "Error"
                    : "Off"}
            </div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
              {mount?.mountPath ?? settings.rootDir}
            </div>
          </div>
          {status === "mounted" ? (
            <button className="ghost" onClick={() => void api.shell.openFolder(mount?.mountPath ?? settings.rootDir)}>
              Open in Finder
            </button>
          ) : null}
          <button onClick={() => void toggleMount()} disabled={busy}>
            {status === "mounted" || status === "mounting" ? "Disconnect" : "Connect"}
          </button>
        </div>
        {mount?.lastError ? (
          <Banner tone="danger">{mount.lastError}</Banner>
        ) : null}
        <p style={{ fontSize: 11, color: C.muted, margin: 0, lineHeight: 1.5 }}>
          The drive mounts automatically on launch. Your cloud bucket appears as a
          normal folder so Finder, Premiere, and Resolve can open project files
          directly.
        </p>
      </Panel>

      <UpdatesPanel />
    </>
  );
}

function UpdatesPanel() {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ status: "idle", version: null, percent: 0, error: null });
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void api.app.version().then(setVersion).catch(() => setVersion(null));
    void api.update.state().then(setUpdate).catch(() => {});
    return api.update.onStatus(setUpdate);
  }, []);

  const check = async () => {
    setChecking(true);
    setNote(null);
    try {
      const res = await api.update.check();
      if (!res.ok)
        setNote(res.reason === "dev" ? "Updates only run in the installed app." : `Couldn't check: ${res.reason ?? "error"}`);
    } catch (e) {
      setNote(`Couldn't check: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setChecking(false);
    }
  };
  const install = async () => {
    try {
      await api.update.install();
    } catch {
      /* ignore */
    }
  };

  const label =
    update.status === "downloaded"
      ? `Update ${update.version ?? ""} ready.`
      : update.status === "downloading"
        ? `Downloading… ${update.percent}%`
        : update.status === "available"
          ? `Update ${update.version ?? ""} found…`
          : update.status === "none"
            ? "You're on the latest version."
            : update.status === "error"
              ? `Update error: ${update.error ?? ""}`
              : "Up to date.";

  return (
    <Panel title="App updates">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            snip Desktop <span style={{ fontFamily: mono, color: C.muted }}>v{version ?? "—"}</span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{label}</div>
          {note ? <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{note}</div> : null}
        </div>
        {update.status === "downloaded" ? (
          <button className="primary" onClick={() => void install()}>
            Restart &amp; install
          </button>
        ) : (
          <button
            className="ghost"
            onClick={() => void check()}
            disabled={checking || update.status === "checking" || update.status === "available" || update.status === "downloading"}
          >
            {checking || update.status === "checking" ? "Checking…" : "Check for updates"}
          </button>
        )}
      </div>
    </Panel>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────

function TeamPicker({
  teams,
  activeTeamId,
  onSelect,
}: {
  teams: TeamLite[];
  activeTeamId: string;
  onSelect: (id: string) => void;
}) {
  if (teams.length <= 1) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <Field label="Workspace">
        <select value={activeTeamId} onChange={(e) => onSelect(e.target.value)}>
          {teams.map((t) => (
            <option key={t._id} value={t._id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: `2px solid ${C.border}`, marginBottom: 16 }}>
      <header
        style={{
          background: C.fg,
          color: C.bg,
          padding: "7px 14px",
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </header>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </Field>
  );
}

function StatusRow({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  return (
    <div style={rowLi}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
        {note ? <div style={{ fontSize: 11, color: C.muted }}>{note}</div> : null}
      </div>
      <Pill tone={ok ? "ok" : "neutral"}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {ok ? <Glyph name="check" size={12} /> : null}
          {ok ? "connected" : "off"}
        </span>
      </Pill>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
        {hint ? <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{hint}</div> : null}
      </div>
    </label>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: C.muted }}>{children}</div>;
}

const rowLi: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 0",
  borderTop: `1px solid ${C.borderSubtle}`,
};
