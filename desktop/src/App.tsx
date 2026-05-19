import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { api, DesktopSettings, SyncProgress } from "./api";
import { useConvexClient, useConvexQuery, callMutation } from "./useConvex";
import { SettingsView } from "./SettingsView";
import { ProjectsView } from "./ProjectsView";
import { ProjectDetail } from "./ProjectDetail";
import { MountView } from "./MountView";
import { Onboarding } from "./Onboarding";
import { C, mono, Wordmark } from "./ui";
import { CONVEX_URL } from "./config";

type Tab = "projects" | "mount" | "settings";

export function App() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [tab, setTab] = useState<Tab>("projects");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const { isLoaded: clerkLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    void api.settings.get().then(setSettings);
  }, []);

  // Convex auth flows from the desktop's own Clerk session.
  const tokenGetter = useMemo(
    () => (isSignedIn ? () => getToken({ template: "convex" }) : null),
    [isSignedIn, getToken],
  );
  const client = useConvexClient(
    tokenGetter,
    settings?.convexAuthToken || undefined,
  );

  // Bridge the live token to the main process once, so background loops
  // (presence/prefetch) keep working. They're best-effort and tolerate a
  // stale token; full background re-auth is a tracked follow-up.
  useEffect(() => {
    if (!isSignedIn || !settings) return;
    let done = false;
    void (async () => {
      const t = await getToken({ template: "convex" }).catch(() => null);
      if (done || !t) return;
      if (settings.convexAuthToken === t && settings.convexUrl === CONVEX_URL)
        return;
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

  // Storage creds arrive from pairing. Configured = an auth path
  // (Clerk session, or a manually pasted token via Advanced) + storage.
  const storageReady = Boolean(
    settings?.storage.bucket && settings?.storage.accessKeyId,
  );
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
        onDone={() => setTab("mount")}
      />
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          padding: "12px 20px",
          borderBottom: `2px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          gap: 16,
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      >
        <div style={{ paddingLeft: 56 }}>
          <Wordmark size={17} sub="desktop" />
        </div>
        <div style={{ flex: 1 }} />
        <nav
          style={{
            display: "flex",
            gap: 8,
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties}
        >
          <TabButton active={tab === "projects"} onClick={() => setTab("projects")}>
            Projects
          </TabButton>
          <TabButton active={tab === "mount"} onClick={() => setTab("mount")}>
            Mount
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
            Settings
          </TabButton>
        </nav>
      </header>

      <main style={{ flex: 1, overflow: "auto", padding: 24 }}>
        {tab === "settings" ? (
          <SettingsView settings={settings} onChange={persist} />
        ) : tab === "mount" ? (
          <MountView settings={settings} client={client} />
        ) : selectedProjectId ? (
          <ProjectDetail
            client={client}
            projectId={selectedProjectId}
            rootDir={settings.rootDir}
            onBack={() => setSelectedProjectId(null)}
          />
        ) : (
          <ProjectsView
            client={client}
            onOpen={(projectId) => setSelectedProjectId(projectId)}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? C.fg : "transparent",
        color: active ? C.bg : C.fg,
        boxShadow: active ? `4px 4px 0 0 ${C.accent}` : undefined,
        padding: "6px 14px",
        fontSize: 12,
        fontFamily: mono,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
  );
}

// Re-export so the renderer modules can use the same types.
export type { DesktopSettings, SyncProgress };
export { useConvexQuery, callMutation };
