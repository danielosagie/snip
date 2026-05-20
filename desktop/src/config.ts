/**
 * Baked-in deployment config so the desktop app is zero-setup: the user
 * never types a Convex URL or auth provider key. Both values below are
 * *client-public by design* — the Convex deployment URL and the Clerk
 * **publishable** key ship in every web bundle already. The Clerk secret
 * key is NEVER here; it lives only in the Convex backend env.
 *
 * Overridable at build time via Vite env (VITE_CONVEX_URL /
 * VITE_CLERK_PUBLISHABLE_KEY) for staging/self-host builds.
 */

const env = import.meta.env as Record<string, string | undefined>;

export const CONVEX_URL =
  env.VITE_CONVEX_URL?.trim() || "https://confident-starling-497.convex.cloud";

export const CLERK_PUBLISHABLE_KEY =
  env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
  "pk_test_b3V0Z29pbmctd2VldmlsLTE4LmNsZXJrLmFjY291bnRzLmRldiQ";

/** Web origin for the connect-desktop hand-off. Override at build time
 *  via VITE_WEB_ORIGIN (desktop/.env) for staging/self-host builds.
 *  Default points at the canonical Vercel project URL until a custom
 *  domain is registered + assigned to the project — `snip.film` was the
 *  planned domain but is unregistered (NXDOMAIN), so it can't be the
 *  fallback. */
export const WEB_ORIGIN =
  env.VITE_WEB_ORIGIN?.trim() || "https://snipfilm.vercel.app";

/** Convex function path → full HTTP endpoint for unauthenticated public
 *  mutation calls (pairing) made before we have a session. */
export function convexMutationUrl(): string {
  return `${CONVEX_URL.replace(/\/$/, "")}/api/mutation`;
}
