import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  renderUnfurlHtml,
  type UnfurlRoute,
} from "./unfurlHtml.js";
import type { ShareUnfurl, WatchUnfurl } from "./unfurlSeo.js";

const UNFURL_TIMEOUT_MS = 2500;
const PROD_CONVEX_URL = "https://knowing-dogfish-12.convex.cloud";

const getShareUnfurl = makeFunctionReference<
  "action",
  { token: string },
  ShareUnfurl | null
>("videoActions:getShareUnfurl");

const getWatchUnfurl = makeFunctionReference<
  "action",
  { publicId: string },
  WatchUnfurl | null
>("videoActions:getWatchUnfurl");

type LoadResult =
  | { status: "ok"; value: ShareUnfurl | WatchUnfurl | null }
  | { status: "failed" };

type UnfurlMiddlewareDependencies = {
  loadShell: (request: Request) => Promise<Response>;
  loadUnfurl: (route: UnfurlRoute) => Promise<LoadResult>;
  next: () => Response | undefined;
  renderHtml: typeof renderUnfurlHtml;
};

function readRoute(requestUrl: URL): UnfurlRoute | null {
  const shareMatch = requestUrl.pathname.match(/^\/share\/([^/]+)$/);
  if (shareMatch) {
    return { kind: "share", id: decodeURIComponent(shareMatch[1]) };
  }

  const watchMatch = requestUrl.pathname.match(/^\/watch\/([^/]+)$/);
  if (watchMatch) {
    return { kind: "watch", id: decodeURIComponent(watchMatch[1]) };
  }

  return null;
}

async function loadUnfurl(route: UnfurlRoute): Promise<LoadResult> {
  try {
    const convexUrl =
      process.env.CONVEX_URL?.trim() ||
      process.env.VITE_CONVEX_URL?.trim() ||
      PROD_CONVEX_URL;
    const abortController = new AbortController();
    const client = new ConvexHttpClient(convexUrl, {
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: abortController.signal,
      }),
      logger: false,
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const action = route.kind === "share"
      ? client.action(getShareUnfurl, { token: route.id })
      : client.action(getWatchUnfurl, { publicId: route.id });
    const settledAction = action
      .then((value) => ({ status: "ok", value }) as LoadResult)
      .catch(() => ({ status: "failed" }) as LoadResult);
    const timedOut = new Promise<LoadResult>((resolve) => {
      timeout = setTimeout(() => {
        abortController.abort();
        resolve({ status: "failed" });
      }, UNFURL_TIMEOUT_MS);
    });

    try {
      return await Promise.race([settledAction, timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  } catch {
    return { status: "failed" };
  }
}

async function loadShell(request: Request) {
  const shellUrl = new URL("/_shell.html", request.url);
  return await fetch(shellUrl, {
    headers: { accept: "text/html" },
    redirect: "follow",
  });
}

function responseHeaders(shell: Response, cacheable: boolean) {
  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("etag");
  headers.delete("last-modified");
  headers.delete("transfer-encoding");
  if (cacheable) {
    // Share settings and titles can change, so five minutes avoids long-lived
    // privacy staleness. One extra minute keeps repeat unfurls responsive while
    // Vercel refreshes the response in the background.
    headers.set(
      "cache-control",
      "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
    );
  } else {
    headers.set("cache-control", "no-store");
  }
  return headers;
}

export function createUnfurlMiddleware(
  dependencies: UnfurlMiddlewareDependencies = {
    loadShell,
    loadUnfurl,
    next: () => undefined,
    renderHtml: renderUnfurlHtml,
  },
) {
  return async function handleUnfurl(request: Request) {
    try {
      const route = readRoute(new URL(request.url));
      if (!route) return dependencies.next();

      const [shell, result] = await Promise.all([
        dependencies.loadShell(request).catch(() => null),
        dependencies.loadUnfurl(route).catch(() => ({
          status: "failed" as const,
        })),
      ]);
      if (!shell?.ok) return dependencies.next();

      const html = await shell.text().catch(() => null);
      if (html === null) return dependencies.next();

      let body = html;
      let cacheable = false;
      if (result.status === "ok") {
        try {
          body = route.kind === "share"
            ? dependencies.renderHtml(
                html,
                route,
                result.value as ShareUnfurl | null,
              )
            : dependencies.renderHtml(
                html,
                route,
                result.value as WatchUnfurl | null,
              );
          cacheable = true;
        } catch {
          // Rendering metadata is optional. Preserve the shell on any failure.
        }
      }

      return new Response(body, {
        status: shell.status,
        headers: responseHeaders(shell, cacheable),
      });
    } catch {
      // Returning no response continues through Vercel's routing chain, where
      // the catch-all rewrite serves the normal SPA shell.
      return dependencies.next();
    }
  };
}
