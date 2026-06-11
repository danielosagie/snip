import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { seoHead } from "@/lib/seo";
import SharePage from "./-share";

type ShareUnfurl = {
  title: string;
  description: string | null;
  image: string | null;
  watermarked: boolean;
};

// Resolve the shared item's title + a watermarked preview frame server-side
// for link-unfurl previews (iMessage / Slack / Discord). Uses the privacy-gated
// getShareUnfurl action — no grant issued; password/invite links return null so
// a leaked URL can't expose the title or a frame in a chat preview. Best-effort
// with a short timeout — failures fall back to the generic card and the page
// still renders via its own client queries.
async function loadShareUnfurl(token: string): Promise<ShareUnfurl | null> {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) return null;
  try {
    const client = new ConvexHttpClient(url);
    return await Promise.race([
      client.action(api.videoActions.getShareUnfurl, { token }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/share/$token")({
  loader: async ({ params }) => ({
    unfurl: await loadShareUnfurl(params.token),
  }),
  head: ({ params, loaderData }) => {
    const unfurl = loaderData?.unfurl ?? null;
    return seoHead({
      title: unfurl?.title ?? "Shared video",
      description: unfurl?.title
        ? `Watch "${unfurl.title}" on snip.`
        : "Review this shared video on snip.",
      path: `/share/${params.token}`,
      // Watermarked preview frame when available; seoHead falls back to the
      // default OG card when this is undefined.
      ogImage: unfurl?.image ?? undefined,
      ogImageAlt: unfurl?.title
        ? `Preview frame of "${unfurl.title}"`
        : undefined,
      noIndex: true,
    });
  },
  component: SharePage,
});
