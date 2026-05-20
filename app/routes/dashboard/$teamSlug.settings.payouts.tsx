import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Payouts moved out of per-team settings and into the account Billing
 * page, so all money controls live in one place. This route now just
 * redirects any old links/bookmarks to /dashboard/billing.
 */
export const Route = createFileRoute("/dashboard/$teamSlug/settings/payouts")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/billing" });
  },
});
