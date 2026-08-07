import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const build = join(projectRoot, "dist", "plugin");

let pluginRoot;
let nativeModule;
if (process.platform === "darwin") {
  const resolveRoot = "/Library/Application Support/Blackmagic Design/DaVinci Resolve";
  pluginRoot = join(resolveRoot, "Workflow Integration Plugins");
  nativeModule = join(
    resolveRoot,
    "Developer",
    "Workflow Integrations",
    "Examples",
    "SamplePlugin",
    "WorkflowIntegration.node",
  );
} else if (process.platform === "win32") {
  const programData = process.env.PROGRAMDATA || "C:\\ProgramData";
  const resolveRoot = join(programData, "Blackmagic Design", "DaVinci Resolve", "Support");
  pluginRoot = join(resolveRoot, "Workflow Integration Plugins");
  nativeModule = join(
    resolveRoot,
    "Developer",
    "Workflow Integrations",
    "Examples",
    "SamplePlugin",
    "WorkflowIntegration.node",
  );
} else {
  throw new Error("Resolve Workflow Integration plugins support macOS and Windows.");
}

const destination = join(pluginRoot, "com.snip.resolve.panel");
try {
  await mkdir(destination, { recursive: true });
  await cp(build, destination, { recursive: true, force: true });
  await cp(nativeModule, join(destination, "WorkflowIntegration.node"), { force: true });
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EACCES") {
    throw new Error("Install needs permission for Resolve's system plugin folder.");
  }
  throw error;
}

console.log(`Installed ${destination}`);
