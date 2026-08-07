import { createFileRoute } from "@tanstack/react-router";
import { seoHead } from "@/lib/seo";
import PricingPage from "./-pricing";

export const Route = createFileRoute("/pricing")({
  head: () =>
    seoHead({
      title: "Pricing: free 100 GB, Studio $49, Scale $149",
      description:
        "snip is free up to 100 GB. Studio is $49/month for 1 TB and Scale is $149/month for 5 TB. Every plan includes unlimited seats.",
      path: "/pricing",
      ogImage: "/og/pricing.png",
    }),
  component: PricingPage,
});
