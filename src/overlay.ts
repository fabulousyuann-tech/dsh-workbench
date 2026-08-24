import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

import { PROJECT_STAGES, SPACE_COLORS, SPACE_ICONS } from "./types.ts";
import type {
  AuxiliaryPolicy, LegacyOverlayStore, ModelRouteRef, OverlayProject, OverlayStore,
  ProjectStage, SpaceColor, SpaceIcon, SpaceMigrationStatus, SpacePolicy,
  WorkbenchMember, WorkbenchSpace,
} from "./types.ts";

export const OVERLAY_SCHEMA_VERSION = 2;
export const MAX_RECENT_WORKSPACES = 8;
const PROJECT_KEY_SEPARATOR = "::";

export class OverlayFormatError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message}: ${path}`);
    this.name = "OverlayFormatError";
  }
}

export function overlayPath(dataDir: string): string { return join(dataDir, "overlay.json"); }
export function overlayProjectKey(spaceId: string, projectId: string): string;
export function overlayProjectKey(spaceId: string, customerId: string, projectId: string): string;
export function overlayProjectKey(spaceId: string, customerOrProjectId: string, projectId?: string): string {
  return projectId === undefined
    ? `${spaceId}${PROJECT_KEY_SEPARATOR}${customerOrProjectId}`
    : `${spaceId}${PROJECT_KEY_SEPARATOR}${encodeURIComponent(customerOrProjectId)}${PROJECT_KEY_SEPARATOR}${encodeURIComponent(projectId)}`;
}
export function customerProjectKey(customerId: string, projectId: string): string {
  return `${encodeURIComponent(customerId)}${PROJECT_KEY_SEPARATOR}${encodeURIComponent(projectId)}`;
}
export function projectOverlayOf(store: OverlayStore, spaceId: string): Record<string, OverlayProject> {
  const prefix = `${spaceId}${PROJECT_KEY_SEPARATOR}`;
  return Object.fromEntries(Object.entries(store.projects)
    .filter(([key]) => key.startsWith(prefix) || !key.includes(PROJECT_KEY_SEPARATOR))
    .map(([key, value]) => [key.startsWith(prefix) ? key.slice(prefix.length) : key, value]));
}
export function stableSpaceId(rootPath: string): string {
  return `space-${createHash("sha256").update(rootPath).digest("hex").slice(0, 12)}`;
}
export function newSpaceId(): string { return `space-${randomUUID()}`; }

export async function canonicalizeSpacePath(input: string): Promise<string> {
  const expanded = input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
  if (!isAbsolute(expanded)) throw new Error("Space rootPath must be absolute or start with ~");
  const resolved = normalize(resolve(expanded));
  return realpath(resolved).catch(() => resolved);
}

export function defaultSpacePolicy(): SpacePolicy { return { auxiliary: { mode: "inherit" } }; }
export function makeSpace(rootPath: string, options: Partial<WorkbenchSpace> = {}): WorkbenchSpace {
  const now = new Date().toISOString();
  return {
    id: options.id ?? newSpaceId(), rootPath,
    rootPathHistory: [...new Set(options.rootPathHistory ?? [])].filter((path) => path !== rootPath),
    name: options.name?.trim() || basename(rootPath) || rootPath,
    color: options.color ?? "blue", icon: options.icon ?? "folder",
    order: options.order ?? 0, pinned: options.pinned ?? false,
    hiddenWorkspacePaths: [...(options.hiddenWorkspacePaths ?? [])],
    policy: options.policy ?? defaultSpacePolicy(),
    createdAt: options.createdAt ?? now, updatedAt: options.updatedAt ?? now,
    ...(options.rules === undefined || options.rules.trim() === "" ? {} : { rules: options.rules.trim() }),
  };
}

export function emptyOverlay(rootPath = process.cwd()): OverlayStore {
  const normalized = normalize(resolve(rootPath));
  const id = stableSpaceId(normalized);
  return {
    schemaVersion: 2, defaultSpaceId: id, selectedSpaceId: id,
    spaces: { [id]: makeSpace(normalized, { id }) }, members: [], projects: {},
    migration: { state: "not-needed" },
  };
}

/** Legacy helper retained for source compatibility; Space ordering supersedes MRU. */
export function pushRecentWorkspace(list: readonly string[], path: string): string[] {
  return [path, ...list.filter((item) => item !== path)].slice(0, MAX_RECENT_WORKSPACES);
}

function decodeStage(value: unknown): ProjectStage | undefined {
  return typeof value === "string" && (PROJECT_STAGES as readonly string[]).includes(value)
    ? value as ProjectStage : undefined;
}
function decodeProjectItem(value: unknown): OverlayProject {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const next: OverlayProject = {};
  if (typeof record.title === "string" && record.title !== "") next.title = record.title;
  const stage = decodeStage(record.stage); if (stage !== undefined) next.stage = stage;
  if (typeof record.owner === "string" && record.owner !== "") next.owner = record.owner;
  if (typeof record.productLine === "string" && record.productLine !== "") next.productLine = record.productLine;
  if (typeof record.archived === "boolean") next.archived = record.archived;
  return next;
}
function decodeMember(value: unknown): WorkbenchMember | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const uid = typeof record.uid === "string" ? record.uid : "";
  const name = typeof record.name === "string" ? record.name : "";
  return uid === "" || name === "" ? undefined : { uid, name };
}
function decodeMembers(value: unknown): WorkbenchMember[] {
  return Array.isArray(value) ? value.map(decodeMember).filter((item): item is WorkbenchMember => item !== undefined) : [];
}
function decodeProjects(value: unknown): Record<string, OverlayProject> {
  const result: Record<string, OverlayProject> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return result;
  for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
    const decoded = decodeProjectItem(item); if (Object.keys(decoded).length > 0) result[id] = decoded;
  }
  return result;
}
function decodeRoute(value: unknown): ModelRouteRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.provider !== "string" || raw.provider === "" || typeof raw.model !== "string" || raw.model === "") return undefined;
  return { provider: raw.provider, model: raw.model,
    ...(typeof raw.reasoningEffort === "string" && raw.reasoningEffort !== "" ? { reasoningEffort: raw.reasoningEffort } : {}) };
}
function decodeAuxiliary(value: unknown): AuxiliaryPolicy {
  if (typeof value !== "object" || value === null) return { mode: "inherit" };
  const raw = value as Record<string, unknown>;
  const mode = raw.mode === "override" || raw.mode === "disabled" ? raw.mode : "inherit";
  return { mode,
    ...(typeof raw.visionRouteId === "string" && raw.visionRouteId !== "" ? { visionRouteId: raw.visionRouteId } : {}),
    ...(typeof raw.imageGenerationRouteId === "string" && raw.imageGenerationRouteId !== "" ? { imageGenerationRouteId: raw.imageGenerationRouteId } : {}) };
}
function decodePolicy(value: unknown): SpacePolicy {
  const raw = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const model = decodeRoute(raw.model);
  return { ...(model === undefined ? {} : { model }),
    ...(typeof raw.agentPreset === "string" && raw.agentPreset !== "" ? { agentPreset: raw.agentPreset } : {}),
    ...(typeof raw.permissionPreset === "string" && raw.permissionPreset !== "" ? { permissionPreset: raw.permissionPreset } : {}),
    auxiliary: decodeAuxiliary(raw.auxiliary) };
}
function isColor(value: unknown): value is SpaceColor {
  return typeof value === "string" && (SPACE_COLORS as readonly string[]).includes(value);
}
function isIcon(value: unknown): value is SpaceIcon {
  return typeof value === "string" && (SPACE_ICONS as readonly string[]).includes(value);
}
function decodeSpace(id: string, value: unknown): WorkbenchSpace | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.rootPath !== "string" || !isAbsolute(raw.rootPath)) return undefined;
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();
  return makeSpace(normalize(raw.rootPath), {
    id, name: typeof raw.name === "string" ? raw.name : basename(raw.rootPath),
    color: isColor(raw.color) ? raw.color : "blue", icon: isIcon(raw.icon) ? raw.icon : "folder",
    order: typeof raw.order === "number" && Number.isInteger(raw.order) ? raw.order : 0,
    pinned: raw.pinned === true,
    ...(typeof raw.rules === "string" ? { rules: raw.rules } : {}),
    hiddenWorkspacePaths: Array.isArray(raw.hiddenWorkspacePaths)
      ? [...new Set(raw.hiddenWorkspacePaths.filter((item): item is string => typeof item === "string" && isAbsolute(item)))] : [],
    rootPathHistory: Array.isArray(raw.rootPathHistory)
      ? [...new Set(raw.rootPathHistory.filter((item): item is string => typeof item === "string" && isAbsolute(item)).map((item) => normalize(item)))] : [],
    policy: decodePolicy(raw.policy), createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt,
  });
}
function decodeMigration(value: unknown): SpaceMigrationStatus | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.state !== "not-needed" && raw.state !== "completed" && raw.state !== "failed") return undefined;
  return { state: raw.state, ...(raw.fromVersion === 1 ? { fromVersion: 1 } : {}),
    ...(typeof raw.migratedAt === "string" ? { migratedAt: raw.migratedAt } : {}),
    ...(typeof raw.backupPath === "string" ? { backupPath: raw.backupPath } : {}),
    ...(typeof raw.message === "string" ? { message: raw.message } : {}) };
}

export function decodeOverlay(value: unknown): OverlayStore {
  if (typeof value !== "object" || value === null) throw new Error("overlay root must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 2) throw new Error(`unsupported overlay schemaVersion: ${String(raw.schemaVersion)}`);
  if (typeof raw.spaces !== "object" || raw.spaces === null || Array.isArray(raw.spaces)) throw new Error("overlay spaces must be an object");
  const spaces: Record<string, WorkbenchSpace> = {};
  for (const [id, item] of Object.entries(raw.spaces as Record<string, unknown>)) {
    const decoded = decodeSpace(id, item); if (decoded !== undefined) spaces[id] = decoded;
  }
  const ids = Object.keys(spaces); if (ids.length === 0) throw new Error("overlay must contain at least one valid Space");
  const defaultSpaceId = typeof raw.defaultSpaceId === "string" && spaces[raw.defaultSpaceId] !== undefined ? raw.defaultSpaceId : ids[0]!;
  const selectedSpaceId = typeof raw.selectedSpaceId === "string" && spaces[raw.selectedSpaceId] !== undefined ? raw.selectedSpaceId : defaultSpaceId;
  return { schemaVersion: 2, defaultSpaceId, selectedSpaceId, spaces,
    members: decodeMembers(raw.members), projects: decodeProjects(raw.projects),
    migration: decodeMigration(raw.migration) ?? { state: "not-needed" } };
}

export function decodeLegacyOverlay(value: unknown): LegacyOverlayStore {
  if (typeof value !== "object" || value === null) throw new Error("legacy overlay root must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) throw new Error(`unsupported overlay schemaVersion: ${String(raw.schemaVersion)}`);
  return { schemaVersion: 1,
    ...(typeof raw.workspaceRoot === "string" && raw.workspaceRoot !== "" ? { workspaceRoot: raw.workspaceRoot } : {}),
    ...(typeof raw.rules === "string" && raw.rules.trim() !== "" ? { rules: raw.rules.trim() } : {}),
    members: decodeMembers(raw.members), projects: decodeProjects(raw.projects),
    ...(Array.isArray(raw.recentWorkspaces) ? { recentWorkspaces: raw.recentWorkspaces.filter((item): item is string => typeof item === "string" && item !== "").slice(0, MAX_RECENT_WORKSPACES) } : {}),
    ...(Array.isArray(raw.hiddenWorkspaces) ? { hiddenWorkspaces: [...new Set(raw.hiddenWorkspaces.filter((item): item is string => typeof item === "string" && item !== ""))] } : {}) };
}

async function isDirectory(path: string): Promise<boolean> { return stat(path).then((item) => item.isDirectory(), () => false); }
function pathInside(path: string, root: string): boolean { return path === root || path.startsWith(`${root}/`); }

export async function migrateLegacyOverlay(legacy: LegacyOverlayStore, fallbackRoot: string, backupPath?: string): Promise<OverlayStore> {
  const legacyPrimaryRoot = normalize(resolve(legacy.workspaceRoot ?? fallbackRoot));
  const primaryRoot = await canonicalizeSpacePath(legacyPrimaryRoot);
  const candidates: Array<{ rootPath: string; legacyRoot: string }> = [{ rootPath: primaryRoot, legacyRoot: legacyPrimaryRoot }];
  for (const path of legacy.recentWorkspaces ?? []) {
    const normalized = await canonicalizeSpacePath(path).catch(() => undefined);
    if (normalized !== undefined && !candidates.some((item) => item.rootPath === normalized) && await isDirectory(normalized)) {
      candidates.push({ rootPath: normalized, legacyRoot: normalize(resolve(path)) });
    }
  }
  const now = new Date().toISOString(); const spaces: Record<string, WorkbenchSpace> = {};
  candidates.forEach(({ rootPath, legacyRoot }, index) => {
    const id = stableSpaceId(rootPath);
    const hiddenWorkspacePaths = (legacy.hiddenWorkspaces ?? [])
      .filter((path) => pathInside(normalize(resolve(path)), legacyRoot))
      .map((path) => join(rootPath, relative(legacyRoot, normalize(resolve(path)))));
    spaces[id] = makeSpace(rootPath, { id, order: index,
      ...(index === 0 && legacy.rules !== undefined ? { rules: legacy.rules } : {}),
      hiddenWorkspacePaths,
      createdAt: now, updatedAt: now });
  });
  const defaultSpaceId = stableSpaceId(primaryRoot);
  return { schemaVersion: 2, defaultSpaceId, selectedSpaceId: defaultSpaceId, spaces,
    members: legacy.members,
    projects: Object.fromEntries(Object.entries(legacy.projects).map(([id, item]) => [overlayProjectKey(defaultSpaceId, id), item])),
    migration: { state: "completed", fromVersion: 1, migratedAt: now, ...(backupPath === undefined ? {} : { backupPath }) } };
}

export async function loadOverlay(dataDir: string, fallbackRoot = process.cwd()): Promise<OverlayStore> {
  const path = overlayPath(dataDir); let rawText: string;
  try { rawText = await readFile(path, "utf8"); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return emptyOverlay(await canonicalizeSpacePath(fallbackRoot));
    throw cause;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(rawText) as unknown; }
  catch { throw new OverlayFormatError("overlay contains invalid JSON; it was left unchanged", path); }
  if (typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).schemaVersion === 2) {
    try { return decodeOverlay(parsed); }
    catch (cause) { throw new OverlayFormatError(cause instanceof Error ? cause.message : "invalid overlay", path); }
  }
  let legacy: LegacyOverlayStore;
  try { legacy = decodeLegacyOverlay(parsed); }
  catch (cause) { throw new OverlayFormatError(cause instanceof Error ? cause.message : "invalid legacy overlay", path); }
  const backupPath = join(dataDir, `overlay.v1.${Date.now()}.backup.json`);
  const migrated = await migrateLegacyOverlay(legacy, fallbackRoot, backupPath);
  await mkdir(dataDir, { recursive: true });
  await writeFile(backupPath, rawText, { encoding: "utf8", flag: "wx" });
  try { await saveOverlay(dataDir, migrated); }
  catch (cause) { throw new OverlayFormatError(`migration write failed (${cause instanceof Error ? cause.message : String(cause)}); legacy file was left unchanged`, path); }
  return migrated;
}

const overlayTails = new Map<string, Promise<void>>();
export function withOverlayLock<T>(dataDir: string, work: () => Promise<T>): Promise<T> {
  const previous = overlayTails.get(dataDir) ?? Promise.resolve(); const run = previous.then(work, work);
  overlayTails.set(dataDir, run.then(() => undefined, () => undefined)); return run;
}
export async function saveOverlay(dataDir: string, store: OverlayStore): Promise<void> {
  const path = overlayPath(dataDir); await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8"); await rename(temp, path);
}

/** Explicit rollback helper: validate a v1 backup, then atomically restore it for a fresh migration attempt. */
export async function restoreOverlayBackup(dataDir: string, backupPath: string): Promise<void> {
  const raw = await readFile(backupPath, "utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { throw new OverlayFormatError("backup contains invalid JSON", backupPath); }
  decodeLegacyOverlay(parsed);
  const path = overlayPath(dataDir); const temp = `${path}.${process.pid}.${Date.now()}.restore.tmp`;
  await writeFile(temp, raw, "utf8"); await rename(temp, path);
}
