import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { api, DesktopSettings, MountState } from "./api";
import { useConvexClient, useConvexQuery } from "./useConvex";
import { SettingsView } from "./SettingsView";
import { Onboarding } from "./Onboarding";
import { Sidebar, View } from "./Sidebar";
import { FileBrowser } from "./FileBrowser";
import { CommandPalette } from "./CommandPalette";
import { C, mono, Wordmark, Eyebrow } from "./ui";
import { CONVEX_URL, WEB_ORIGIN } from "./config";

export function App() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [view, setView] = useState<View>({ kind: "home" });
  const [mount, setMount] = useState<MountState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const { isLoaded: clerkLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    void api.settings.get().then(setSettings);
  }, []);

  // Live mount status for the sidebar drive chip.
  useEffect(() => {
    void api.mount.status().then(setMount);
    return api.mount.onStatus(setMount);
  }, []);

  // Global ⌘K / Ctrl-K opens the command palette.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Convex auth flows from the desktop's own Clerk session.
  const tokenGetter = useMemo(
    () => (isSignedIn ? () => getToken({ template: "convex" }) : null),
    [isSignedIn, getToken],
  );
  const client = useConvexClient(tokenGetter, settings?.convexAuthToken || undefined);

  // Bridge the live token to the main process once, so background loops keep
  // working (best-effort; tolerant of a stale token).
  useEffect(() => {
    if (!isSignedIn || !settings) return;
    let done = false;
    void (async () => {
      const t = await getToken({ template: "convex" }).catch(() => null);
      if (done || !t) return;
      if (settings.convexAuthToken === t && settings.convexUrl === CONVEX_URL) return;
      const next = { ...settings, convexUrl: CONVEX_URL, convexAuthToken: t };
      const saved = await api.settings.set(next);
      setSettings(saved);
    })();
    return () => {
      done = true;
    };
  }, [isSignedIn, settings, getToken]);

  const persist = useCallback(async (next: DesktopSettings) => {
    const saved = await api.settings.set(next);
    setSettings(saved);
  }, []);

  const enableDrive = useCallback(() => {
    if (!settings) return;
    void api.mount.start({ mountPath: settings.rootDir }).catch(() => {
      // Surfaced via the mount status chip / Settings → Drive.
    });
  }, [settings]);

  const storageReady = Boolean(settings?.storage.bucket && settings?.storage.accessKeyId);

  // Auto-mount once on first configure. On later launches the main process
  // handles this (autoMount defaults on); the startMount guard makes a double
  // trigger a harmless no-op, so this only matters for the post-pairing session.
  const autoMountTried = useRef(false);
  useEffect(() => {
    if (autoMountTried.current) return;
    if (!storageReady || !settings) return;
    if (mount && mount.status !== "unmounted") return;
    autoMountTried.current = true;
    enableDrive();
  }, [storageReady, settings, mount, enableDrive]);

  const hasManualToken = Boolean(settings?.convexAuthToken);
  const isConfigured = Boolean((isSignedIn || hasManualToken) && storageReady);

  if (!settings || !clerkLoaded) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Wordmark size={22} />
        <span
          style={{
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: C.muted,
          }}
        >
          Loading…
        </span>
      </div>
    );
  }

  if (!isConfigured) {
    return (
      <Onboarding
        settings={settings}
        onChange={persist}
        isSignedIn={Boolean(isSignedIn)}
        onDone={() => setView({ kind: "home" })}
      />
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex" }}>
      <Sidebar
        client={client}
        view={view}
        onNavigate={setView}
        mount={mount}
        onEnableDrive={enableDrive}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <CommandPalette
        client={client}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={setView}
      />
      <main style={{ flex: 1, height: "100vh", overflow: "auto" }}>
        {view.kind === "settings" ? (
          <SettingsView client={client} settings={settings} onChange={persist} mount={mount} />
        ) : view.kind === "billing" ? (
          <BillingView />
        ) : view.kind === "project" ? (
          <FileBrowser client={client} projectId={view.projectId} />
        ) : (
          <HomeOverview client={client} onOpen={(projectId) => setView({ kind: "project", projectId })} />
        )}
      </main>
    </div>
  );
}

interface HomeTeam {
  _id: string;
  name: string;
  slug: string;
  projects: Array<{ _id: string; name: string; description?: string; videoCount: number }>;
}

function HomeOverview({
  client,
  onOpen,
}: {
  client: ReturnType<typeof useConvexClient>;
  onOpen: (projectId: string) => void;
}) {
  const teams = useConvexQuery<HomeTeam[]>(client, "teams:listWithProjects", {});
  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <Eyebrow>Workspace</Eyebrow>
      <h1 style={{ fontSize: 30, marginTop: 6, marginBottom: 18 }}>
        Projects<span style={{ color: C.accent }}>.</span>
      </h1>
      {teams === undefined ? (
        <div style={{ color: C.muted }}>Loading…</div>
      ) : teams.length === 0 ? (
        <div style={{ color: C.muted }}>
          No workspaces yet. Create one in the web app, then it'll appear here.
        </div>
      ) : (
        teams.map((team) => (
          <section key={team._id} style={{ marginBottom: 22 }}>
            <div
              style={{
                fontFamily: mono,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: C.muted,
                marginBottom: 8,
              }}
            >
              {team.name}
            </div>
            {team.projects.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13 }}>No projects in this workspace yet.</div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                {team.projects.map((p) => (
                  <button
                    key={p._id}
                    onClick={() => onOpen(p._id)}
                    style={{
                      textAlign: "left",
                      border: `2px solid ${C.border}`,
                      background: C.bg,
                      padding: 14,
                      cursor: "pointer",
                      boxShadow: `4px 4px 0 0 ${C.border}`,
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 16 }}>{p.name}</div>
                    {p.description ? (
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                        {p.description}
                      </div>
                    ) : null}
                    <div style={{ fontSize: 11, color: C.muted, fontFamily: mono, marginTop: 8 }}>
                      {p.videoCount} item{p.videoCount === 1 ? "" : "s"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

function BillingView() {
  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <Eyebrow>Account</Eyebrow>
      <h1 style={{ fontSize: 30, marginTop: 6, marginBottom: 12 }}>
        Billing &amp; usage<span style={{ color: C.accent }}>.</span>
      </h1>
      <p style={{ color: "#555", fontSize: 14, lineHeight: 1.55, maxWidth: "52ch" }}>
        Plans, invoices, and usage are managed in the web app. Open it to review
        or change your plan.
      </p>
      <div style={{ marginTop: 18 }}>
        <button
          className="primary"
          onClick={() => void api.shell.openExternal(`${WEB_ORIGIN.replace(/\/$/, "")}/dashboard/billing`)}
        >
          Manage billing on the web
        </button>
      </div>
    </div>
  );
}
