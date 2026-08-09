import assert from "node:assert/strict";
import test from "node:test";
import { renderUnfurlHtml } from "@/lib/unfurlHtml";

const shell = `<!doctype html><html><head>
<meta charset="utf-8">
<title>snip shell</title>
<meta name="description" content="shell description">
<meta property="og:site_name" content="snip">
</head><body><div id="root"></div></body></html>`;

test("share unfurl injects the shared seo shape into initial HTML", () => {
  const html = renderUnfurlHtml(
    shell,
    { kind: "share", id: "real-looking-token" },
    {
      kind: "video",
      title: "Client & launch",
      description: null,
      image: "https://image.mux.com/preview/thumbnail.jpg?token=signed",
      watermarked: true,
      video: null,
    },
  );

  assert.match(html, /<title>Client &amp; launch \| snip<\/title>/);
  assert.match(html, /property="og:title" content="Client &amp; launch \| snip"/);
  assert.match(html, /property="og:image" content="https:\/\/image\.mux\.com\/preview\/thumbnail\.jpg\?token=signed"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /property="og:url" content="https:\/\/snip\.film\/share\/real-looking-token"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:image" content="https:\/\/image\.mux\.com\/preview\/thumbnail\.jpg\?token=signed"/);
  assert.doesNotMatch(html, /shell description/);
  assert.equal((html.match(/property="og:site_name"/g) ?? []).length, 1);
});

test("privacy-gated share stays byte-identical and has no title or image", () => {
  const bareShell = "<!doctype html><html><head><meta property=\"og:site_name\" content=\"snip\"></head><body></body></html>";
  const html = renderUnfurlHtml(
    bareShell,
    { kind: "share", id: "gated-token" },
    null,
  );

  assert.equal(html, bareShell);
  assert.doesNotMatch(html, /og:title/);
  assert.doesNotMatch(html, /og:image/);
});

test("watch unfurl rejects a non-HTTPS image and uses the public default", () => {
  const html = renderUnfurlHtml(
    shell,
    { kind: "watch", id: "public-video" },
    {
      title: "Public reel",
      description: "Watch the reel",
      image: "http://private.example/cover.jpg",
      video: null,
    },
  );

  assert.match(html, /property="og:image" content="https:\/\/snip\.film\/og\/default\.png"/);
  assert.doesNotMatch(html, /private\.example/);
  assert.match(html, /property="og:url" content="https:\/\/snip\.film\/watch\/public-video"/);
});
