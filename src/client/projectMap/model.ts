import type {
  HistoryEntry,
  SessionId,
} from "@deepseek-ai/dsh-api-remotes/client";
import type {
  SessionListState,
  WorkspaceView,
} from "@deepseek-ai/dsh-client-runtime/client";

import { isPathInside, rebaseDirectoryFromAliases } from "../sidebar/sessionOwnership.ts";

export interface ProjectGraphSession {
  id: SessionId;
  title: string;
  parentId?: SessionId;
  running: boolean;
  completed: boolean;
  updatedAt: number;
  current: boolean;
}

export interface GraphPoint { x: number; y: number }

export interface ProjectMapLayout {
  version: 1;
  viewport: { x: number; y: number; zoom: number };
  positions: Record<string, GraphPoint>;
}

export interface ProjectTurn {
  turn: number;
  prompt: string;
  response: string;
  toolCount: number;
  userSeq?: number;
  endSeq?: number;
  endedAt?: number;
  status: "completed" | "interrupted" | "running";
}

export const EMPTY_PROJECT_MAP_LAYOUT: ProjectMapLayout = {
  version: 1,
  viewport: { x: 64, y: 72, zoom: 1 },
  positions: {},
};

export function projectMapStorageKey(
  spaceId: string,
  customerId: string,
  projectId: string,
): string {
  return `dsh-workbench:project-map:v1:${encodeURIComponent(spaceId)}:${encodeURIComponent(customerId)}:${encodeURIComponent(projectId)}`;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function decodeProjectMapLayout(value: unknown): ProjectMapLayout {
  if (typeof value !== "object" || value === null) return EMPTY_PROJECT_MAP_LAYOUT;
  const raw = value as Record<string, unknown>;
  const viewportRaw = typeof raw.viewport === "object" && raw.viewport !== null
    ? raw.viewport as Record<string, unknown>
    : {};
  const positions: Record<string, GraphPoint> = {};
  if (typeof raw.positions === "object" && raw.positions !== null && !Array.isArray(raw.positions)) {
    for (const [id, point] of Object.entries(raw.positions as Record<string, unknown>).slice(0, 500)) {
      if (typeof point !== "object" || point === null) continue;
      const item = point as Record<string, unknown>;
      const x = finite(item.x, Number.NaN);
      const y = finite(item.y, Number.NaN);
      if (Number.isFinite(x) && Number.isFinite(y)) positions[id] = { x, y };
    }
  }
  return {
    version: 1,
    viewport: {
      x: finite(viewportRaw.x, EMPTY_PROJECT_MAP_LAYOUT.viewport.x),
      y: finite(viewportRaw.y, EMPTY_PROJECT_MAP_LAYOUT.viewport.y),
      zoom: Math.min(1.6, Math.max(0.55, finite(viewportRaw.zoom, 1))),
    },
    positions,
  };
}

function workspacePathBySession(workspaces: readonly WorkspaceView[]): Map<SessionId, string> {
  const result = new Map<SessionId, string>();
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) result.set(sessionId, workspace.path);
  }
  return result;
}

/** Project membership is derived from DSH's current Session/Workspace facts. */
export function deriveProjectGraphSessions(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  rootPath: string,
  rootAliases: readonly string[],
  projectPath: string,
): ProjectGraphSession[] {
  const archived = new Set(archivedSessionIds);
  const pathBySession = workspacePathBySession(workspaces);
  const matched = list.ids
    .map((id) => list.byId[id])
    .filter((summary) => summary !== undefined)
    .filter((summary) => !archived.has(summary.id) && summary.origin !== "subagent")
    .filter((summary) => !summary.blank || summary.id === list.current)
    .filter((summary) => {
      const actualPath = pathBySession.get(summary.id) ?? summary.cwd;
      const rebased = rebaseDirectoryFromAliases(actualPath, rootPath, rootAliases);
      return rebased !== undefined && isPathInside(rebased, projectPath);
    })
    .map((summary): ProjectGraphSession => ({
      id: summary.id,
      title: summary.displayTitle,
      ...(summary.parentId === undefined ? {} : { parentId: summary.parentId }),
      running: summary.running,
      completed: summary.completed === true,
      updatedAt: summary.updatedAt,
      current: summary.id === list.current,
    }));
  const ids = new Set(matched.map((session) => session.id));
  return matched
    .map((session) => {
      if (session.parentId === undefined || ids.has(session.parentId)) return session;
      const { parentId: _parentId, ...root } = session;
      return root;
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/** Stable, lineage-aware default placement; user-dragged positions override it. */
export function layoutProjectSessions(
  sessions: readonly ProjectGraphSession[],
  saved: Readonly<Record<string, GraphPoint>>,
): Record<string, GraphPoint> {
  const byParent = new Map<string | undefined, ProjectGraphSession[]>();
  for (const session of sessions) {
    const key = session.parentId;
    const group = byParent.get(key) ?? [];
    group.push(session);
    byParent.set(key, group);
  }
  for (const group of byParent.values()) group.sort((left, right) => right.updatedAt - left.updatedAt);

  const points: Record<string, GraphPoint> = {};
  const visited = new Set<SessionId>();
  let row = 0;
  const place = (session: ProjectGraphSession, depth: number): void => {
    if (visited.has(session.id)) return;
    visited.add(session.id);
    points[session.id] = saved[session.id] ?? { x: 56 + depth * 310, y: 52 + row * 132 };
    row += 1;
    for (const child of byParent.get(session.id) ?? []) place(child, depth + 1);
  };
  for (const root of byParent.get(undefined) ?? []) place(root, 0);
  for (const session of sessions) place(session, 0);
  return points;
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (typeof block !== "object" || block === null) return "";
    const raw = block as Record<string, unknown>;
    if (raw.type === "text" && typeof raw.text === "string") return raw.text;
    if (raw.type === "image") return "[图片]";
    return "";
  }).filter(Boolean).join("\n").trim();
}

function eventTurn(event: HistoryEntry["event"]): number | undefined {
  if (typeof event.data !== "object" || event.data === null) return undefined;
  const value = (event.data as Record<string, unknown>).turn;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function ellipsis(value: string, max = 220): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

/** Build a compact human transcript without retaining tool arguments/results. */
export function projectTurns(entries: readonly HistoryEntry[]): ProjectTurn[] {
  const turns = new Map<number, ProjectTurn>();
  let activeTurn: number | undefined;
  const ensure = (turn: number): ProjectTurn => {
    const current = turns.get(turn);
    if (current !== undefined) return current;
    const created: ProjectTurn = { turn, prompt: "", response: "", toolCount: 0, status: "running" };
    turns.set(turn, created);
    return created;
  };

  for (const { event } of entries) {
    const explicitTurn = eventTurn(event);
    if (event.type === "turn/start") activeTurn = explicitTurn;
    const turnNumber = explicitTurn ?? activeTurn;
    if (turnNumber === undefined) continue;
    const turn = ensure(turnNumber);
    if (event.type === "user/message") {
      const data = event.data as unknown as { content?: unknown; source?: { kind?: string } };
      if (data.source?.kind === "user") {
        const prompt = textFromContent(data.content);
        if (prompt !== "") turn.prompt = ellipsis(prompt);
        turn.userSeq ??= event.seq;
      }
    } else if (event.type === "assistant/message") {
      const data = event.data as unknown as { message?: { content?: unknown } };
      const response = textFromContent(data.message?.content);
      if (response !== "") turn.response = ellipsis(response);
    } else if (event.type === "tool/call") {
      turn.toolCount += 1;
    } else if (event.type === "turn/end") {
      const reason = (event.data as unknown as { reason?: { kind?: string } }).reason?.kind;
      turn.endSeq = event.seq;
      turn.endedAt = event.time;
      turn.status = reason === "completed" || reason === "max-tokens" ? "completed" : "interrupted";
      if (activeTurn === turnNumber) activeTurn = undefined;
    }
  }
  return [...turns.values()]
    .filter((turn) => turn.prompt !== "" || turn.response !== "" || turn.toolCount > 0)
    .sort((left, right) => left.turn - right.turn);
}
