import { Link } from "@tanstack/react-router";
import { UserButton } from "@clerk/tanstack-react-start";
import { Moon, PanelLeft, PanelLeftClose, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeToggle";
import React, { useEffect, useState } from "react";
import { useConvex } from "convex/react";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";
import { prewarmDashboardIndex } from "../../app/routes/dashboard/-index.data";
import { useSidebarState } from "@/lib/sidebarContext";

/**
 * True when the renderer is running inside the snip Desktop Electron
 * shell. The shell exposes `window.snipDesktop` via the preload
 * bridge; browsers don't, so this cleanly toggles the desktop-only
 * UI affordances (traffic-light spacer, draggable chrome).
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsDesktop(Boolean(window.snipDesktop?.isDesktop));
  }, []);
  return isDesktop;
}

function ThemeToggleButton() {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) return <div className="w-8 h-8" />;

  return (
    <button
      onClick={toggleTheme}
      className="w-8 h-8 flex items-center justify-center text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0] transition-colors"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode (⌘⇧L)`}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}

export type PathSegment = {
  label: React.ReactNode;
  href?: string;
  prewarmIntentHandlers?: ReturnType<typeof useRoutePrewarmIntent>;
};

export function DashboardHeader({
  children,
  paths = [],
  hideBreadcrumb,
}: {
  children?: React.ReactNode;
  paths?: PathSegment[];
  /** When true, the snip. + path segment crumb on the left is hidden.
   *  Useful for the home page where the breadcrumb would just point at
   *  itself, and inside the video player where we prefer a Back button. */
  hideBreadcrumb?: boolean;
}) {
  const convex = useConvex();
  const { collapsed, toggle } = useSidebarState();
  const isDesktop = useIsDesktop();
  const prewarmHomeIntentHandlers = useRoutePrewarmIntent(() =>
    prewarmDashboardIndex(convex),
  );

  // Notion/Shade-style chrome: the OS title bar is gone inside
  // Electron (titleBarStyle: "hiddenInset"/"hidden"), so we reserve
  // ~80px on the left for the macOS traffic lights or for the
  // Windows WCO overlay. Empty header background gets `app-region:
  // drag` so users can still grab it to move the window; interactive
  // controls inside opt back out with `no-drag` (see button styles
  // below).
  const trafficLightSpacerClass = isDesktop ? "pl-[80px]" : "px-4 sm:px-6";
  const dragRegionStyle = isDesktop
    ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
    : undefined;
  const noDragStyle = isDesktop
    ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
    : undefined;

  return (
    <header
      className={`flex-shrink-0 border-b-2 border-[#1a1a1a] bg-[#f0f0e8] grid grid-cols-[1fr_auto] sm:grid-cols-[auto_1fr_auto] items-center ${trafficLightSpacerClass}`}
      style={dragRegionStyle}
    >
      {/* Breadcrumb + sidebar toggle */}
      <div className="flex items-center text-xl font-black tracking-tighter text-[#1a1a1a] min-w-0 h-11 sm:h-14">
        <button
          type="button"
          onClick={toggle}
          style={noDragStyle}
          className="hidden md:inline-flex items-center justify-center w-8 h-8 mr-2 text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0] flex-shrink-0"
          title={collapsed ? "Open sidebar" : "Close sidebar"}
          aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
        {hideBreadcrumb ? null : (
          <>
            <Link
              to="/dashboard"
              preload="intent"
              style={noDragStyle}
              className="hover:text-[#FF6600] transition-colors mr-2 flex-shrink-0"
              {...prewarmHomeIntentHandlers}
            >
              Home
            </Link>
            {paths.map((path, index) => {
              const isIntermediate = paths.length >= 2 && index < paths.length - 1;
              return (
              <div key={index} className={`${isIntermediate ? 'hidden sm:flex' : 'flex'} items-center min-w-0 flex-shrink`}>
                <span className="text-[#888] mr-2 flex-shrink-0">/</span>
                {path.href ? (
                  <Link
                    to={path.href}
                    preload="intent"
                    style={noDragStyle}
                    className="hover:text-[#FF6600] transition-colors truncate mr-2"
                    {...path.prewarmIntentHandlers}
                  >
                    {path.label}
                  </Link>
                ) : (
                  <div style={noDragStyle} className="truncate flex items-center gap-3">
                    {path.label}
                  </div>
                )}
              </div>
            );
            })}
          </>
        )}
      </div>

      {/* User controls — pinned top-right. On desktop these live in the
          sidebar footer, but we keep them on mobile + when the sidebar
          is collapsed for quick reach. */}
      <div
        style={noDragStyle}
        className="row-start-1 col-start-2 sm:col-start-3 flex items-center gap-4 pl-4 border-l-2 border-[#1a1a1a]/10 h-8 md:hidden"
      >
        <ThemeToggleButton />
        <UserButton
          appearance={{
            variables: {
              colorText: "var(--foreground)",
              colorTextSecondary: "var(--foreground-muted)",
              colorBackground: "var(--background)",
              colorNeutral: "var(--border)",
            },
            elements: {
              avatarBox: "w-8 h-8 rounded-none border-2 border-[var(--border)]",
              userButtonPopoverCard: "bg-[var(--background)] border-2 border-[var(--border)] rounded-none shadow-[8px_8px_0px_0px_var(--shadow-color)]",
              userButtonPopoverActionButton: "!text-[var(--foreground)] hover:!bg-[var(--surface-alt)] rounded-none",
              userButtonPopoverActionButtonText: "!text-[var(--foreground)] hover:!text-[var(--foreground)] font-mono font-bold",
              userButtonPopoverActionButtonIcon: "!text-[var(--foreground)] hover:!text-[var(--foreground)]",
              userButtonPopoverFooter: "hidden",
            },
          }}
        />
      </div>

      {/* Children — second row on mobile, middle column on desktop */}
      {children && (
        <div
          style={noDragStyle}
          className="col-span-full pb-2 sm:pb-0 sm:col-span-1 sm:col-start-2 sm:row-start-1 flex items-center gap-2 sm:gap-3 sm:justify-end sm:h-14 sm:pl-4 min-w-0"
        >
          {children}
        </div>
      )}
    </header>
  );
}
