import type { Context } from "@deepseek-ai/cordis";
import type {
  SessionId,
  WorkspaceId,
  WorkspaceView,
} from "@deepseek-ai/dsh-api-remotes/client";
import type { ModelRouteRef } from "../types.ts";

export type ClientContext = Context;
export type { SessionId, WorkspaceId, WorkspaceView };

export type PendingInteractionStatus = "approval" | "plan-review" | "question";

export interface CompatibleSessionSummary {
  id: SessionId;
  displayTitle: string;
  cwd?: string;
  parentId?: SessionId;
  origin?: "subagent";
  running: boolean;
  pendingInteraction?: PendingInteractionStatus;
  completed?: boolean;
  blank: boolean;
  updatedAt: number;
}

/** Shared structural subset of the 0.1.1 runtime and 0.1.2 Session Controller. */
export interface SessionListState {
  ids: SessionId[];
  byId: Record<SessionId, CompatibleSessionSummary>;
  current: SessionId | undefined;
  phase: "pending" | "ready";
}

/** Shared structural subset of the 0.1.1 runtime and 0.1.2 Workspace Controller. */
export interface WorkspaceListState {
  items: readonly WorkspaceView[];
  archivedSessionIds: readonly SessionId[];
  phase: "pending" | "ready";
}

interface SnapshotSource<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

interface CommandResult<T> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message: string };
}

export interface SessionBinding {
  session: {
    command(line: string): Promise<CommandResult<{ matched: boolean }>>;
  };
}

export interface ISessions {
  list: SnapshotSource<SessionListState>;
  create(opts?: {
    workspaceId?: WorkspaceId;
    cwd?: string;
    sessionId?: SessionId;
  }): Promise<SessionId>;
  open(sessionId: SessionId): void;
  fork(opts: { sessionId: SessionId; atSeq?: number; increaseTitle?: boolean }): Promise<SessionId>;
  binding(sessionId: SessionId): SessionBinding | undefined;
}

export interface CompatibleHistoryEntry {
  event: {
    type: string;
    seq: number;
    time: number;
    data: unknown;
  };
}

export interface CompatibleHistoryPage {
  entries: CompatibleHistoryEntry[];
  hasMore: boolean;
}

interface ServiceContext {
  get(name: string): unknown;
  workspaces: unknown;
  sessions: unknown;
  connection?: unknown;
  remote?: Record<string, unknown>;
}

interface WorkspaceNavigation {
  startSession(workspaceId?: WorkspaceId): void;
  pickDirectory(): Promise<string | null>;
  openPath(path: string): Promise<void>;
}

export interface SessionCreator {
  create(opts?: {
    workspaceId?: WorkspaceId;
    cwd?: string;
    sessionId?: SessionId;
  }): Promise<SessionId>;
}

interface ModernSessionRemote {
  modelCatalog(): Promise<CommandResult<{
    groups: readonly CompatibleModelGroup[];
  }>>;
  selectModel(request: { sessionId: SessionId } & ModelRouteRef): Promise<CommandResult<unknown>>;
  follow(
    request: {
      address: { kind: "session"; sessionId: SessionId };
      maxMessages?: number;
    },
    signal?: AbortSignal,
  ): AsyncIterable<{
    type: string;
    hasMore?: boolean;
    records?: readonly CompatibleHistoryRecord[];
  }>;
}

interface CompatibleChunkRunData {
  turn: number;
  step: number;
  index: number;
  dt: number[];
  texts?: string[];
  args?: string[];
  id?: string;
  name?: string;
}

interface CompatibleChunkRowEvent {
  type: "chunkrow/text-chunks" | "chunkrow/reasoning-chunks" | "chunkrow/tool-call-chunks";
  seq: number;
  time: number;
  data: CompatibleChunkRunData;
}

interface CompatibleHistoryRecord {
  type: string;
  event?: CompatibleHistoryEntry["event"] | CompatibleChunkRowEvent;
}

interface LegacyApi {
  llm: {
    models(request: Record<string, never>): Promise<{ result: CommandResult<{
      groups: readonly CompatibleModelGroup[];
    }> }>;
  };
  sessions: {
    create(request: { cwd: string; agentPreset?: string }): Promise<{
      result: CommandResult<{ sessionId: SessionId }>;
    }>;
    selectModel(request: { sessionId: SessionId } & ModelRouteRef): Promise<{
      result: CommandResult<unknown>;
    }>;
    history(request: { sessionId: SessionId; maxMessages: number }): Promise<{
      result: CommandResult<{ events: CompatibleHistoryEntry[]; hasMore: boolean }>;
    }>;
  };
}

export interface CompatibleModelGroup {
  id: string;
  name?: string;
  models: readonly { id: string; name?: string }[];
}

function services(ctx: unknown): ServiceContext {
  return ctx as ServiceContext;
}

function modernSessionRemote(ctx: unknown): ModernSessionRemote | undefined {
  const client = services(ctx);
  const remote = client.get("remote.session")
    ?? client.remote?.session;
  const candidate = remote as Partial<ModernSessionRemote> | undefined;
  return typeof candidate?.modelCatalog === "function"
    && typeof candidate.selectModel === "function"
    && typeof candidate.follow === "function"
    ? candidate as ModernSessionRemote
    : undefined;
}

function legacyApi(ctx: unknown): LegacyApi | undefined {
  return (services(ctx).connection as { api?: LegacyApi } | undefined)?.api;
}

function failure(prefix: string, result: CommandResult<unknown>): Error {
  return new Error(`${prefix}: ${result.error?.code ?? "UNKNOWN"}: ${result.error?.message ?? "Unknown error"}`);
}

/** Expand RC.1's compact Assistant delta rows back to their logical events. */
function expandHistoryRecord(record: CompatibleHistoryRecord): CompatibleHistoryEntry[] {
  if (record.type === "event" && record.event !== undefined) return [{ event: record.event }];
  if (record.type !== "chunks" || record.event === undefined) return [];

  const row = record.event as CompatibleChunkRowEvent;
  const members = row.type === "chunkrow/tool-call-chunks" ? row.data.args : row.data.texts;
  if (members === undefined) return [];

  let time = row.time;
  return members.map((member, index) => {
    if (index > 0) time += row.data.dt[index - 1] ?? 0;
    const chunk = row.type === "chunkrow/text-chunks"
      ? { type: "text-delta", index: row.data.index, text: member }
      : row.type === "chunkrow/reasoning-chunks"
        ? { type: "reasoning-delta", index: row.data.index, text: member }
        : {
            type: "tool-call-delta",
            index: row.data.index,
            id: row.data.id,
            ...(row.data.name === undefined ? {} : { name: row.data.name }),
            argumentsDelta: member,
          };
    return {
      event: {
        type: "assistant/chunk",
        seq: row.seq + index,
        time,
        data: { turn: row.data.turn, step: row.data.step, chunk },
      },
    };
  });
}

function navigationMethod<K extends keyof WorkspaceNavigation>(ctx: unknown, key: K): {
  owner: WorkspaceNavigation;
  method: WorkspaceNavigation[K];
} {
  const client = services(ctx);
  const modern = client.get("uiWorkspace") as Partial<WorkspaceNavigation> | undefined;
  if (typeof modern?.[key] === "function") {
    return { owner: modern as WorkspaceNavigation, method: modern[key] as WorkspaceNavigation[K] };
  }
  const legacy = client.workspaces as Partial<WorkspaceNavigation>;
  if (typeof legacy[key] === "function") {
    return { owner: legacy as WorkspaceNavigation, method: legacy[key] as WorkspaceNavigation[K] };
  }
  throw new Error(`DSH does not provide workspace navigation method ${key}`);
}

/** DSH 0.1.2 moved navigation from `workspaces` to `uiWorkspace`. */
export function startWorkspaceSession(ctx: unknown, workspaceId?: WorkspaceId): void {
  const { owner, method } = navigationMethod(ctx, "startSession");
  method.call(owner, workspaceId);
}

/** Open the directory picker through the modern UI service or the legacy runtime. */
export function pickWorkspaceDirectory(ctx: unknown): Promise<string | null> {
  const { owner, method } = navigationMethod(ctx, "pickDirectory");
  return method.call(owner);
}

/** Open a host path where the selected DSH generation exposes that capability. */
export function openWorkspacePath(ctx: unknown, path: string): Promise<void> {
  const { owner, method } = navigationMethod(ctx, "openPath");
  return method.call(owner, path);
}

/** Both verified DSH generations expose create on the concrete sessions service. */
export function sessionCreator(ctx: unknown): SessionCreator {
  const sessions = services(ctx).sessions as Partial<SessionCreator>;
  if (typeof sessions.create !== "function") {
    throw new Error("DSH does not provide sessions.create");
  }
  return sessions as SessionCreator;
}

/** Read selectable models through the 0.1.2 Remote or 0.1.1 API proxy. */
export async function modelGroups(
  ctx: unknown,
): Promise<readonly CompatibleModelGroup[]> {
  const modern = modernSessionRemote(ctx);
  if (modern !== undefined) {
    const result = await modern.modelCatalog();
    if (!result.ok || result.value === undefined) throw failure("session.modelCatalog failed", result);
    return result.value.groups;
  }
  const legacy = legacyApi(ctx);
  if (legacy === undefined) throw new Error("DSH does not provide a model catalog API");
  const { result } = await legacy.llm.models({});
  if (!result.ok || result.value === undefined) throw failure("llm.models failed", result);
  return result.value.groups;
}

/** Create with a birth-time preset on rc.2, whose runtime has no preset Remote. */
export async function createLegacyPresetSession(
  ctx: unknown,
  cwd: string,
  agentPreset: string,
): Promise<SessionId> {
  const legacy = legacyApi(ctx);
  if (legacy === undefined) throw new Error("DSH does not provide the rc.2 session API");
  const { result } = await legacy.sessions.create({ cwd, agentPreset });
  if (!result.ok || result.value === undefined) throw failure("session.create failed", result);
  return result.value.sessionId;
}

/** Persist a Session model choice through the selected DSH generation. */
export async function selectSessionModel(
  ctx: unknown,
  sessionId: SessionId,
  route: ModelRouteRef,
): Promise<void> {
  const modern = modernSessionRemote(ctx);
  if (modern !== undefined) {
    const result = await modern.selectModel({ sessionId, ...route });
    if (!result.ok) throw failure("session.selectModel failed", result);
    return;
  }
  const legacy = legacyApi(ctx);
  if (legacy === undefined) throw new Error("DSH does not provide a model selection API");
  const { result } = await legacy.sessions.selectModel({ sessionId, ...route });
  if (!result.ok) throw failure("session.selectModel failed", result);
}

/** Load a compact history window from 0.1.2 follow snapshots or 0.1.1 history. */
export async function loadSessionHistory(
  ctx: unknown,
  sessionId: SessionId,
  maxMessages = 40,
): Promise<CompatibleHistoryPage> {
  const modern = modernSessionRemote(ctx);
  if (modern !== undefined) {
    const controller = new AbortController();
    const iterator = modern.follow({
      address: { kind: "session", sessionId },
      maxMessages,
    }, controller.signal)[Symbol.asyncIterator]();
    try {
      const first = await iterator.next();
      if (first.done || first.value.type !== "snapshot" || first.value.records === undefined) {
        throw new Error("session.follow did not return an opening snapshot");
      }
      return {
        entries: first.value.records.flatMap(expandHistoryRecord),
        hasMore: first.value.hasMore === true,
      };
    } finally {
      controller.abort();
      await iterator.return?.();
    }
  }
  const legacy = legacyApi(ctx);
  if (legacy === undefined) throw new Error("DSH does not provide a session history API");
  const { result } = await legacy.sessions.history({ sessionId, maxMessages });
  if (!result.ok || result.value === undefined) throw failure("session.history failed", result);
  return { entries: result.value.events, hasMore: result.value.hasMore };
}

export interface AgentPresetRemote {
  select(sessionId: SessionId, presetId: string): Promise<{
    ok: boolean;
    value?: string;
    error?: { code: string; message: string };
  }>;
}

/** Optional in rc.2; provided by the official agent-preset surface in 0.1.2. */
export function agentPresetRemote(ctx: unknown): AgentPresetRemote | undefined {
  const remote = services(ctx).get("remote.agentPresets") as Partial<AgentPresetRemote> | undefined;
  return typeof remote?.select === "function" ? remote as AgentPresetRemote : undefined;
}

/**
 * Extended and advanced DSH Desktop modes force the official Sidebar shell on
 * after profile patches are applied. Workbench must contribute only the
 * `sidebar.workspaces` body in those modes instead of registering a second
 * top-level Sidebar owner.
 */
export function desktopUsesOfficialSidebar(search?: string): boolean {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const mode = new URLSearchParams(query).get("dsh-desktop-mode");
  return mode === "extended" || mode === "advanced";
}
