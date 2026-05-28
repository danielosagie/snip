"use client";

import { Link, useLocation, useParams } from "@tanstack/react-router";
import { UserButton, useUser } from "@clerk/tanstack-react-start";
import { useQuery, useAction } from "convex/react";
import {
  ChevronsUpDown,
  CreditCard,
  HardDrive,
  Moon,
  Plus,
  Settings,
  Sun,
  Trash2,
  Users,
  Briefcase,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { useTheme } from "@/components/theme/ThemeToggle";
import { useState, useEffect, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  CommandSearch,
  CommandSearchTrigger,
} from "@/components/CommandSearch";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { CreateTeamDialog } from "@/components/teams/CreateTeamDialog";
import { SnipMark } from "@/components/SnipMark";
import { StorageUsageBar } from "@/components/StorageUsageBar";
import { useSidebarState } from "@/lib/sidebarContext";
import {
  projectPath,
  teamHomePath,
  teamSettingsPath,
} from "@/lib/routes";

export const SETTINGS_PATH = "/dashboard/settings";
export const BILLING_PATH = "/dashboard/billing";
export const TRASH_PATH = "/dashboard/trash";

/**
 * Persistent left sidebar. Layout:
 *
 *   [snip. mark]
 *   [search trigger — opens command palette]
 *   ── PROJECTS ──
 *     project rows
 *     [+ New project]
 *   ── ACCOUNT ──
 *     [Billing & usage]
 *     [Team members]
 *     [Settings]
 *   ── footer: avatar + name + theme toggle
 *
 * "Workspace" / dashboard pseudo-link is intentionally absent — the
 * snip. mark at the top already routes home, and "Home" is a place
 * not a workspace.
 */

export function DashboardSidebar() {
  const { collapsed } = useSidebarState();
  const pathname = useLocation().pathname;
  const params = useParams({ strict: false });
  const activeTeamSlug =
    typeof params.teamSlug === "string" ? params.teamSlug : undefined;
  const activeProjectId =
    typeof params.projectId === "string" ? params.projectId : undefined;
  const teams = useQuery(api.teams.listWithProjects, {});
  const { user } = useUser();

  const [searchOpen, setSearchOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);

  // Flatten all projects from every team into a single list. Teams
  // stay in the data model (for billing/membership) but the sidebar
  // surfaces projects directly — fewer hops, fewer concepts.
  const projects =
    teams?.flatMap((t) =>
      (t.projects ?? []).map((p) => ({
        ...p,
        teamSlug: t.slug,
        teamName: t.name,
      })),
    ) ?? [];

  // Pick a default team for the "+ New project" button. Owners of a
  // team get to create projects there; if you only have member rows,
  // we still surface it but the dialog will guide team selection.
  const defaultTeam = teams?.find((t) => t.slug === activeTeamSlug) ?? teams?.[0];

  if (collapsed) {
    return (
      <>
        <aside className="hidden md:flex flex-col w-12 flex-shrink-0 border-r-2 border-[#1a1a1a] bg-[#f0f0e8] items-center py-3 gap-2">
          <Link
            to="/dashboard"
            className="font-black text-lg tracking-tighter text-[#1a1a1a] hover:text-[#FF6600]"
            title="Home"
          >
            l<span className="text-[#FF6600]">.</span>
          </Link>
          <CollapsedRail
            pathname={pathname}
            activeTeamSlug={defaultTeam?.slug}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </aside>
        <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
      </>
    );
  }

  return (
    <>
      <aside className="hidden md:flex flex-col w-60 flex-shrink-0 border-r-2 border-[#1a1a1a] bg-[#f0f0e8] min-h-0">
        {/* Header row: snip. brand on the left, workspace switcher
            chip on the right. The switcher trigger is just a chevron
            chip (no inline name, since the projects list below
            already gives plenty of workspace context). */}
        <div className="px-3 pt-4 pb-3 flex items-center gap-2">
          <Link to="/dashboard" className="flex-1 min-w-0 flex items-center gap-2">
            <SnipMark size={22} />
            <span className="font-black text-xl tracking-tighter text-[#1a1a1a]">
              snip<span className="text-[#FF6600]">.</span>
            </span>
          </Link>
          <div className="relative">
            <button
              type="button"
              onClick={() => setWorkspaceMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-2 py-1 border-2 border-[#1a1a1a] bg-[#f0f0e8] text-xs font-bold hover:bg-[#e8e8e0] transition-colors"
              title="Switch workspace"
            >
              <span className="w-4 h-4 flex-shrink-0 bg-[#FF6600] text-[#f0f0e8] flex items-center justify-center font-black text-[9px]">
                {(defaultTeam?.name ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <ChevronsUpDown className="h-3 w-3 text-[#888]" />
            </button>
            {workspaceMenuOpen ? (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setWorkspaceMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-40 min-w-[220px] border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[4px_4px_0px_0px_var(--shadow-color)]">
                  <div className="px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] border-b border-[#ccc]">
                    Workspaces
                  </div>
                  {(teams ?? []).map((t) => (
                    <Link
                      key={t._id}
                      to={teamHomePath(t.slug)}
                      onClick={() => setWorkspaceMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 text-sm font-bold",
                        t.slug === activeTeamSlug
                          ? "bg-[#1a1a1a] text-[#f0f0e8]"
                          : "text-[#1a1a1a] hover:bg-[#e8e8e0]",
                      )}
                    >
                      <span className="w-5 h-5 flex-shrink-0 bg-[#FF6600] text-[#f0f0e8] flex items-center justify-center font-black text-[10px]">
                        {t.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="flex-1 truncate">{t.name}</span>
                    </Link>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      setCreateTeamOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-bold text-[#FF6600] hover:bg-[#e8e8e0] border-t border-[#ccc]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create workspace
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="px-3 pb-3">
          <CommandSearchTrigger onOpen={() => setSearchOpen(true)} />
        </div>

        <nav className="px-2 flex-1 overflow-y-auto min-h-0">
          <SidebarLabel>Projects</SidebarLabel>
          {projects.length === 0 ? (
            <div className="px-2 py-2 text-xs text-[#888]">
              No projects yet
            </div>
          ) : (
            projects.map((p) => (
              <SidebarLink
                key={p._id}
                to={projectPath(p.teamSlug, p._id)}
                icon={<Briefcase className="h-4 w-4" />}
                active={activeProjectId === p._id}
              >
                {p.name}
              </SidebarLink>
            ))
          )}
          {/* "Recently deleted" lives at the bottom of the Projects
              list, not in the Account section — it's a project-scoped
              affordance, not an account-level one. */}
          <SidebarLink
            to={TRASH_PATH}
            icon={<Trash2 className="h-4 w-4" />}
            active={pathname.startsWith(TRASH_PATH)}
          >
            Recently deleted
          </SidebarLink>
        </nav>

        {/* Desktop app download — separated section above the New project
            button. Sits in its own div so it reads as "tooling you can
            install" rather than another nav item or a peer of project
            creation. `/downloads/snip-desktop.pkg` 302-redirects (via
            vercel.json) to the latest GitHub Release asset. The .pkg is the
            recommended installer — a guided wizard that also sets up macFUSE
            so the cloud drive works out of the box. */}
        <div className="px-3 pt-3 pb-1 border-t-2 border-[#1a1a1a]">
          <DesktopAppOrDrive />
        </div>

        {/* "+ New project" sits directly above the account section,
            below the project list but visually separated. This makes
            the primary creation action easy to spot without burying
            it next to the avatar. */}
        <div className="px-3 pt-2 pb-3">
          <button
            type="button"
            onClick={() => setCreateProjectOpen(true)}
            disabled={!defaultTeam}
            title={
              defaultTeam ? "Create a project" : "Create a workspace first"
            }
            className="w-full flex items-center justify-center gap-2 px-2 py-2 border-2 border-dashed border-[#1a1a1a] text-xs font-bold uppercase tracking-wider text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New project
          </button>
        </div>

        {/* Account links — no section heading, just the three rows
            pinned above the footer. The storage bar sits directly above
            the Billing link so the usage state is visible without a
            click. */}
        <div className="pt-2 border-t-2 border-[#1a1a1a]">
          <StorageUsageBar variant="compact" />
        </div>
        <div className="px-2 pb-2">
          <SidebarLink
            to={BILLING_PATH}
            icon={<CreditCard className="h-4 w-4" />}
            active={pathname.startsWith(BILLING_PATH)}
          >
            Billing &amp; usage
          </SidebarLink>
          {defaultTeam ? (
            <SidebarLink
              to={teamSettingsPath(defaultTeam.slug)}
              icon={<Users className="h-4 w-4" />}
              active={pathname.startsWith(
                `/dashboard/${defaultTeam.slug}/settings`,
              )}
            >
              Team members
            </SidebarLink>
          ) : null}
          <SidebarLink
            to={SETTINGS_PATH}
            icon={<Settings className="h-4 w-4" />}
            active={pathname.startsWith(SETTINGS_PATH)}
          >
            Settings
          </SidebarLink>
        </div>

        <SidebarFooter
          name={user?.fullName ?? user?.firstName ?? user?.username ?? ""}
        />
      </aside>

      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
      {defaultTeam ? (
        <CreateProjectDialog
          open={createProjectOpen}
          onOpenChange={setCreateProjectOpen}
          teamId={defaultTeam._id}
          teamSlug={defaultTeam.slug}
        />
      ) : null}
      <CreateTeamDialog
        open={createTeamOpen}
        onOpenChange={setCreateTeamOpen}
      />
    </>
  );
}

function CollapsedRail({
  pathname,
  activeTeamSlug,
  onOpenSearch,
}: {
  pathname: string;
  activeTeamSlug: string | undefined;
  onOpenSearch: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1 mt-2">
      <button
        type="button"
        onClick={onOpenSearch}
        className="p-1.5 text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0]"
        title="Search (⌘K)"
      >
        <Briefcase className="h-4 w-4" />
      </button>
      <Link
        to={BILLING_PATH}
        title="Billing & usage"
        className={cn(
          "p-1.5",
          pathname.startsWith(BILLING_PATH)
            ? "bg-[#1a1a1a] text-[#f0f0e8]"
            : "text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0]",
        )}
      >
        <CreditCard className="h-4 w-4" />
      </Link>
      {activeTeamSlug ? (
        <Link
          to={teamSettingsPath(activeTeamSlug)}
          title="Team members"
          className={cn(
            "p-1.5",
            pathname.includes("/settings")
              ? "bg-[#1a1a1a] text-[#f0f0e8]"
              : "text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0]",
          )}
        >
          <Users className="h-4 w-4" />
        </Link>
      ) : null}
      <Link
        to={SETTINGS_PATH}
        title="Settings"
        className={cn(
          "p-1.5",
          pathname.startsWith(SETTINGS_PATH)
            ? "bg-[#1a1a1a] text-[#f0f0e8]"
            : "text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0]",
        )}
      >
        <Settings className="h-4 w-4" />
      </Link>
    </div>
  );
}

function SidebarLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
      {children}
    </div>
  );
}

function SidebarLink({
  to,
  icon,
  active,
  children,
}: {
  to: string;
  icon?: ReactNode;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      preload="intent"
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 text-sm font-bold border-2 transition-colors",
        active
          ? "bg-[#1a1a1a] text-[#f0f0e8] border-[#1a1a1a]"
          : "text-[#1a1a1a] border-transparent hover:bg-[#e8e8e0]",
      )}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="truncate flex-1">{children}</span>
    </Link>
  );
}

function SidebarFooter({ name }: { name: string }) {
  const { theme, toggleTheme, mounted } = useTheme();
  return (
    <div className="border-t-2 border-[#1a1a1a] px-3 py-2 flex items-center gap-2">
      <UserButton
        appearance={{
          variables: {
            // Use theme tokens so the popover follows light/dark.
            colorText: "var(--foreground)",
            colorTextSecondary: "var(--foreground-muted)",
            colorBackground: "var(--background)",
            colorNeutral: "var(--border)",
          },
          elements: {
            avatarBox: "w-7 h-7 rounded-none border-2 border-[var(--border)]",
            userButtonPopoverCard:
              "bg-[var(--background)] border-2 border-[var(--border)] rounded-none shadow-[8px_8px_0px_0px_var(--shadow-color)]",
            userButtonPopoverActionButton:
              "!text-[var(--foreground)] hover:!bg-[var(--surface-alt)] rounded-none",
            userButtonPopoverActionButtonText:
              "!text-[var(--foreground)] hover:!text-[var(--foreground)] font-mono font-bold",
            userButtonPopoverActionButtonIcon:
              "!text-[var(--foreground)] hover:!text-[var(--foreground)]",
            userButtonPopoverFooter: "hidden",
          },
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="font-bold text-xs text-[var(--foreground)] truncate">
          {name || "Account"}
        </div>
      </div>
      <button
        onClick={toggleTheme}
        className="p-1 text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0] transition-colors"
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        aria-label="Toggle theme"
      >
        {!mounted ? (
          <span className="block h-4 w-4" />
        ) : theme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

/**
 * In a browser: a "Download the desktop app" button. Inside the desktop shell
 * (window.snipDesktop): the cloud-drive control — Enable mounts the bucket via
 * the native bridge (fetching storage creds from Convex), then shows Connected
 * with an Open-in-Finder action.
 */
const DESKTOP_BTN =
  "w-full flex items-center justify-center gap-2 px-2 py-2 border-2 border-[#1a1a1a] text-xs font-bold uppercase tracking-wider text-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#FF6600] hover:text-[#f0f0e8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Translates server-thrown errors into a one-line UI string. Typed
 * `ConvexError({ code, message })` payloads surface here as
 * `err.data` — we switch on the code to pick a friendly prompt
 * instead of dumping the raw `[CONVEX A(...)] Server Error ...`
 * string into the sidebar.
 */
function friendlyDriveError(e: unknown): string {
  const data =
    typeof e === "object" && e !== null && "data" in e
      ? ((e as { data: unknown }).data as
          | { code?: string; message?: string }
          | undefined)
      : undefined;
  if (data?.code === "no_workspace") {
    return "Create a workspace to enable the drive.";
  }
  if (data?.code === "drive_requires_upgrade") {
    return "Upgrade to Basic to enable the local drive.";
  }
  return e instanceof Error ? e.message : "Couldn't enable the drive.";
}

function DesktopAppOrDrive() {
  const getStorageBootstrap = useAction(api.desktopAuth.getStorageBootstrap);
  const [isDesktop, setIsDesktop] = useState(false);
  const [mount, setMount] = useState<{
    status: string;
    mountPath: string | null;
    lastError: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Epoch ms when the current storage credential expires (scoped creds
  // only; null for the legacy shared key). Drives the refresh timer.
  const [credExpiresAt, setCredExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.snipDesktop?.isDesktop || !window.api) return;
    setIsDesktop(true);
    void window.api.mount.status().then(setMount).catch(() => {});
    return window.api.mount.onStatus(setMount);
  }, []);

  // Scoped credentials are short-lived. Re-vend shortly before expiry and
  // remount so the long-lived FUSE mount keeps a valid token. Inert when
  // creds don't expire (shared-key deployments leave credExpiresAt null).
  const mountStatus = mount?.status ?? null;
  useEffect(() => {
    if (!credExpiresAt) return;
    if (typeof window === "undefined" || !window.api) return;
    const leadMs = 5 * 60_000;
    const delay = Math.max(0, credExpiresAt - Date.now() - leadMs);
    const timer = setTimeout(async () => {
      try {
        const boot = await getStorageBootstrap({});
        if (!boot || !window.api) return;
        const cur = await window.api.settings.get();
        await window.api.settings.set({
          ...cur,
          storage: { ...cur.storage, ...boot },
        });
        if (mountStatus === "mounted") await window.api.mount.start({});
        setCredExpiresAt(boot.expiresAt ?? null);
      } catch {
        // Keep existing creds; the next user action can re-enable.
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [credExpiresAt, mountStatus, getStorageBootstrap]);

  const enable = useCallback(async () => {
    if (!window.api) {
      setError("Desktop bridge unavailable — restart the app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const boot = await getStorageBootstrap({});
      if (!boot) {
        setError("Storage isn't configured on the server (no bucket creds).");
        return;
      }
      const cur = await window.api.settings.get();
      await window.api.settings.set({ ...cur, storage: { ...cur.storage, ...boot } });
      setCredExpiresAt(boot.expiresAt ?? null);
      await window.api.mount.start({});
    } catch (e) {
      setError(friendlyDriveError(e));
    } finally {
      setBusy(false);
    }
  }, [getStorageBootstrap]);

  // Tearing the drive back down. mount.stop also flips the persisted
  // autoMount flag off in the main process, so the drive stays disconnected
  // on the next launch until the user explicitly re-enables it.
  const disconnect = useCallback(async () => {
    if (!window.api) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.mount.stop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't disconnect the drive.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (!isDesktop) {
    return (
      <a
        href="/downloads/snip-desktop.pkg"
        className={DESKTOP_BTN}
        title="Download snip Desktop for macOS — guided installer that sets up the cloud drive"
      >
        <HardDrive className="h-3.5 w-3.5" />
        Desktop app · Installer
      </a>
    );
  }

  const status = mount?.status ?? "unmounted";
  const shownError = error ?? (status === "error" ? mount?.lastError : null);
  return (
    <div className="flex flex-col gap-1.5">
      {status === "mounted" ? (
        <>
          <button
            type="button"
            onClick={() => void window.api?.shell.openFolder(mount?.mountPath ?? "")}
            className={DESKTOP_BTN}
            title="Open the cloud drive in Finder"
          >
            <HardDrive className="h-3.5 w-3.5" />
            Drive connected · Open
          </button>
          {/* The "remove" half of the toggle — the connected state used to
              be a dead end with no way to turn the drive off. */}
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="text-[10px] text-[#888] hover:text-[#b91c1c] underline self-center disabled:opacity-50"
            title="Unmount the cloud drive"
          >
            {busy ? "Disconnecting…" : "Disconnect drive"}
          </button>
        </>
      ) : status === "unmounting" ? (
        <button type="button" disabled className={DESKTOP_BTN}>
          <HardDrive className="h-3.5 w-3.5" />
          Disconnecting…
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void enable()}
          disabled={busy || status === "mounting"}
          className={DESKTOP_BTN}
          title="Mount your cloud bucket as a local drive"
        >
          <HardDrive className="h-3.5 w-3.5" />
          {busy || status === "mounting"
            ? "Connecting drive…"
            : status === "error"
              ? "Retry drive"
              : "Enable drive"}
        </button>
      )}
      {shownError ? (
        <p className="text-[10px] leading-snug text-[#b91c1c]">{shownError}</p>
      ) : null}
    </div>
  );
}
