import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(projectRoot, "dist", "plugin");
const port = Number(process.env.PANEL_PREVIEW_PORT || 4173);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(root, safe));
      return new Response(body, {
        headers: { "content-type": contentTypes[extname(safe)] || "application/octet-stream" },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
});

console.log(`Resolve panel preview: ${server.url}`);
