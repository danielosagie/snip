"use client";

import { Link, useLocation, useParams, useSearch } from "@tanstack/react-router";
import { UserButton, useUser, useAuth } from "@clerk/tanstack-react-start";
import { useQuery, useAction, useConvex } from "convex/react";
import {
  ChevronsUpDown,
  CreditCard,
  HardDrive,
  Plus,
  ReceiptText,
  Settings,
  Trash2,
  Users,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Folder,
  Unplug,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ThemeStyleToggle } from "@/components/theme/ThemeToggle";
import { useState, useEffect, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  detectPlatform,
  downloadFor,
  NEUTRAL_DOWNLOAD,
  type DesktopDownload,
} from "@/lib/platform";
import {
  CommandSearch,
  CommandSearchTrigger,
} from "@/components/CommandSearch";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { CreateTeamDialog } from "@/components/teams/CreateTeamDialog";
import { SnipMark } from "@/components/SnipMark";
import { StorageUsageBar } from "@/components/StorageUsageBar";
import { softButton, softButtonPrimary } from "@/components/soft";
import { useSidebarState } from "@/lib/sidebarContext";
import {
  projectPath,
  teamHomePath,
  teamInvoicesPath,
  teamSettingsPath,
} from "@/lib/routes";
import { prewarmInvoiceList } from "../../app/routes/dashboard/-invoices.data";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";

export const SETTINGS_PATH = "/dashboard/settings";
export const BILLING_PATH = "/dashboard/billing";
export const TRASH_PATH = "/dashboard/trash";

type IntentHandlers = {
  onMouseEnter: () => void;
  onFocus: () => void;
  onTouchStart: () => void;
  onMouseLeave: () => void;
  onBlur: () => void;
};

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
 *     [Invoices]
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
  const search = useSearch({ strict: false }) as { folder?: unknown };
  const activeFolderId =
    typeof search.folder === "string" ? search.folder : undefined;
  const teams = useQuery(api.teams.listWithProjects, {});
  const convex = useConvex();
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
  const prewarmInvoicesIntentHandlers = useRoutePrewarmIntent(() => {
    if (!defaultTeam) return;
    return prewarmInvoiceList(convex, defaultTeam.slug);
  });

  if (collapsed) {
    return (
      <>
        <aside className="hidden w-12 flex-shrink-0 flex-col items-center border-r border-[#E8E8EC] bg-white py-6 md:flex">
          <Link to="/dashboard" title="Home">
            <SnipMark size={32} className="rounded-[9px]" />
          </Link>
          <div className="flex min-h-0 flex-1 flex-col justify-between pt-4">
            <CollapsedRail
              pathname={pathname}
              activeTeamSlug={defaultTeam?.slug}
              onOpenSearch={() => setSearchOpen(true)}
              prewarmInvoicesIntentHandlers={prewarmInvoicesIntentHandlers}
            />
            <div className="flex flex-col items-center gap-2 border-t border-[#E8E8EC] pt-3">
              <ThemeStyleToggle className="flex h-8 w-8 items-center justify-center rounded-[10px] text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315]" />
              <SidebarUserButton />
            </div>
          </div>
        </aside>
        <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
      </>
    );
  }

  return (
    <>
      <aside className="hidden min-h-0 w-58 flex-shrink-0 flex-col border-r border-[#E8E8EC] bg-white px-4 py-6 md:flex">
        {/* Header row: snip. brand on the left, workspace switcher
            chip on the right. The switcher trigger is just a chevron
            chip (no inline name, since the projects list below
            already gives plenty of workspace context). */}
        <div className="flex items-center gap-2 pb-4">
          <Link to="/dashboard" className="flex-1 min-w-0 flex items-center gap-2">
            <SnipMark size={32} className="rounded-[9px]" />
            <span className="text-[22px] font-bold leading-[26px] tracking-[-0.03em] text-[#131315]">
              snip.
            </span>
          </Link>
          <div className="relative">
            <button
              type="button"
              onClick={() => setWorkspaceMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white px-2.5 py-1.5 text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3]"
              title="Switch workspace"
            >
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#FF6600] text-[10px] font-semibold text-white">
                {(defaultTeam?.name ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <ChevronsUpDown className="h-3 w-3 text-[#6E6E73]" />
            </button>
            {workspaceMenuOpen ? (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setWorkspaceMenuOpen(false)}
                />
                <div className="absolute right-0 top-full z-40 mt-1 min-w-[220px] rounded-[11px] border border-[#E8E8EC] bg-white p-1.5">
                  <div className="border-b border-[#F1F1F3] px-2.5 py-2 text-[13px] leading-[18px] text-[#A0A0A5]">
                    Workspaces
                  </div>
                  {(teams ?? []).map((t) => (
                    <Link
                      key={t._id}
                      to={teamHomePath(t.slug)}
                      onClick={() => setWorkspaceMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-sm font-medium transition-colors",
                        t.slug === activeTeamSlug
                          ? "bg-[#FFF0E6] font-semibold text-[#D14E00]"
                          : "text-[#131315] hover:bg-[#F1F1F3]",
                      )}
                    >
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#FF6600] text-[10px] font-semibold text-white">
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
                    className="mt-1 flex w-full items-center gap-2 rounded-[10px] border-t border-[#F1F1F3] px-2.5 py-2 text-sm font-medium text-[#D14E00] transition-colors hover:bg-[#FFF0E6]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create workspace
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="pb-4">
          <CommandSearchTrigger
            onOpen={() => setSearchOpen(true)}
            className="rounded-full border border-[#D8D8DE] bg-white px-3 py-2 text-[13px] leading-[18px] text-[#6E6E73] hover:bg-[#F1F1F3]"
          />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto">
          <SidebarLabel>Projects</SidebarLabel>
          {projects.length === 0 ? (
            <div className="px-2.5 py-2 text-[13px] leading-[18px] text-[#A0A0A5]">
              No projects yet
            </div>
          ) : (
            projects.map((p) => (
              <ProjectRailItem
                key={p._id}
                projectId={p._id}
                teamSlug={p.teamSlug}
                name={p.name}
                activeProjectId={activeProjectId}
                activeFolderId={activeFolderId}
              />
            ))
          )}
          <SidebarLink
            to={TRASH_PATH}
            icon={<Trash2 className="h-4 w-4" />}
            active={pathname.startsWith(TRASH_PATH)}
            muted
          >
            Trash
          </SidebarLink>
        </nav>

        {/* Desktop app download — separated section above the New project
            button. Sits in its own div so it reads as "tooling you can
            install" rather than another nav item or a peer of project
            creation. `/downloads/snip-desktop.pkg` 302-redirects (via
            vercel.json) to the latest GitHub Release asset. The .pkg is the
            recommended installer — a guided wizard that also sets up macFUSE
            so the cloud drive works out of the box. */}
        <div className="border-t border-[#E8E8EC] pb-1 pt-3">
          <DesktopAppOrDrive />
        </div>

        {/* "+ New project" sits directly above the account section,
            below the project list but visually separated. This makes
            the primary creation action easy to spot without burying
            it next to the avatar. */}
        <div className="pb-3 pt-2">
          <button
            type="button"
            onClick={() => setCreateProjectOpen(true)}
            disabled={!defaultTeam}
            title={
              defaultTeam ? "Create a project" : "Create a workspace first"
            }
            className={cn(softButtonPrimary, "flex w-full items-center justify-center gap-2")}
          >
            <Plus className="h-3.5 w-3.5" />
            New project
          </button>
        </div>

        {/* Account links — no section heading, just the three rows
            pinned above the footer. The storage bar sits directly above
            the Billing link so the usage state is visible without a
            click. */}
        <div className="border-t border-[#E8E8EC] pt-2">
          <StorageUsageBar variant="compact" />
        </div>
        <div className="flex flex-col gap-1 pb-2">
          <SidebarLink
            to={BILLING_PATH}
            icon={<CreditCard className="h-4 w-4" />}
            active={pathname.startsWith(BILLING_PATH)}
            muted
          >
            Billing &amp; usage
          </SidebarLink>
          {defaultTeam ? (
            <SidebarLink
              to={teamInvoicesPath(defaultTeam.slug)}
              icon={<ReceiptText className="h-4 w-4" />}
              active={pathname.startsWith(teamInvoicesPath(defaultTeam.slug))}
              muted
              intentHandlers={prewarmInvoicesIntentHandlers}
            >
              Invoices
            </SidebarLink>
          ) : null}
          {defaultTeam ? (
            <SidebarLink
              to={teamSettingsPath(defaultTeam.slug)}
              icon={<Users className="h-4 w-4" />}
              active={pathname.startsWith(
                `/dashboard/${defaultTeam.slug}/settings`,
              )}
              muted
            >
              Team members
            </SidebarLink>
          ) : null}
          <SidebarLink
            to={SETTINGS_PATH}
            icon={<Settings className="h-4 w-4" />}
            active={pathname.startsWith(SETTINGS_PATH)}
            muted
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

function ProjectRailItem({
  projectId,
  teamSlug,
  name,
  activeProjectId,
  activeFolderId,
}: {
  projectId: Id<"projects">;
  teamSlug: string;
  name: string;
  activeProjectId: string | undefined;
  activeFolderId: string | undefined;
}) {
  const folders = useQuery(api.folders.list, { projectId });
  const [expandedPreference, setExpandedPreference] = useState<boolean | null>(
    null,
  );
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const storageKey = `snip:sidebar:folders:${projectId}`;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      setExpandedPreference(
        stored === "1" ? true : stored === "0" ? false : null,
      );
    } catch {
      setExpandedPreference(null);
    }
    setPreferenceLoaded(true);
  }, [storageKey]);

  const hasFolders = folders !== undefined && folders.length > 0;
  const expanded =
    preferenceLoaded && folders !== undefined
      ? (expandedPreference ?? folders.length <= 5)
      : false;
  const projectActive =
    activeProjectId === projectId && activeFolderId === undefined;

  const toggleFolders = () => {
    const next = !expanded;
    setExpandedPreference(next);
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      // ignored
    }
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center rounded-[10px] transition-colors",
          projectActive
            ? "bg-[#FFF0E6] text-[#D14E00]"
            : "text-[#131315] hover:bg-[#F1F1F3]",
        )}
      >
        <Link
          to={projectPath(teamSlug, projectId)}
          preload="intent"
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-[15px] font-medium leading-[22px]",
            projectActive && "font-semibold",
          )}
        >
          <Briefcase className="h-4 w-4 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
        </Link>
        {hasFolders ? (
          <button
            type="button"
            onClick={toggleFolders}
            className="mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] text-[#6E6E73] transition-colors hover:bg-white/70 hover:text-[#131315] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#131315]"
            title={expanded ? "Hide folders" : "Show folders"}
            aria-label={`${expanded ? "Hide" : "Show"} folders in ${name}`}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </div>
      {hasFolders && expanded ? (
        <div>
          {folders.map((folder) => (
            <Link
              key={folder._id}
              to={projectPath(teamSlug, projectId)}
              search={{ folder: folder._id } as never}
              preload="intent"
              className={cn(
                "ml-5 flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] font-medium leading-[22px] transition-colors",
                activeProjectId === projectId && activeFolderId === folder._id
                  ? "bg-[#FFF0E6] font-semibold text-[#D14E00]"
                  : "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]",
              )}
            >
              <Folder className="h-4 w-4 flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CollapsedRail({
  pathname,
  activeTeamSlug,
  onOpenSearch,
  prewarmInvoicesIntentHandlers,
}: {
  pathname: string;
  activeTeamSlug: string | undefined;
  onOpenSearch: () => void;
  prewarmInvoicesIntentHandlers: IntentHandlers;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex h-8 w-8 items-center justify-center rounded-[10px] text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315]"
        title="Search (⌘K)"
      >
        <Briefcase className="h-4 w-4" />
      </button>
      <Link
        to={BILLING_PATH}
        title="Billing & usage"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors",
          pathname.startsWith(BILLING_PATH)
            ? "bg-[#FFF0E6] text-[#D14E00]"
            : "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]",
        )}
      >
        <CreditCard className="h-4 w-4" />
      </Link>
      {activeTeamSlug ? (
        <Link
          to={teamInvoicesPath(activeTeamSlug)}
          preload="intent"
          title="Invoices"
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors",
            pathname.startsWith(teamInvoicesPath(activeTeamSlug))
              ? "bg-[#FFF0E6] text-[#D14E00]"
              : "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]",
          )}
          {...prewarmInvoicesIntentHandlers}
        >
          <ReceiptText className="h-4 w-4" />
        </Link>
      ) : null}
      {activeTeamSlug ? (
        <Link
          to={teamSettingsPath(activeTeamSlug)}
          title="Team members"
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors",
            pathname.startsWith(`/dashboard/${activeTeamSlug}/settings`)
              ? "bg-[#FFF0E6] text-[#D14E00]"
              : "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]",
          )}
        >
          <Users className="h-4 w-4" />
        </Link>
      ) : null}
      <Link
        to={SETTINGS_PATH}
        title="Settings"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors",
          pathname.startsWith(SETTINGS_PATH)
            ? "bg-[#FFF0E6] text-[#D14E00]"
            : "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]",
        )}
      >
        <Settings className="h-4 w-4" />
      </Link>
      <Link
        to={TRASH_PATH}
        title="Trash"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors",
          pathname.startsWith(TRASH_PATH)
            ? "bg-[#FFF0E6] text-[#D14E00]"
            : "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]",
        )}
      >
        <Trash2 className="h-4 w-4" />
      </Link>
    </div>
  );
}

function SidebarLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pb-2.5 pt-1.5 text-[13px] leading-[18px] text-[#A0A0A5]">
      {children}
    </div>
  );
}

function SidebarLink({
  to,
  icon,
  active,
  muted,
  intentHandlers,
  children,
}: {
  to: string;
  icon?: ReactNode;
  active?: boolean;
  muted?: boolean;
  intentHandlers?: IntentHandlers;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      preload="intent"
      {...intentHandlers}
      className={cn(
        "flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[15px] font-medium leading-[22px] transition-colors",
        active
          ? "bg-[#FFF0E6] font-semibold text-[#D14E00]"
          : muted
            ? "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]"
            : "text-[#131315] hover:bg-[#F1F1F3]",
      )}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="truncate flex-1">{children}</span>
    </Link>
  );
}

function SidebarFooter({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 border-t border-[#E8E8EC] pt-3">
      <SidebarUserButton />
      <div className="flex-1 min-w-0">
        <div className="truncate text-[13px] font-medium leading-[18px] text-[#131315]">
          {name || "Account"}
        </div>
      </div>
      <ThemeStyleToggle className="flex h-8 w-8 items-center justify-center rounded-[10px] text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315]" />
    </div>
  );
}

function SidebarUserButton() {
  return (
    <UserButton
      appearance={{
        variables: {
          colorText: "#131315",
          colorTextSecondary: "#6E6E73",
          colorBackground: "#FFFFFF",
          colorNeutral: "#E8E8EC",
        },
        elements: {
          avatarBox: "w-7 h-7 rounded-full border border-[#E8E8EC]",
          userButtonPopoverCard:
            "bg-white border border-[#E8E8EC] rounded-[14px] shadow-none",
          userButtonPopoverActionButton:
            "!text-[#131315] hover:!bg-[#F1F1F3] rounded-[10px]",
          userButtonPopoverActionButtonText:
            "!text-[#131315] hover:!text-[#131315] font-sans font-medium",
          userButtonPopoverActionButtonIcon:
            "!text-[#6E6E73] hover:!text-[#131315]",
          userButtonPopoverFooter: "hidden",
        },
      }}
    />
  );
}

/**
 * In a browser: a "Download the desktop app" button. Inside the desktop shell
 * (window.snipDesktop): the cloud-drive control — Enable mounts the bucket via
 * the native bridge (fetching storage creds from Convex), then shows Connected
 * with an Open-in-Finder action.
 */
const DESKTOP_BTN =
  `${softButton} flex w-full items-center justify-center gap-2`;

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

// Bound a promise so a hung backend call can't leave the Enable button stuck on
// "Connecting drive…" forever. Rejects with a friendly message on timeout.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out. Check your connection and retry.`)),
        ms,
      ),
    ),
  ]);
}

function DesktopAppOrDrive() {
  const getStorageBootstrap = useAction(api.desktopAuth.getStorageBootstrap);
  const { getToken, isSignedIn } = useAuth();
  const [isDesktop, setIsDesktop] = useState(false);
  const [mount, setMount] = useState<{
    status: string;
    mountPath: string | null;
    lastError: string | null;
    log?: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Epoch ms when the current storage credential expires (scoped creds
  // only; null for the legacy shared key). Drives the refresh timer.
  const [credExpiresAt, setCredExpiresAt] = useState<number | null>(null);

  // The native WebDAV drive resolves every path (list / read / upload) through
  // Convex, so the main process needs the Convex deployment URL + a valid Convex
  // JWT. We're the signed-in web app inside the shell, so we mint the token via
  // Clerk and push it down. Kept in memory on the native side — nothing is
  // persisted. Returns false when we can't produce a token (not signed in yet).
  const pushConvexAuth = useCallback(async () => {
    if (typeof window === "undefined" || !window.api?.convex) return false;
    try {
      const token = await getToken({ template: "convex" });
      const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
      if (!token || !url) return false;
      await window.api.convex.setAuth({ url, token });
      return true;
    } catch {
      return false;
    }
  }, [getToken]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.snipDesktop?.isDesktop || !window.api) return;
    setIsDesktop(true);
    void window.api.mount.status().then(setMount).catch(() => {});
    return window.api.mount.onStatus(setMount);
  }, []);

  // Push Convex auth to native as soon as we're signed in. This also releases a
  // deferred auto-mount: the native side waits for a token before mounting on
  // launch, so the drive comes up by itself once the web app finishes loading.
  useEffect(() => {
    if (typeof window === "undefined" || !window.snipDesktop?.isDesktop || !window.api?.convex) return;
    if (!isSignedIn) return;
    void pushConvexAuth();
  }, [isSignedIn, pushConvexAuth]);

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

  // Keep the native Convex token fresh while the drive is up. Clerk tokens are
  // short-lived (~60s); re-push every 30s so a long-lived FUSE mount never makes
  // a Convex call with an expired bearer. getToken returns Clerk's cached token
  // until it nears expiry, so this is cheap.
  useEffect(() => {
    if (typeof window === "undefined" || !window.api?.convex) return;
    if (mountStatus !== "mounted" && mountStatus !== "mounting") return;
    const id = setInterval(() => {
      void pushConvexAuth();
    }, 30_000);
    return () => clearInterval(id);
  }, [mountStatus, pushConvexAuth]);

  const enable = useCallback(async () => {
    if (!window.api) {
      setError("Desktop bridge unavailable. Restart the app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Vending creds is the first thing that can hang the flow — bound it.
      const boot = await withTimeout(
        getStorageBootstrap({}),
        20_000,
        "Fetching drive credentials",
      );
      if (!boot) {
        setError("Storage isn't configured on the server (no bucket creds).");
        return;
      }
      const cur = await window.api.settings.get();
      await window.api.settings.set({ ...cur, storage: { ...cur.storage, ...boot } });
      setCredExpiresAt(boot.expiresAt ?? null);
      // Hand the native layer a live Convex session BEFORE mounting — the
      // WebDAV drive resolves every path through Convex and is dead without it.
      const authed = await pushConvexAuth();
      if (!authed) {
        setError("Couldn't get a Convex session. Make sure you're signed in, then retry.");
        return;
      }
      // mount.start returns quickly (status flips to "mounting"); the main
      // process owns the rest and self-aborts via its watchdog, and we render
      // its live progress from the mount status log below.
      await window.api.mount.start({});
    } catch (e) {
      setError(friendlyDriveError(e));
    } finally {
      setBusy(false);
    }
  }, [getStorageBootstrap, pushConvexAuth]);

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

  // Offer the installer for the OS the user is actually on. This button used to
  // always point at the macOS .pkg.
  const [desktopDownload, setDesktopDownload] =
    useState<DesktopDownload>(NEUTRAL_DOWNLOAD);
  useEffect(() => {
    const platform = detectPlatform();
    if (platform) setDesktopDownload(downloadFor(platform));
  }, []);

  if (!isDesktop) {
    return (
      <a
        href={desktopDownload.href}
        className={DESKTOP_BTN}
        title={`Download snip Desktop for ${desktopDownload.os}`}
      >
        <HardDrive className="h-3.5 w-3.5" />
        Desktop installer
      </a>
    );
  }

  const status = mount?.status ?? "unmounted";
  const shownError = error ?? (status === "error" ? mount?.lastError : null);
  // Live progress: the last line of the mount log, shown while connecting so
  // the spinner isn't a black box (e.g. "Downloading drive engine — 50%",
  // "Starting rclone mount…"). The log is the tail emitted by electron-main.
  const connecting = busy || status === "mounting";
  const lastStep =
    connecting && mount?.log && mount.log.length > 0
      ? mount.log[mount.log.length - 1].replace(/^\d{2}:\d{2}:\d{2}\s+/, "")
      : null;
  return (
    <div className="flex flex-col gap-1.5">
      {status === "mounted" ? (
        <div className="flex w-full overflow-hidden rounded-full border border-[#D8D8DE] bg-white">
          <button
            type="button"
            onClick={() => void window.api?.shell.openFolder(mount?.mountPath ?? "")}
            className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-[13px] font-medium leading-[18px] text-[#131315] transition-colors hover:bg-[#F1F1F3]"
            title="Open the cloud drive in Finder"
          >
            <HardDrive className="h-3.5 w-3.5" />
            <span className="truncate">Drive connected</span>
          </button>
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="flex h-auto w-9 flex-shrink-0 items-center justify-center border-l border-[#E8E8EC] text-[#6E6E73] transition-colors hover:bg-[#FFF0E6] hover:text-[#D14E00] disabled:opacity-50"
            title="Unmount the cloud drive"
            aria-label="Disconnect drive"
          >
            <Unplug className="h-3.5 w-3.5" />
          </button>
        </div>
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
      {lastStep ? (
        <p className="truncate text-[13px] leading-[18px] text-[#A0A0A5]" title={lastStep}>
          {lastStep}
        </p>
      ) : null}
      {shownError ? (
        <p className="text-[13px] leading-[18px] text-[#D8434F]">{shownError}</p>
      ) : null}
    </div>
  );
}
