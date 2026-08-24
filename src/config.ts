import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import Schema from "@deepseek-ai/schemastery";

export interface Config {
  workspaceRoot: string;
  dataDir: string;
  sidebarTitle?: string;
}

export function defaultWorkspaceRoot(platform: NodeJS.Platform = process.platform): string {
  const docs = platform === "darwin" ? "Documents" : "Documents";
  return join(homedir(), docs, "工作空间");
}

export function defaultDataDir(): string {
  return join(homedir(), ".dsh-workbench");
}

function joinUnderHome(home: string, rest: string): string {
  return join(home, ...rest.replaceAll("\\", "/").split("/").filter(Boolean));
}

export function expandHomePath(path: string, home = homedir()): string {
  const trimmed = path.trim();
  if (trimmed === "~" || trimmed === "%USERPROFILE%" || trimmed === "%HOME%") return home;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return joinUnderHome(home, trimmed.slice(2));
  const windowsHome = /^%(?:USERPROFILE|HOME)%([\\/].*)?$/i.exec(trimmed);
  if (windowsHome !== null) {
    const rest = windowsHome[1];
    return rest === undefined || rest === "" ? home : joinUnderHome(home, rest);
  }
  return trimmed;
}

export const Config: Schema<Config> = Schema.object({
  workspaceRoot: Schema.string().min(1).default(defaultWorkspaceRoot()),
  dataDir: Schema.string().min(1).default(defaultDataDir()),
  sidebarTitle: Schema.string().min(1).default("DSH"),
});

export function resolveDataDir(config: Config): string {
  return config.dataDir === "" ? defaultDataDir() : config.dataDir;
}

export function resolveConfiguredPath(field: keyof Config, value: string): string {
  const expanded = expandHomePath(value);
  if (!isAbsolute(expanded)) {
    throw new TypeError(`dsh-workbench: ${field} must be an absolute path or start with ~`);
  }
  return expanded;
}

export function validateConfig(config: Config): void {
  resolveConfiguredPath("workspaceRoot", config.workspaceRoot);
  resolveConfiguredPath("dataDir", resolveDataDir(config));
}
