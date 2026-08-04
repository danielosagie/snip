import { SITE_URL } from "@/lib/seo";

/**
 * Public links must not inherit the dashboard host. The desktop app runs the
 * web UI from snipfilm.vercel.app, so window.location.origin would otherwise
 * leak that deployment hostname into every copied client link.
 */
export function publicShareUrl(token: string): string {
  return `${SITE_URL}/share/${encodeURIComponent(token)}`;
}

export function publicWatchUrl(publicId: string): string {
  return `${SITE_URL}/watch/${encodeURIComponent(publicId)}`;
}
