import { seoHead, type OgVideo } from "@/lib/seo";

export type ShareUnfurl = {
  kind: "video" | "image" | "document" | "bundle";
  title: string;
  description: string | null;
  image: string | null;
  watermarked: boolean;
  video: OgVideo | null;
};

export type WatchUnfurl = {
  title: string;
  description: string | null;
  image: string | null;
  video: OgVideo | null;
};

function absoluteHttpsImage(image: string | null | undefined) {
  if (!image) return undefined;
  try {
    const url = new URL(image);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function shareUnfurlHead(token: string, unfurl: ShareUnfurl | null) {
  return seoHead({
    title:
      unfurl?.title ??
      (unfurl?.kind === "bundle" ? "Shared files" : "Shared video"),
    description:
      unfurl?.description ??
      (unfurl?.title
        ? `View "${unfurl.title}" on snip.`
        : "Review this shared work on snip."),
    path: `/share/${token}`,
    ogImage: absoluteHttpsImage(unfurl?.image),
    ogImageAlt: unfurl?.title ? `Preview of "${unfurl.title}"` : undefined,
    ogVideo: unfurl?.video ?? undefined,
    type: unfurl?.video ? "video.other" : "website",
    noIndex: true,
  });
}

export function watchUnfurlHead(publicId: string, unfurl: WatchUnfurl | null) {
  return seoHead({
    title: unfurl?.title ?? "Watch video",
    description:
      unfurl?.description ??
      (unfurl?.title
        ? `Watch "${unfurl.title}" on snip.`
        : "Watch and review this video on snip."),
    path: `/watch/${publicId}`,
    ogImage: absoluteHttpsImage(unfurl?.image),
    ogImageAlt: unfurl?.title
      ? `Preview frame of "${unfurl.title}"`
      : undefined,
    ogVideo: unfurl?.video ?? undefined,
    type: unfurl?.video ? "video.other" : "website",
    noIndex: true,
  });
}
