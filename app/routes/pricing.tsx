import { createFileRoute } from "@tanstack/react-router";
import { seoHead } from "@/lib/seo";
import PricingPage from "./-pricing";

export const Route = createFileRoute("/pricing")({
  head: () =>
    seoHead({
      title: "Pricing — Free up to 20 GB, then $20 or $50/month",
      description:
        "snip is free up to 20 GB. Basic at $20/month gets you 2 TB. Pro at $50/month gets you 5 TB. Unlimited seats, projects, and clients on every plan.",
      path: "/pricing",
      ogImage: "/og/pricing.png",
    }),
  component: PricingPage,
});
