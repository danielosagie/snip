import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { ShareUnfurl, WatchUnfurl } from "../src/lib/unfurlSeo";
import {
  renderUnfurlHtml,
  type UnfurlRoute,
} from "../src/lib/unfurlHtml";

const UNFURL_TIMEOUT_MS = 2500;
const PROD_CONVEX_URL = "https://knowing-dogfish-12.convex.cloud";

type LoadResult =
  | { status: "ok"; value: ShareUnfurl | WatchUnfurl | null }
  | { status: "failed" };

type UnfurlHandlerDependencies = {
  loadShell: (request: Request) => Promise<Response>;
  loadUnfurl: (route: UnfurlRoute) => Promise<LoadResult>;
};

function readRoute(requestUrl: URL): UnfurlRoute | null {
  const kind = requestUrl.searchParams.get("kind");
  const id = requestUrl.searchParams.get("id")?.trim();
  if (!id || (kind !== "share" && kind !== "watch")) return null;
  return { kind, id };
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
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const action = route.kind === "share"
      ? client.action(api.videoActions.getShareUnfurl, { token: route.id })
      : client.action(api.videoActions.getWatchUnfurl, { publicId: route.id });
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

export function createUnfurlHandler(
  dependencies: UnfurlHandlerDependencies = { loadShell, loadUnfurl },
) {
  return async function handleUnfurl(request: Request) {
    const route = readRoute(new URL(request.url));
    if (!route) return new Response("Not found", { status: 404 });

    const [shellResult, result] = await Promise.all([
      dependencies.loadShell(request).catch(() => null),
      dependencies.loadUnfurl(route).catch(() => ({ status: "failed" as const })),
    ]);
    if (!shellResult) {
      return new Response("Unable to load application shell", { status: 502 });
    }
    const shell = shellResult;
    if (!shell.ok) return shell;

    const html = await shell.text();
    const body = result.status === "ok"
      ? route.kind === "share"
        ? renderUnfurlHtml(html, route, result.value as ShareUnfurl | null)
        : renderUnfurlHtml(html, route, result.value as WatchUnfurl | null)
      : html;

    return new Response(body, {
      status: shell.status,
      headers: responseHeaders(shell, result.status === "ok"),
    });
  };
}

export const GET = createUnfurlHandler();
