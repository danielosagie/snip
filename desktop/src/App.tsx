import { useEffect, useState } from "react";
import { api, DesktopSettings, SyncProgress } from "./api";
import { useConvexClient, useConvexQuery, callMutation } from "./useConvex";
import { SettingsView } from "./SettingsView";
import { ProjectsView } from "./ProjectsView";
import { ProjectDetail } from "./ProjectDetail";
import { MountView } from "./MountView";
import { Onboarding } from "./Onboarding";
import { C, mono, Wordmark } from "./ui";

type Tab = "projects" | "mount" | "settings";

export function App() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [tab, setTab] = useState<Tab>("projects");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    void api.settings.get().then(setSettings);
  }, []);

  const client = useConvexClient(
    settings?.convexUrl ?? "",
    settings?.convexAuthToken ?? "",
  );

  const isConfigured = Boolean(
    settings?.convexUrl &&
      settings?.convexAuthToken &&
      settings?.storage.bucket &&
      settings?.storage.accessKeyId,
  );

  const persist = async (next: DesktopSettings) => {
    const saved = await api.settings.set(next);
    setSettings(saved);
  };

  if (!settings) {
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

  // First run → the full-screen guided flow, not a settings dump.
  if (!isConfigured) {
    return (
      <Onboarding
        settings={settings}
        onChange={persist}
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
