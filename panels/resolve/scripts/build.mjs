import { cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(projectRoot, "dist", "plugin");
const source = join(projectRoot, "src");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

async function build(entry, target, format, external = []) {
  const result = await Bun.build({
    entrypoints: [join(source, `${entry}.ts`)],
    outdir: output,
    naming: { entry: `${entry}.js` },
    target,
    format,
    external,
    sourcemap: "linked",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Failed to build ${entry}.ts`);
  }
}

await Promise.all([
  build("main", "node", "cjs", ["electron"]),
  build("preload", "node", "cjs", ["electron", "./WorkflowIntegration.node"]),
  build("renderer", "browser", "iife"),
]);

await Promise.all([
  cp(join(projectRoot, "static", "index.html"), join(output, "index.html")),
  cp(join(projectRoot, "static", "styles.css"), join(output, "styles.css")),
  cp(join(projectRoot, "static", "manifest.xml"), join(output, "manifest.xml")),
  cp(join(projectRoot, "static", "package.plugin.json"), join(output, "package.plugin.json")),
]);
await rename(join(output, "package.plugin.json"), join(output, "package.json"));

console.log(`Built ${output}`);
