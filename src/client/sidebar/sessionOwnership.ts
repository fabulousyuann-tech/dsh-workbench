import type {
  PendingInteractionStatus,
  SessionId,
  SessionListState,
  WorkspaceId,
  WorkspaceView,
} from "../dshCompatibility.ts";

export interface SidebarSession {
  id: SessionId;
  title: string;
  blank: boolean;
  running: boolean;
  completed: boolean;
  updatedAt: number;
  current: boolean;
}

export interface SessionOwnerTarget {
  id: string;
  path: string;
  kind: "customer" | "project";
}

export interface WorkbenchSessionPartition {
  root: SidebarSession[];
  byTargetId: Record<string, SidebarSession[]>;
}

export interface BasicSessionProject {
  workspaceId: WorkspaceId;
  title: string;
  path: string;
  sessions: SidebarSession[];
}

export interface BasicSessionPartition {
  loose: SidebarSession[];
  projects: BasicSessionProject[];
}

export interface WorkbenchRootDescriptor {
  id: string;
  rootPath: string;
  rootPathHistory?: readonly string[];
}

export interface ActiveSpaceDescriptor extends WorkbenchRootDescriptor {
  name: string;
}

export type ActiveSessionState = "pending" | "running" | "completed";

export interface ActiveSidebarSession extends SidebarSession {
  activity: ActiveSessionState;
  pendingInteraction?: PendingInteractionStatus;
  ownerLabel: string;
  spaceId?: string;
}

export function normalizeDirectoryPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized === "" && value.startsWith("/") ? "/" : normalized;
}

export function isPathInside(path: string | undefined, root: string): boolean {
  if (path === undefined || path === "" || root === "") return false;
  const candidate = normalizeDirectoryPath(path);
  const parent = normalizeDirectoryPath(root);
  if (candidate === parent) return true;
  return parent === "/" ? candidate.startsWith("/") : candidate.startsWith(`${parent}/`);
}

function pathBasename(path: string): string {
  return normalizeDirectoryPath(path).split("/").filter(Boolean).at(-1) ?? "";
}

/**
 * Recover root paths moved before Workbench began recording rootPathHistory.
 * The current root's last directory name must be unique across all spaces and
 * appear as an exact path segment in a historical session cwd.
 */
export function inferLegacyRootAliases(
  spaces: readonly WorkbenchRootDescriptor[],
  sessionDirectories: readonly (string | undefined)[],
): Record<string, string[]> {
  const result: Record<string, string[]> = Object.fromEntries(spaces.map((space) => [space.id, []]));
  const currentRoots = spaces.map((space) => normalizeDirectoryPath(space.rootPath));
  const basenameCounts = new Map<string, number>();
  for (const root of currentRoots) {
    const basename = pathBasename(root);
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  for (const space of spaces) {
    const currentRoot = normalizeDirectoryPath(space.rootPath);
    const aliases = new Set(
      (space.rootPathHistory ?? [])
        .map(normalizeDirectoryPath)
        .filter((path) => path !== "" && path !== currentRoot),
    );
    const basename = pathBasename(currentRoot);
    if (basename !== "" && basenameCounts.get(basename) === 1) {
      for (const rawDirectory of sessionDirectories) {
        if (rawDirectory === undefined || rawDirectory === "") continue;
        const directory = normalizeDirectoryPath(rawDirectory);
        if (currentRoots.some((root) => isPathInside(directory, root))) continue;
        const segments = directory.split("/");
        const index = segments.lastIndexOf(basename);
        if (index < 0) continue;
        const candidate = segments.slice(0, index + 1).join("/");
        if (candidate === "" || candidate === currentRoot) continue;
        aliases.add(candidate);
      }
    }
    result[space.id] = [...aliases];
  }
  return result;
}

/** Map a session cwd under an old root onto the selected space's current root. */
export function rebaseDirectoryFromAliases(
  directory: string | undefined,
  currentRoot: string,
  aliases: readonly string[],
): string | undefined {
  if (directory === undefined || directory === "") return undefined;
  const normalizedDirectory = normalizeDirectoryPath(directory);
  const normalizedRoot = normalizeDirectoryPath(currentRoot);
  if (isPathInside(normalizedDirectory, normalizedRoot)) return normalizedDirectory;
  const matchingAlias = aliases
    .map(normalizeDirectoryPath)
    .filter((alias) => isPathInside(normalizedDirectory, alias))
    .sort((left, right) => right.length - left.length)[0];
  if (matchingAlias === undefined) return undefined;
  return `${normalizedRoot}${normalizedDirectory.slice(matchingAlias.length)}`;
}

function visibleSessions(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
): SidebarSession[] {
  const archived = new Set(archivedSessionIds);
  return list.ids
    .map((id) => list.byId[id])
    .filter((summary) => summary !== undefined)
    .filter((summary) => !archived.has(summary.id))
    .filter((summary) => summary.origin !== "subagent" && summary.parentId === undefined)
    .filter((summary) => !summary.blank || summary.id === list.current)
    .map((summary) => ({
      id: summary.id,
      title: summary.displayTitle,
      blank: summary.blank,
      running: summary.running,
      completed: summary.completed === true,
      updatedAt: summary.updatedAt,
      current: summary.id === list.current,
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function workspacePathBySession(workspaces: readonly WorkspaceView[]): Map<SessionId, string> {
  const result = new Map<SessionId, string>();
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) result.set(id, workspace.path);
  }
  return result;
}

function workspaceBySession(workspaces: readonly WorkspaceView[]): Map<SessionId, WorkspaceView> {
  const result = new Map<SessionId, WorkspaceView>();
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) result.set(id, workspace);
  }
  return result;
}

function activeOwner(
  directory: string | undefined,
  workspace: WorkspaceView | undefined,
  spaces: readonly ActiveSpaceDescriptor[],
  aliasesBySpace: Readonly<Record<string, readonly string[]>>,
): { label: string; spaceId?: string } {
  const normalizedDirectory = directory === undefined ? undefined : normalizeDirectoryPath(directory);
  const candidates = spaces.flatMap((space) => [space.rootPath, ...(aliasesBySpace[space.id] ?? [])]
    .map((root) => ({ space, root: normalizeDirectoryPath(root) })))
    .filter((candidate) => isPathInside(normalizedDirectory, candidate.root))
    .sort((left, right) => right.root.length - left.root.length);
  const match = candidates[0];
  if (match !== undefined) {
    const relative = normalizedDirectory?.slice(match.root.length).replace(/^\/+|\/+$/gu, "") ?? "";
    const relativeLabel = workspace?.title.trim() || relative.split("/").filter(Boolean).slice(-2).join(" / ");
    return {
      label: relativeLabel === "" || relativeLabel === match.space.name
        ? match.space.name
        : `${match.space.name} / ${relativeLabel}`,
      spaceId: match.space.id,
    };
  }
  if (workspace !== undefined) return { label: workspace.title };
  return { label: "" };
}

/**
 * Flatten live DSH attention signals across ordinary projects and every
 * Workbench. `completed` is the native unread-completion reminder and clears
 * when the user opens that Session, so this view owns no parallel status store.
 */
export function deriveActiveSessions(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  spaces: readonly ActiveSpaceDescriptor[],
  aliasesBySpace: Readonly<Record<string, readonly string[]>>,
): ActiveSidebarSession[] {
  const ownerBySession = workspaceBySession(workspaces);
  const rank: Record<ActiveSessionState, number> = { pending: 0, running: 1, completed: 2 };
  return visibleSessions(list, archivedSessionIds)
    .flatMap((session): ActiveSidebarSession[] => {
      const summary = list.byId[session.id];
      if (summary === undefined) return [];
      const activity: ActiveSessionState | undefined = summary.pendingInteraction !== undefined
        ? "pending"
        : summary.running
          ? "running"
          : summary.completed === true
            ? "completed"
            : undefined;
      if (activity === undefined) return [];
      const workspace = ownerBySession.get(session.id);
      const owner = activeOwner(workspace?.path ?? summary.cwd, workspace, spaces, aliasesBySpace);
      return [{
        ...session,
        activity,
        ...(summary.pendingInteraction === undefined ? {} : { pendingInteraction: summary.pendingInteraction }),
        ownerLabel: owner.label,
        ...(owner.spaceId === undefined ? {} : { spaceId: owner.spaceId }),
      }];
    })
    .sort((left, right) => rank[left.activity] - rank[right.activity] || right.updatedAt - left.updatedAt);
}

export function deriveUnmanagedSessions(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  managedRootPaths: readonly string[],
): SidebarSession[] {
  const pathBySession = workspacePathBySession(workspaces);
  return visibleSessions(list, archivedSessionIds).filter((session) => {
    const summary = list.byId[session.id];
    const directory = pathBySession.get(session.id) ?? summary?.cwd;
    return !managedRootPaths.some((root) => isPathInside(directory, root));
  });
}

/**
 * Ordinary DSH Workspaces are lightweight projects inside the Chats context.
 * Only sessions that have no unmanaged Workspace owner stay in Recent Chats;
 * Workbench-owned directories remain excluded from both branches.
 */
export function deriveBasicSessionPartition(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  managedRootPaths: readonly string[],
): BasicSessionPartition {
  const unmanagedWorkspaces = workspaces.filter(
    (workspace) => !managedRootPaths.some((root) => isPathInside(workspace.path, root)),
  );
  const projectBySession = new Map<SessionId, WorkspaceView>();
  for (const workspace of unmanagedWorkspaces) {
    for (const sessionId of workspace.sessionIds) projectBySession.set(sessionId, workspace);
  }

  const sessionsByWorkspace = new Map<WorkspaceId, SidebarSession[]>();
  for (const workspace of unmanagedWorkspaces) sessionsByWorkspace.set(workspace.workspaceId, []);
  const loose: SidebarSession[] = [];
  for (const session of visibleSessions(list, archivedSessionIds)) {
    const owner = projectBySession.get(session.id);
    const directory = owner?.path ?? list.byId[session.id]?.cwd;
    if (managedRootPaths.some((root) => isPathInside(directory, root))) continue;
    if (owner === undefined) loose.push(session);
    else sessionsByWorkspace.get(owner.workspaceId)?.push(session);
  }

  return {
    loose,
    projects: unmanagedWorkspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      title: workspace.title,
      path: workspace.path,
      sessions: sessionsByWorkspace.get(workspace.workspaceId) ?? [],
    })),
  };
}

export function deriveWorkbenchSessions(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  selectedRootPath: string | undefined,
  selectedRootAliases: readonly string[],
  targets: readonly SessionOwnerTarget[],
): WorkbenchSessionPartition {
  const result: WorkbenchSessionPartition = { root: [], byTargetId: {} };
  for (const target of targets) result.byTargetId[target.id] = [];
  if (selectedRootPath === undefined) return result;

  const pathBySession = workspacePathBySession(workspaces);
  const orderedTargets = [...targets].sort(
    (left, right) => normalizeDirectoryPath(right.path).length - normalizeDirectoryPath(left.path).length,
  );
  for (const session of visibleSessions(list, archivedSessionIds)) {
    const actualDirectory = pathBySession.get(session.id) ?? list.byId[session.id]?.cwd;
    const directory = rebaseDirectoryFromAliases(actualDirectory, selectedRootPath, selectedRootAliases);
    if (directory === undefined) continue;
    const target = orderedTargets.find((candidate) => isPathInside(directory, candidate.path));
    if (target === undefined) result.root.push(session);
    else result.byTargetId[target.id]?.push(session);
  }
  return result;
}
