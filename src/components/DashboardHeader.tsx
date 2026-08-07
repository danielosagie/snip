import { Link } from "@tanstack/react-router";
import { UserButton } from "@clerk/tanstack-react-start";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import { ThemeStyleToggle } from "@/components/theme/ThemeToggle";
import React from "react";
import { useConvex } from "convex/react";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";
import { prewarmDashboardIndex } from "../../app/routes/dashboard/-index.data";
import { useSidebarState } from "@/lib/sidebarContext";
import { cn } from "@/lib/utils";

function ThemeToggleButton() {
  return (
    <ThemeStyleToggle className="flex h-8 w-8 items-center justify-center rounded-full text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315]" />
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
  const prewarmHomeIntentHandlers = useRoutePrewarmIntent(() =>
    prewarmDashboardIndex(convex),
  );

  return (
    <header className="grid min-h-14 flex-shrink-0 grid-cols-[1fr_auto] items-center border-b border-[#E8E8EC] bg-white px-4 sm:grid-cols-[auto_1fr_auto] sm:px-6">
      {/* Breadcrumb + sidebar toggle */}
      <div className="flex h-14 min-w-0 items-center text-sm leading-5 text-[#6E6E73]">
        <button
          type="button"
          onClick={toggle}
          className="mr-2 hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315] md:inline-flex"
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
              className="mr-2 flex-shrink-0 transition-colors hover:text-[#131315]"
              {...prewarmHomeIntentHandlers}
            >
              Home
            </Link>
            {paths.map((path, index) => {
              const isIntermediate = paths.length >= 2 && index < paths.length - 1;
              return (
              <div key={index} className={`${isIntermediate ? 'hidden sm:flex' : 'flex'} items-center min-w-0 flex-shrink`}>
                <span className="mr-2 flex-shrink-0 text-[#A0A0A5]">/</span>
                {path.href ? (
                  <Link
                    to={path.href}
                    preload="intent"
                    className={cn(
                      "mr-2 truncate transition-colors hover:text-[#131315]",
                      index === paths.length - 1 && "font-medium text-[#131315]",
                    )}
                    {...path.prewarmIntentHandlers}
                  >
                    {path.label}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 truncate font-medium text-[#131315]">
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
      <div className="row-start-1 col-start-2 flex h-8 items-center gap-3 border-l border-[#E8E8EC] pl-4 sm:col-start-3 md:hidden">
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
              avatarBox: "w-8 h-8 rounded-full border border-[#E8E8EC]",
              userButtonPopoverCard: "bg-white border border-[#E8E8EC] rounded-[14px] shadow-none",
              userButtonPopoverActionButton: "!text-[#131315] hover:!bg-[#F1F1F3] rounded-[10px]",
              userButtonPopoverActionButtonText: "!text-[#131315] hover:!text-[#131315] font-sans font-medium",
              userButtonPopoverActionButtonIcon: "!text-[var(--foreground)] hover:!text-[var(--foreground)]",
              userButtonPopoverFooter: "hidden",
            },
          }}
        />
      </div>

      {/* Children — second row on mobile, middle column on desktop */}
      {children && (
        <div className="col-span-full pb-2 sm:pb-0 sm:col-span-1 sm:col-start-2 sm:row-start-1 flex items-center gap-2 sm:gap-3 sm:justify-end sm:h-14 sm:pl-4 min-w-0">
          {children}
        </div>
      )}
    </header>
  );
}
