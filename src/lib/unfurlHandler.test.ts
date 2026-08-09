import assert from "node:assert/strict";
import test from "node:test";
import { createUnfurlMiddleware } from "./unfurlMiddleware.js";

const bareShell = "<!doctype html><html><head><meta property=\"og:site_name\" content=\"snip\"></head><body></body></html>";

test("gated action result returns the unchanged shell with shared caching", async () => {
  const handler = createUnfurlMiddleware({
    loadShell: async () => new Response(bareShell),
    loadUnfurl: async () => ({ status: "ok", value: null }),
    next: () => undefined,
    renderHtml: (await import("./unfurlHtml.js")).renderUnfurlHtml,
  });

  const response = await handler(new Request(
    "https://snip.film/share/gated-token",
  ));
  assert.ok(response);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(html, bareShell);
  assert.doesNotMatch(html, /og:title/);
  assert.doesNotMatch(html, /og:image/);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
  );
});

test("action failure falls through to the shell and is not cached", async () => {
  const handler = createUnfurlMiddleware({
    loadShell: async () => new Response(bareShell),
    loadUnfurl: async () => ({ status: "failed" }),
    next: () => undefined,
    renderHtml: (await import("./unfurlHtml.js")).renderUnfurlHtml,
  });

  const response = await handler(new Request(
    "https://snip.film/watch/slow-video",
  ));

  assert.ok(response);
  assert.equal(await response.text(), bareShell);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("middleware continues for requests outside the two routed shapes", async () => {
  const continued = new Response(bareShell);
  const handler = createUnfurlMiddleware({
    loadShell: async () => new Response(bareShell),
    loadUnfurl: async () => ({ status: "failed" }),
    next: () => continued,
    renderHtml: (await import("./unfurlHtml.js")).renderUnfurlHtml,
  });

  const response = await handler(new Request(
    "https://snip.film/dashboard/private",
  ));

  assert.equal(response, continued);
});

test("shell failure continues to the normal SPA response", async () => {
  const continued = new Response(bareShell, { status: 200 });
  const handler = createUnfurlMiddleware({
    loadShell: async () => {
      throw new Error("shell unavailable");
    },
    loadUnfurl: async () => ({ status: "failed" }),
    next: () => continued,
    renderHtml: (await import("./unfurlHtml.js")).renderUnfurlHtml,
  });

  const response = await handler(new Request(
    "https://snip.film/share/any-token",
  ));

  assert.equal(response, continued);
  assert.equal(response?.status, 200);
});

test("metadata rendering failure returns the bare shell without caching", async () => {
  const handler = createUnfurlMiddleware({
    loadShell: async () => new Response(bareShell),
    loadUnfurl: async () => ({
      status: "ok",
      value: {
        kind: "video",
        title: "Visible title",
        description: null,
        image: null,
        watermarked: true,
        video: null,
      },
    }),
    next: () => undefined,
    renderHtml: () => {
      throw new Error("renderer failed");
    },
  });

  const response = await handler(new Request(
    "https://snip.film/share/any-token",
  ));

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), bareShell);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
