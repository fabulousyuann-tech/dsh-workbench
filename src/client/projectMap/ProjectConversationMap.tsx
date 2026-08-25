import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SessionId } from "@deepseek-ai/dsh-api-remotes/client";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import {
  IconArchiveOutline20,
  IconBranchOutline16,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconNewChatOutline16,
  IconRefreshOutline16,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";

import {
  decodeProjectMapLayout,
  deriveProjectGraphSessions,
  EMPTY_PROJECT_MAP_LAYOUT,
  layoutProjectSessions,
  projectMapStorageKey,
  projectTurns,
  type GraphPoint,
  type ProjectMapLayout,
  type ProjectTurn,
} from "./model.ts";
import {
  closeProjectMap,
  useProjectMapState,
} from "./store.ts";
import type {
  SessionListState,
  WorkspaceListState,
} from "@deepseek-ai/dsh-client-runtime/client";
import "./ProjectConversationMap.css";

const NODE_WIDTH = 248;
const NODE_HEIGHT = 96;

function loadLayout(key: string, spaceId: string, projectId: string): ProjectMapLayout {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) return decodeProjectMapLayout(JSON.parse(raw) as unknown);

    // A project can be moved to another customer without changing its own id.
    // Migrate the layout only when there is one unambiguous older customer key.
    const prefix = `dsh-workbench:project-map:v1:${encodeURIComponent(spaceId)}:`;
    const suffix = `:${encodeURIComponent(projectId)}`;
    const candidates = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((candidate): candidate is string => candidate !== null && candidate !== key
        && candidate.startsWith(prefix) && candidate.endsWith(suffix));
    if (candidates.length !== 1) return EMPTY_PROJECT_MAP_LAYOUT;
    const legacy = window.localStorage.getItem(candidates[0]!);
    if (legacy === null) return EMPTY_PROJECT_MAP_LAYOUT;
    const migrated = decodeProjectMapLayout(JSON.parse(legacy) as unknown);
    window.localStorage.setItem(key, JSON.stringify(migrated));
    window.localStorage.removeItem(candidates[0]!);
    return migrated;
  } catch {
    return EMPTY_PROJECT_MAP_LAYOUT;
  }
}

function persistLayout(key: string, layout: ProjectMapLayout): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // Layout persistence is optional; a full storage area must not block the map.
  }
}

function shortTime(value: number): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ProjectConversationMap({
  sessionsState,
  workspaceState,
  connection,
  openSession,
  forkSession,
  archiveSession,
}: {
  sessionsState: SessionListState;
  workspaceState: WorkspaceListState;
  connection: ConnectionHandle;
  openSession: (sessionId: SessionId) => void;
  forkSession: (sessionId: SessionId, atSeq: number) => Promise<SessionId>;
  archiveSession: (sessionId: SessionId) => Promise<void>;
}) {
  const shell = useProjectMapState();
  const target = shell.target;
  const storageKey = target === undefined ? "" : projectMapStorageKey(target.spaceId, target.customerId, target.projectId);
  const [layout, setLayout] = useState<ProjectMapLayout>(EMPTY_PROJECT_MAP_LAYOUT);
  const [selectedSessionId, setSelectedSessionId] = useState<SessionId>();
  const [turns, setTurns] = useState<ProjectTurn[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (storageKey === "") return;
    setLayout(loadLayout(storageKey, target!.spaceId, target!.projectId));
    setSelectedSessionId(undefined);
    setTurns([]);
    setHistoryError(undefined);
    setActionError(undefined);
  }, [storageKey]);

  useEffect(() => {
    if (target === undefined) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeProjectMap();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [target]);

  useEffect(() => {
    if (storageKey === "") return;
    const timer = window.setTimeout(() => { persistLayout(storageKey, layout); }, 180);
    return () => { window.clearTimeout(timer); };
  }, [layout, storageKey]);

  const graphSessions = useMemo(() => target === undefined ? [] : deriveProjectGraphSessions(
    sessionsState,
    workspaceState.items,
    workspaceState.archivedSessionIds,
    target.rootPath,
    target.rootAliases,
    target.projectPath,
  ), [sessionsState, target, workspaceState]);

  const positions = useMemo(
    () => layoutProjectSessions(graphSessions, layout.positions),
    [graphSessions, layout.positions],
  );
  const graphIds = useMemo(() => new Set(graphSessions.map((session) => session.id)), [graphSessions]);

  useEffect(() => {
    if (sessionsState.phase !== "ready" || !workspaceState.baselinesReady) return;
    setLayout((current) => {
      const positions = Object.fromEntries(
        Object.entries(current.positions).filter(([sessionId]) => graphIds.has(sessionId as SessionId)),
      );
      return Object.keys(positions).length === Object.keys(current.positions).length
        ? current
        : { ...current, positions };
    });
  }, [graphIds, sessionsState.phase, workspaceState.baselinesReady]);

  useEffect(() => {
    if (selectedSessionId !== undefined && !graphIds.has(selectedSessionId)) {
      setSelectedSessionId(undefined);
      setTurns([]);
    }
  }, [graphIds, selectedSessionId]);

  useEffect(() => {
    if (selectedSessionId === undefined) return;
    let alive = true;
    setHistoryLoading(true);
    setHistoryError(undefined);
    void connection.api.sessions.history({ sessionId: selectedSessionId, maxMessages: 40 })
      .then(({ result }) => {
        if (!alive) return;
        if (!result.ok) throw new Error(result.error.message);
        setTurns(projectTurns(result.value.events));
        setHistoryHasMore(result.value.hasMore);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setHistoryError(cause instanceof Error ? cause.message : String(cause));
        setTurns([]);
      })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [connection, selectedSessionId]);

  if (target === undefined) return null;

  const open = (sessionId: SessionId): void => {
    openSession(sessionId);
    closeProjectMap();
  };

  const startPan = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const start = { x: event.clientX, y: event.clientY, viewport: layout.viewport };
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent): void => {
      setLayout((current) => ({
        ...current,
        viewport: {
          ...current.viewport,
          x: start.viewport.x + next.clientX - start.x,
          y: start.viewport.y + next.clientY - start.y,
        },
      }));
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  const startNodeDrag = (
    event: React.PointerEvent<HTMLElement>,
    sessionId: SessionId,
  ): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button") !== null) return;
    event.stopPropagation();
    const base = positions[sessionId] ?? { x: 0, y: 0 };
    const start = { x: event.clientX, y: event.clientY };
    const move = (next: PointerEvent): void => {
      const point: GraphPoint = {
        x: base.x + (next.clientX - start.x) / layout.viewport.zoom,
        y: base.y + (next.clientY - start.y) / layout.viewport.zoom,
      };
      setLayout((current) => ({
        ...current,
        positions: { ...current.positions, [sessionId]: point },
      }));
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  const fit = (): void => {
    const values = Object.values(positions);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (values.length === 0 || rect === undefined) {
      setLayout((current) => ({ ...current, viewport: EMPTY_PROJECT_MAP_LAYOUT.viewport }));
      return;
    }
    const minX = Math.min(...values.map((point) => point.x));
    const minY = Math.min(...values.map((point) => point.y));
    const maxX = Math.max(...values.map((point) => point.x + NODE_WIDTH));
    const maxY = Math.max(...values.map((point) => point.y + NODE_HEIGHT));
    const zoom = Math.min(1.15, Math.max(0.55, Math.min((rect.width - 96) / (maxX - minX), (rect.height - 96) / (maxY - minY))));
    setLayout((current) => ({
      ...current,
      viewport: { x: 48 - minX * zoom, y: 48 - minY * zoom, zoom },
    }));
  };

  const forkAt = async (sessionId: SessionId, turn: ProjectTurn): Promise<void> => {
    if (turn.endSeq === undefined || busy) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const childId = await forkSession(sessionId, turn.endSeq);
      open(childId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const archive = async (sessionId: SessionId, title: string): Promise<void> => {
    if (!window.confirm(`归档会话“${title}”？归档后将从项目图谱隐藏。`)) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await archiveSession(sessionId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const left = shell.sidebarCollapsed ? 56 : shell.sidebarWidth;
  const selected = graphSessions.find((session) => session.id === selectedSessionId);

  return (
    <section
      data-plugin="dsh-workbench"
      data-surface="project-map"
      style={{ left }}
      aria-label={`${target.projectTitle} 会话图谱`}
    >
      <header className="projectMapHeader">
        <div className="projectMapHeading">
          <span className="projectMapGlyph"><IconBranchOutline16 size={18} /></span>
          <div>
            <div className="projectMapBreadcrumb">
              <span>{target.spaceName}</span><IconChevronRightOutline14 size={12} />
              <span>{target.customerName}</span><IconChevronRightOutline14 size={12} />
              <strong>{target.projectTitle}</strong>
            </div>
            <h2>项目会话图谱</h2>
          </div>
        </div>
        <div className="projectMapHeaderActions">
          <span className="projectMapCount">{graphSessions.length} 个会话</span>
          <Tooltip label="适应画布" delayMs={400}>
            <button type="button" aria-label="适应画布" onClick={fit}><IconRefreshOutline16 size={16} /></button>
          </Tooltip>
          <Tooltip label="关闭图谱" delayMs={400}>
            <button type="button" aria-label="关闭图谱" onClick={closeProjectMap}><IconCloseOutline16 size={16} /></button>
          </Tooltip>
        </div>
      </header>

      <div className={selected === undefined ? "projectMapBody" : "projectMapBody inspecting"}>
        <div
          ref={canvasRef}
          className="projectMapCanvas"
          onPointerDown={startPan}
          onWheel={(event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            const nextZoom = Math.min(1.6, Math.max(0.55, layout.viewport.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
            setLayout((current) => ({ ...current, viewport: { ...current.viewport, zoom: nextZoom } }));
          }}
        >
          {graphSessions.length === 0 && (
            <div className="projectMapEmpty">
              <IconBranchOutline16 size={24} />
              <strong>这个项目还没有会话</strong>
              <span>从左侧点击项目即可新建第一条项目会话。</span>
            </div>
          )}
          <div
            className="projectMapWorld"
            style={{ transform: `translate(${layout.viewport.x}px, ${layout.viewport.y}px) scale(${layout.viewport.zoom})` }}
          >
            <svg className="projectMapEdges" aria-hidden="true">
              {graphSessions.map((session) => {
                if (session.parentId === undefined) return null;
                const parent = positions[session.parentId];
                const child = positions[session.id];
                if (parent === undefined || child === undefined) return null;
                const x1 = parent.x + NODE_WIDTH;
                const y1 = parent.y + NODE_HEIGHT / 2;
                const x2 = child.x;
                const y2 = child.y + NODE_HEIGHT / 2;
                const bend = Math.max(32, (x2 - x1) / 2);
                return <path key={`${session.parentId}-${session.id}`} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} />;
              })}
            </svg>
            {graphSessions.map((session) => {
              const point = positions[session.id] ?? { x: 0, y: 0 };
              return (
                <article
                  key={session.id}
                  className={`projectMapNode${session.current ? " current" : ""}${session.id === selectedSessionId ? " selected" : ""}`}
                  style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
                  onPointerDown={(event) => { startNodeDrag(event, session.id); }}
                >
                  <button type="button" className="projectMapNodeMain" onClick={() => { open(session.id); }}>
                    <span className="projectMapNodeIcon"><IconNewChatOutline16 size={15} /></span>
                    <span className="projectMapNodeCopy">
                      <strong>{session.title}</strong>
                      <span>{shortTime(session.updatedAt)}</span>
                    </span>
                    {session.running && <span className="projectMapStatus running" title="运行中" />}
                    {!session.running && session.completed && <span className="projectMapStatus completed" title="已完成" />}
                  </button>
                  <div className="projectMapNodeActions">
                    <button type="button" onClick={() => { setSelectedSessionId(session.id); }}>
                      {session.id === selectedSessionId ? "已展开轮次" : "展开轮次"}
                    </button>
                    <Tooltip label="归档会话" delayMs={400}>
                      <button type="button" className="iconOnly" aria-label={`归档 ${session.title}`} disabled={busy} onClick={() => { void archive(session.id, session.title); }}>
                        <IconArchiveOutline20 size={15} />
                      </button>
                    </Tooltip>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="projectMapZoom" aria-label="画布缩放">
            <button type="button" onClick={() => { setLayout((current) => ({ ...current, viewport: { ...current.viewport, zoom: Math.max(0.55, current.viewport.zoom - 0.1) } })); }}>−</button>
            <span>{Math.round(layout.viewport.zoom * 100)}%</span>
            <button type="button" onClick={() => { setLayout((current) => ({ ...current, viewport: { ...current.viewport, zoom: Math.min(1.6, current.viewport.zoom + 0.1) } })); }}>+</button>
          </div>
        </div>

        {selected !== undefined && (
          <aside className="projectMapInspector">
            <div className="projectMapInspectorHeader">
              <div>
                <span>会话轮次</span>
                <strong>{selected.title}</strong>
              </div>
              <button type="button" aria-label="关闭轮次" onClick={() => { setSelectedSessionId(undefined); }}><IconCloseOutline16 size={15} /></button>
            </div>
            <button type="button" className="projectMapOpenSession" onClick={() => { open(selected.id); }}>
              打开完整会话
            </button>
            {historyLoading && <div className="projectMapInspectorState">正在读取会话轮次…</div>}
            {historyError !== undefined && <div className="projectMapInspectorState error">读取失败：{historyError}</div>}
            {!historyLoading && historyError === undefined && turns.length === 0 && (
              <div className="projectMapInspectorState">还没有可展示的对话轮次。</div>
            )}
            {historyHasMore && <div className="projectMapHistoryLimit">为保持流畅，仅展示最近 40 条消息对应的轮次。</div>}
            <div className="projectMapTurns">
              {turns.map((turn) => (
                <article key={turn.turn} className="projectMapTurn">
                  <div className="projectMapTurnTop">
                    <span>第 {turn.turn + 1} 轮</span>
                    <span className={`projectMapTurnStatus ${turn.status}`}>{turn.status === "completed" ? "已完成" : turn.status === "running" ? "进行中" : "已中断"}</span>
                  </div>
                  {turn.prompt !== "" && <p className="prompt">{turn.prompt}</p>}
                  {turn.response !== "" && <p className="response">{turn.response}</p>}
                  <div className="projectMapTurnFoot">
                    <span>{turn.toolCount > 0 ? `${turn.toolCount} 个工具步骤` : "无工具步骤"}</span>
                    <button type="button" disabled={turn.endSeq === undefined || busy} onClick={() => { void forkAt(selected.id, turn); }}>
                      <IconBranchOutline16 size={14} /> 从这里分支
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {actionError !== undefined && <div className="projectMapActionError">操作失败：{actionError}</div>}
          </aside>
        )}
      </div>
    </section>
  );
}
