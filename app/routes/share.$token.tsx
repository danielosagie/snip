import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { seoHead } from "@/lib/seo";
import SharePage from "./-share";

// Resolve the shared item's title server-side for link-unfurl previews. Uses
// the privacy-gated getUnfurlByToken (no grant issued; password/invite links
// return null so a leaked URL can't expose the title in a chat preview).
// Best-effort with a short timeout — failures fall back to the generic title
// and the page still renders via its own client queries.
async function loadShareTitle(token: string): Promise<string | null> {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) return null;
  try {
    const client = new ConvexHttpClient(url);
    return await Promise.race([
      client
        .query(api.shareLinks.getUnfurlByToken, { token })
        .then((data) => data?.title ?? null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/share/$token")({
  loader: async ({ params }) => ({
    title: await loadShareTitle(params.token),
  }),
  head: ({ params, loaderData }) =>
    seoHead({
      title: loaderData?.title ?? "Shared video",
      description: loaderData?.title
        ? `Watch "${loaderData.title}" on snip.`
        : "Review this shared video on snip.",
      path: `/share/${params.token}`,
      noIndex: true,
    }),
  component: SharePage,
});
