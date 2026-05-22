/**
 * Persistent left sidebar — the desktop analogue of the web app's
 * DashboardSidebar. Workspace switcher, projects list, account links, and
 * (in place of the web "Download DMG" button) a live drive-status chip.
 */

import { useMemo, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import type { ConvexClient } from "convex/browser";
import { useConvexQuery, callMutation } from "./useConvex";
import { api, MountState } from "./api";
import { C, mono, Wordmark } from "./ui";

export interface SidebarProject {
  _id: string;
  name: string;
  description?: string;
  videoCount: number;
}
export interface SidebarTeam {
  _id: string;
  name: string;
  slug: string;
  role: string;
  projects: SidebarProject[];
}

export type View =
  | { kind: "home" }
  | { kind: "project"; projectId: string }
  | { kind: "settings" }
  | { kind: "billing" };

interface Props {
  client: ConvexClient | null;
  view: View;
  onNavigate: (v: View) => void;
  mount: MountState | null;
  onEnableDrive: () => void;
}

export function Sidebar({ client, view, onNavigate, mount, onEnableDrive }: Props) {
  const teams = useConvexQuery<SidebarTeam[]>(client, "teams:listWithProjects", {});
  const { user } = useUser();

  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const activeTeam = useMemo(() => {
    if (!teams || teams.length === 0) return null;
    return teams.find((t) => t._id === activeTeamId) ?? teams[0];
  }, [teams, activeTeamId]);

  const projects = activeTeam?.projects ?? [];
  const activeProjectId = view.kind === "project" ? view.projectId : null;

  const handleCreateProject = async (name: string) => {
    if (!client || !activeTeam) return;
    const projectId = await callMutation<string>(client, "projects:create", {
      teamId: activeTeam._id,
      name,
    });
    setCreating(false);
    onNavigate({ kind: "project", projectId });
  };

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: `2px solid ${C.border}`,
        background: C.bg,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
      }}
    >
      {/* Header: wordmark + workspace switcher. Draggable region. */}
      <div
        style={{
          padding: "30px 12px 12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      >
        <button
          onClick={() => onNavigate({ kind: "home" })}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            flex: 1,
            textAlign: "left",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties}
          title="Home"
        >
          <Wordmark size={20} />
        </button>
        <div style={{ position: "relative", WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            onClick={() => setSwitcherOpen((o) => !o)}
            title="Switch workspace"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: `2px solid ${C.border}`,
              background: C.bg,
              padding: "3px 6px",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                background: C.accent,
                color: C.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 900,
                fontSize: 9,
              }}
            >
              {(activeTeam?.name ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <span style={{ fontSize: 10, color: C.muted }}>▾</span>
          </button>
          {switcherOpen ? (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 30 }}
                onClick={() => setSwitcherOpen(false)}
              />
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "100%",
                  marginTop: 4,
                  zIndex: 40,
                  minWidth: 200,
                  border: `2px solid ${C.border}`,
                  background: C.bg,
                  boxShadow: `4px 4px 0 0 ${C.border}`,
                }}
              >
                <div
                  style={{
                    padding: "4px 8px",
                    fontFamily: mono,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: C.muted,
                    borderBottom: `1px solid ${C.borderSubtle}`,
                  }}
                >
                  Workspaces
                </div>
                {(teams ?? []).map((t) => (
                  <button
                    key={t._id}
                    onClick={() => {
                      setActiveTeamId(t._id);
                      setSwitcherOpen(false);
                      onNavigate({ kind: "home" });
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      fontSize: 13,
                      fontWeight: 700,
                      textAlign: "left",
                      background: t._id === activeTeam?._id ? C.fg : "transparent",
                      color: t._id === activeTeam?._id ? C.bg : C.fg,
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        background: C.accent,
                        color: C.bg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 900,
                        fontSize: 10,
                        flexShrink: 0,
                      }}
                    >
                      {t.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.name}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Projects list */}
      <nav style={{ padding: "0 8px", flex: 1, overflowY: "auto", minHeight: 0 }}>
        <SectionLabel>Projects</SectionLabel>
        {teams === undefined ? (
          <Muted>Loading…</Muted>
        ) : projects.length === 0 ? (
          <Muted>No projects yet</Muted>
        ) : (
          projects.map((p) => (
            <NavRow
              key={p._id}
              active={activeProjectId === p._id}
              onClick={() => onNavigate({ kind: "project", projectId: p._id })}
            >
              {p.name}
            </NavRow>
          ))
        )}
      </nav>

      {/* New project */}
      <div style={{ padding: "8px 12px" }}>
        {creating ? (
          <NameForm
            placeholder="Project name"
            onCancel={() => setCreating(false)}
            onSubmit={(name) => void handleCreateProject(name)}
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            disabled={!activeTeam}
            style={{
              width: "100%",
              padding: "8px",
              border: `2px dashed ${C.border}`,
              background: "transparent",
              fontFamily: mono,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: activeTeam ? "pointer" : "not-allowed",
              opacity: activeTeam ? 1 : 0.5,
            }}
          >
            + New project
          </button>
        )}
      </div>

      {/* Drive status — in place of the web "Download DMG" button. */}
      <DriveChip mount={mount} onEnableDrive={onEnableDrive} />

      {/* Account links */}
      <div style={{ padding: "8px 8px", borderTop: `2px solid ${C.border}` }}>
        <NavRow active={view.kind === "billing"} onClick={() => onNavigate({ kind: "billing" })}>
          Billing &amp; usage
        </NavRow>
        <NavRow active={view.kind === "settings"} onClick={() => onNavigate({ kind: "settings" })}>
          Settings
        </NavRow>
      </div>

      {/* Footer: account */}
      <div
        style={{
          borderTop: `2px solid ${C.border}`,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            border: `2px solid ${C.border}`,
            background: C.fg,
            color: C.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 900,
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {(user?.firstName ?? user?.username ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user?.fullName ?? user?.firstName ?? user?.username ?? "Account"}
          </div>
        </div>
      </div>
    </aside>
  );
}

function DriveChip({
  mount,
  onEnableDrive,
}: {
  mount: MountState | null;
  onEnableDrive: () => void;
}) {
  const status = mount?.status ?? "unmounted";
  const color =
    status === "mounted"
      ? C.ok
      : status === "mounting"
        ? "#b45309"
        : status === "error"
          ? C.danger
          : C.muted;
  const label =
    status === "mounted"
      ? "Drive connected"
      : status === "mounting"
        ? "Connecting drive…"
        : status === "error"
          ? "Drive error"
          : "Drive off";
  return (
    <div style={{ padding: "8px 12px", borderTop: `2px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 12, height: 12, background: color, border: `2px solid ${C.border}`, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700 }}>{label}</span>
        {status === "mounted" && mount?.mountPath ? (
          <button
            onClick={() => void api.shell.openFolder(mount.mountPath as string)}
            style={{ fontSize: 10, padding: "2px 6px", border: `2px solid ${C.border}`, background: C.bg, cursor: "pointer" }}
            title="Open the drive in Finder"
          >
            Open
          </button>
        ) : status !== "mounting" ? (
          <button
            onClick={onEnableDrive}
            style={{ fontSize: 10, padding: "2px 6px", border: `2px solid ${C.border}`, background: C.accent, color: C.bg, cursor: "pointer" }}
            title="Mount your cloud bucket as a local drive"
          >
            Enable
          </button>
        ) : null}
      </div>
    </div>
  );
}

function NameForm({
  placeholder,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = name.trim();
        if (v) onSubmit(v);
      }}
      style={{ display: "flex", gap: 4 }}
    >
      <input
        autoFocus
        value={name}
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        style={{ flex: 1, minWidth: 0, fontSize: 12 }}
      />
      <button type="submit" style={{ fontSize: 11, padding: "2px 6px" }}>
        Add
      </button>
    </form>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "6px 8px 4px",
        fontFamily: mono,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: C.muted,
      }}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "4px 8px", fontSize: 12, color: C.muted }}>{children}</div>;
}

function NavRow({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 8px",
        fontSize: 13,
        fontWeight: 700,
        textAlign: "left",
        border: `2px solid ${active ? C.border : "transparent"}`,
        background: active ? C.fg : "transparent",
        color: active ? C.bg : C.fg,
        cursor: "pointer",
      }}
    >
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {children}
      </span>
    </button>
  );
}
