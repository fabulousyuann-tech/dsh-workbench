import { homedir } from "node:os";
import { join } from "node:path";

import Schema from "@deepseek-ai/schemastery";

export interface Config {
  workspaceRoot: string;
  dataDir: string;
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
  workspaceRoot: Schema.string().default(defaultWorkspaceRoot()),
  dataDir: Schema.string().default(defaultDataDir()),
});

export function resolveDataDir(config: Config): string {
  return config.dataDir === "" ? defaultDataDir() : config.dataDir;
}
