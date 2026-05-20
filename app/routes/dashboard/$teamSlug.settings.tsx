import { Outlet, createFileRoute, Link, useLocation, useParams } from "@tanstack/react-router";

/**
 * Layout route for `/dashboard/$teamSlug/settings/*`. Renders a tab
 * strip above an Outlet so child routes (members, payouts, folder
 * permissions) share a single navigation surface instead of each one
 * stamping its own header.
 *
 * The team-members page is the index child (`$teamSlug.settings.index.tsx`).
 */
export const Route = createFileRoute("/dashboard/$teamSlug/settings")({
  component: TeamSettingsLayout,
});

const TABS = [
  // The Members tab is the index route — its `to` is the bare settings
  // path. Folder permissions is the snip Desktop ACL surface that used
  // to live in the desktop SettingsView; it belongs here because grants
  // are team-scoped. Payouts moved to /dashboard/billing.
  { label: "Members", suffix: "" },
  { label: "Folder permissions", suffix: "/folders" },
] as const;

function TeamSettingsLayout() {
  const params = useParams({ strict: false });
  const teamSlug = typeof params.teamSlug === "string" ? params.teamSlug : "";
  const pathname = useLocation().pathname;
  const basePath = `/dashboard/${teamSlug}/settings`;

  return (
    <div className="h-full flex flex-col">
      <nav className="border-b-2 border-[#1a1a1a] bg-[#f0f0e8] px-6 pt-4">
        <div className="max-w-3xl mx-auto flex gap-1">
          {TABS.map((tab) => {
            const target = `${basePath}${tab.suffix}`;
            // Active match: exact for the index, prefix for sub-routes.
            const isActive = tab.suffix === ""
              ? pathname === basePath || pathname === `${basePath}/`
              : pathname.startsWith(target);
            return (
              <Link
                key={tab.label}
                to={target}
                className={
                  isActive
                    ? "px-4 py-2 text-sm font-bold border-2 border-[#1a1a1a] border-b-0 bg-[#f0f0e8] text-[#1a1a1a] -mb-[2px] relative z-10"
                    : "px-4 py-2 text-sm font-bold text-[#666] hover:text-[#1a1a1a] border-2 border-transparent"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
