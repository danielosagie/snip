const SITE_URL = "https://snip.film";
const SITE_NAME = "snip";
const DEFAULT_OG_IMAGE = "/og/default.png";

type SeoOptions = {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  /** Alt text for the OG image — describes the preview frame for a11y. */
  ogImageAlt?: string;
  type?: string;
  noIndex?: boolean;
};

export function seoHead({
  title,
  description,
  path,
  ogImage = DEFAULT_OG_IMAGE,
  ogImageAlt,
  type = "website",
  noIndex = false,
}: SeoOptions) {
  const fullTitle = title.toLowerCase().includes("snip")
    ? title
    : `${title} | snip`;
  const url = `${SITE_URL}${path}`;
  const imageUrl = ogImage.startsWith("http")
    ? ogImage
    : `${SITE_URL}${ogImage}`;

  const meta: Array<Record<string, string>> = [
    { title: fullTitle },
    { name: "description", content: description },
    // Open Graph
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:image", content: imageUrl },
    // All snip OG cards (the static defaults and the dynamic Mux preview
    // thumbnails) render at the 1.91:1 large-card size, so pin the dims so
    // crawlers lay the card out before the image finishes loading.
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:url", content: url },
    { property: "og:type", content: type },
    { property: "og:site_name", content: SITE_NAME },
    // Twitter
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: imageUrl },
  ];

  if (ogImageAlt) {
    meta.push({ property: "og:image:alt", content: ogImageAlt });
    meta.push({ name: "twitter:image:alt", content: ogImageAlt });
  }

  if (noIndex) {
    meta.push({ name: "robots", content: "noindex,nofollow" });
  }

  const links = [{ rel: "canonical", href: url }];

  return { meta, links };
}
