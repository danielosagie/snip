import { createFileRoute } from "@tanstack/react-router";
import { seoHead } from "@/lib/seo";
import PricingPage from "./-pricing";

export const Route = createFileRoute("/pricing")({
  head: () =>
    seoHead({
      title: "Pricing — Free up to 25 GB, then $25 or $50/month",
      description:
        "snip is free up to 25 GB. Basic at $25/month gets you 500 GB. Pro at $50/month gets you 2 TB. Paid plans include unlimited collaborators.",
      path: "/pricing",
      ogImage: "/og/pricing.png",
    }),
  component: PricingPage,
});
