import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { PROJECT_STAGES } from "./types.ts";
import type { OverlayProject, OverlayStore, ProjectStage, WorkbenchMember } from "./types.ts";

export function overlayPath(dataDir: string): string {
  return join(dataDir, "overlay.json");
}

export function emptyOverlay(): OverlayStore {
  return { schemaVersion: 1, members: [], projects: {} };
}

export const MAX_RECENT_WORKSPACES = 8;

/** 把 path 加入最近工作空间列表（MRU，最新在前，去重后截断）。 */
export function pushRecentWorkspace(list: readonly string[], path: string): string[] {
  return [path, ...list.filter((item) => item !== path)].slice(0, MAX_RECENT_WORKSPACES);
}

function decodeStage(value: unknown): ProjectStage | undefined {
  return typeof value === "string" && (PROJECT_STAGES as readonly string[]).includes(value)
    ? value as ProjectStage
    : undefined;
}

function decodeProjectItem(value: unknown): OverlayProject {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const next: OverlayProject = {};
  if (typeof record.title === "string" && record.title !== "") next.title = record.title;
  const stage = decodeStage(record.stage);
  if (stage !== undefined) next.stage = stage;
  if (typeof record.owner === "string" && record.owner !== "") next.owner = record.owner;
  if (typeof record.productLine === "string" && record.productLine !== "") {
    next.productLine = record.productLine;
  }
  if (typeof record.archived === "boolean") next.archived = record.archived;
  return next;
}

function decodeMember(value: unknown): WorkbenchMember | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const uid = typeof record.uid === "string" ? record.uid : "";
  const name = typeof record.name === "string" ? record.name : "";
  if (uid === "" || name === "") return undefined;
  return { uid, name };
}

export function decodeOverlay(value: unknown): OverlayStore {
  if (typeof value !== "object" || value === null) return emptyOverlay();
  const raw = value as Record<string, unknown>;
  const store = emptyOverlay();
  if (typeof raw.workspaceRoot === "string" && raw.workspaceRoot.length > 0) {
    store.workspaceRoot = raw.workspaceRoot;
  }
  if (typeof raw.rules === "string" && raw.rules.trim() !== "") {
    store.rules = raw.rules.trim();
  }
  if (Array.isArray(raw.recentWorkspaces)) {
    store.recentWorkspaces = raw.recentWorkspaces
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .slice(0, MAX_RECENT_WORKSPACES);
  }
  if (Array.isArray(raw.members)) {
    store.members = raw.members
      .map((member) => decodeMember(member))
      .filter((member): member is WorkbenchMember => member !== undefined);
  }
  if (raw.projects !== null && typeof raw.projects === "object") {
    for (const [id, item] of Object.entries(raw.projects as Record<string, unknown>)) {
      const decoded = decodeProjectItem(item);
      if (Object.keys(decoded).length === 0) continue;
      store.projects[id] = decoded;
    }
  }
  return store;
}

export async function loadOverlay(dataDir: string): Promise<OverlayStore> {
  try {
    const raw = await readFile(overlayPath(dataDir), "utf8");
    return decodeOverlay(JSON.parse(raw) as unknown);
  } catch {
    return emptyOverlay();
  }
}

const overlayTails = new Map<string, Promise<void>>();

/** 与 oil-creator 相同：进程内串行锁，避免并发写坏同一个 overlay 文件。 */
export function withOverlayLock<T>(dataDir: string, work: () => Promise<T>): Promise<T> {
  const previous = overlayTails.get(dataDir) ?? Promise.resolve();
  const run = previous.then(work, work);
  overlayTails.set(dataDir, run.then(() => undefined, () => undefined));
  return run;
}

export async function saveOverlay(dataDir: string, store: OverlayStore): Promise<void> {
  const path = overlayPath(dataDir);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temp, path);
}
