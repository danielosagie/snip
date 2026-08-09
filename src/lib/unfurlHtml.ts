import type { ShareUnfurl, WatchUnfurl } from "./unfurlSeo.js";
import { shareUnfurlHead, watchUnfurlHead } from "./unfurlSeo.js";

export type UnfurlRoute =
  | { kind: "share"; id: string }
  | { kind: "watch"; id: string };

type SeoHead = ReturnType<typeof shareUnfurlHead>;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readAttributes(tag: string) {
  const attributes = new Map<string, string>();
  const pattern = /([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(
      match[1].toLowerCase(),
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }
  return attributes;
}

function renderMeta(meta: Record<string, string>) {
  if (meta.title !== undefined) {
    return `<title>${escapeHtml(meta.title)}</title>`;
  }
  const attributes = Object.entries(meta)
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
    .join(" ");
  return `<meta ${attributes}>`;
}

function renderLink(link: Record<string, string>) {
  const attributes = Object.entries(link)
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
    .join(" ");
  return `<link ${attributes}>`;
}

function descriptorKey(record: Record<string, string>) {
  for (const name of ["name", "property", "httpEquiv", "charSet"]) {
    if (record[name] !== undefined) {
      return `${name.toLowerCase()}\0${record[name].toLowerCase()}`;
    }
  }
  return null;
}

export function injectSeoHead(html: string, head: SeoHead) {
  if (!/<\/head>/i.test(html)) return html;

  const metaKeys = new Set(
    head.meta
      .map(descriptorKey)
      .filter((key): key is string => key !== null),
  );
  const linkKeys = new Set(
    head.links
      .map((link) => `rel\0${link.rel.toLowerCase()}`),
  );

  const withoutOldHead = html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\b[^>]*>/gi, (tag) => {
      const attributes = readAttributes(tag);
      for (const name of ["name", "property", "httpequiv", "charset"]) {
        const value = attributes.get(name);
        if (value && metaKeys.has(`${name}\0${value.toLowerCase()}`)) return "";
      }
      return tag;
    })
    .replace(/<link\b[^>]*>/gi, (tag) => {
      const attributes = readAttributes(tag);
      const rel = attributes.get("rel");
      return rel && linkKeys.has(`rel\0${rel.toLowerCase()}`) ? "" : tag;
    });

  const tags = [
    ...head.meta.map(renderMeta),
    ...head.links.map(renderLink),
  ].join("\n");
  return withoutOldHead.replace(/<\/head>/i, `${tags}\n</head>`);
}

export function renderUnfurlHtml(
  html: string,
  route: { kind: "share"; id: string },
  unfurl: ShareUnfurl | null,
): string;
export function renderUnfurlHtml(
  html: string,
  route: { kind: "watch"; id: string },
  unfurl: WatchUnfurl | null,
): string;
export function renderUnfurlHtml(
  html: string,
  route: UnfurlRoute,
  unfurl: ShareUnfurl | WatchUnfurl | null,
) {
  // A null result is the privacy gate as well as the not-found result. The
  // original shell must stay bare so protected media is never disclosed.
  if (!unfurl) return html;
  const head = route.kind === "share"
    ? shareUnfurlHead(route.id, unfurl as ShareUnfurl)
    : watchUnfurlHead(route.id, unfurl as WatchUnfurl);
  return injectSeoHead(html, head);
}
