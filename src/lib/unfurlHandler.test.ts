import assert from "node:assert/strict";
import test from "node:test";
import { createUnfurlHandler } from "../../api/unfurl";

const bareShell = "<!doctype html><html><head><meta property=\"og:site_name\" content=\"snip\"></head><body></body></html>";

test("gated action result returns the unchanged shell with shared caching", async () => {
  const handler = createUnfurlHandler({
    loadShell: async () => new Response(bareShell),
    loadUnfurl: async () => ({ status: "ok", value: null }),
  });

  const response = await handler(new Request(
    "https://snip.film/api/unfurl?kind=share&id=gated-token",
  ));
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
  const handler = createUnfurlHandler({
    loadShell: async () => new Response(bareShell),
    loadUnfurl: async () => ({ status: "failed" }),
  });

  const response = await handler(new Request(
    "https://snip.film/api/unfurl?kind=watch&id=slow-video",
  ));

  assert.equal(await response.text(), bareShell);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("unfurl function rejects requests outside the two routed shapes", async () => {
  const handler = createUnfurlHandler({
    loadShell: async () => new Response(bareShell),
    loadUnfurl: async () => ({ status: "failed" }),
  });

  const response = await handler(new Request(
    "https://snip.film/api/unfurl?kind=dashboard&id=private",
  ));

  assert.equal(response.status, 404);
});
