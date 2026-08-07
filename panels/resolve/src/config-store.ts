import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PanelConfig, PanelConfigInput, PublicPanelConfig } from "./model";
import { normalizeBranch, normalizeServerUrl } from "./protocol";

function defaultConfigPath(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Snip", "Resolve", "config.json");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || homedir(), "Snip", "Resolve", "config.json");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "snip", "resolve", "config.json");
}

function required(value: string, label: string, maxLength = 200): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

export function publicConfig(config?: PanelConfig): PublicPanelConfig {
  if (!config) {
    return {
      serverUrl: "",
      projectId: "",
      displayName: "",
      branch: "main",
      configured: false,
    };
  }
  return {
    serverUrl: config.serverUrl,
    projectId: config.projectId,
    displayName: config.displayName,
    branch: config.branch,
    configured: true,
    tokenHint: config.pluginToken.slice(-4).padStart(8, "•"),
  };
}

export class PanelConfigStore {
  constructor(private readonly path = defaultConfigPath()) {}

  async load(): Promise<PanelConfig | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<PanelConfig>;
      if (
        typeof parsed.serverUrl !== "string" ||
        typeof parsed.pluginToken !== "string" ||
        typeof parsed.projectId !== "string" ||
        typeof parsed.displayName !== "string" ||
        typeof parsed.branch !== "string"
      ) {
        return undefined;
      }
      return this.validate(parsed as PanelConfig, undefined);
    } catch {
      return undefined;
    }
  }

  async save(input: PanelConfigInput, current?: PanelConfig): Promise<PanelConfig> {
    const config = this.validate(input, current);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
    return config;
  }

  private validate(input: PanelConfigInput, current?: PanelConfig): PanelConfig {
    const token = input.pluginToken?.trim() || current?.pluginToken || "";
    return {
      serverUrl: normalizeServerUrl(required(input.serverUrl, "Server")),
      pluginToken: required(token, "Token", 512),
      projectId: required(input.projectId, "Project ID", 128),
      displayName: required(input.displayName, "Your name", 80),
      branch: normalizeBranch(required(input.branch || "main", "Push branch", 100)),
    };
  }
}
