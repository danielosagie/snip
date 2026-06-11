import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { seoHead } from "@/lib/seo";
import WatchPage from "./-watch";

// Resolve the video title server-side so link-unfurl previews (iMessage, Slack,
// Discord, Twitter) and the initial document title show the real name instead
// of a generic "Watch video". Best-effort with a short timeout — any failure
// (missing env, unreachable deployment, slow query) falls back to the generic
// title and the page still renders via its own client queries.
async function loadWatchTitle(publicId: string): Promise<string | null> {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) return null;
  try {
    const client = new ConvexHttpClient(url);
    return await Promise.race([
      client
        .query(api.videos.getByPublicId, { publicId })
        .then((data) => data?.video?.title ?? null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/watch/$publicId")({
  loader: async ({ params }) => ({
    title: await loadWatchTitle(params.publicId),
  }),
  head: ({ params, loaderData }) =>
    seoHead({
      title: loaderData?.title ?? "Watch video",
      description: loaderData?.title
        ? `Watch "${loaderData.title}" on snip.`
        : "Watch and review this video on snip.",
      path: `/watch/${params.publicId}`,
      noIndex: true,
    }),
  component: WatchPage,
});
