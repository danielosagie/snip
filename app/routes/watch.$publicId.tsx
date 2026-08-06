import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { seoHead } from "@/lib/seo";
import WatchPage from "./-watch";

type WatchUnfurl = {
  title: string;
  description: string | null;
  image: string | null;
  video: {
    url: string;
    width: number;
    height: number;
    type: "video/mp4";
  } | null;
};

// Resolve public watch metadata server-side for crawlers and the initial
// document title. Best-effort with the existing short timeout, so a slow Mux
// lookup still falls back cleanly while the page renders from client queries.
async function loadWatchUnfurl(publicId: string): Promise<WatchUnfurl | null> {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) return null;
  try {
    const client = new ConvexHttpClient(url);
    return await Promise.race([
      client.action(api.videoActions.getWatchUnfurl, { publicId }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/watch/$publicId")({
  loader: async ({ params }) => ({
    unfurl: await loadWatchUnfurl(params.publicId),
  }),
  head: ({ params, loaderData }) => {
    const unfurl = loaderData?.unfurl ?? null;
    return seoHead({
      title: unfurl?.title ?? "Watch video",
      description:
        unfurl?.description ??
        (unfurl?.title
          ? `Watch "${unfurl.title}" on snip.`
          : "Watch and review this video on snip."),
      path: `/watch/${params.publicId}`,
      ogImage: unfurl?.image ?? undefined,
      ogImageAlt: unfurl?.title
        ? `Preview frame of "${unfurl.title}"`
        : undefined,
      ogVideo: unfurl?.video ?? undefined,
      type: unfurl?.video ? "video.other" : "website",
      noIndex: true,
    });
  },
  component: WatchPage,
});
