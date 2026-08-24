import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  ClientContext,
  ISessions,
  SessionId,
  WorkspaceId,
} from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-connection/client";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";

import { TYPERT_REMOTE } from "../remote.ts";
import type { Config } from "../config.ts";
import { WORKBENCH_SETTINGS_NAMESPACE } from "../settingsContract.ts";
import type {
  CreateCustomerResult,
  CreateProjectResult,
  CustomerSummary,
  DeleteCustomerResult,
  DeleteProjectResult,
  DueRemindersRequest,
  DueRemindersResult,
  ListProjectFilesRequest,
  MoveProjectRequest,
  ProjectDetail,
  ProjectFilesResult,
  ProjectFilter,
  ProjectSummary,
  RenameCustomerResult,
  UpdateProjectRequest,
  WorkbenchSettings,
  WorkbenchStatistics,
  WorkspaceListResult,
  CreateSpaceRequest,
  ListSpacesResult,
  UpdateSpacePolicyRequest,
  UpdateSpaceRequest,
  WorkbenchSpace,
  SearchSpacesResult,
  AuxiliaryCapabilitiesResult,
  DshModelGroup,
  WorkspacePathStatusResult,
} from "../types.ts";
import { startWorkbenchLiveSync } from "./catalogSync.ts";
import type { WorkbenchViewFace } from "./face.ts";
import { en, NS, type WorkbenchKey, zh } from "./locales.ts";
import { remountPluginCss, releasePluginCss } from "./pluginCss.ts";
import { bumpLibrary, useLibraryEpoch } from "./selection.ts";
import { registerProjectTriggers } from "./projectTriggers.ts";
import { registerWorkbenchSettingsCard, type CompatibleSettingsSlots } from "./settingsSlot.ts";
import { WorkbenchSidebarRoot } from "./sidebar/WorkbenchSidebarRoot.tsx";
import type { WorkbenchSidebarInjected, WorkbenchSidebarSlotProps } from "./sidebar/slots.ts";
import { inferLegacyRootAliases } from "./sidebar/sessionOwnership.ts";
import { WorkbenchSettingsCard } from "./WorkbenchSettingsCard.tsx";
import { createSpaceSession } from "./sessionCreation.ts";
import { installFileDropCompatibilityBridge } from "./fileDropBridge.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "dsh.workbench": WorkbenchKey;
  }
}

interface RemoteAnswer<T> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string };
}

interface WorkbenchRemote {
  listProjects: (request: { query: string; filter: ProjectFilter }, signal?: AbortSignal) => Promise<RemoteAnswer<{
    settings: WorkbenchSettings;
    customers: CustomerSummary[];
    projects: ProjectSummary[];
    revision: number;
  }>>;
  getProject: (request: { id: string; customerId?: string }) => Promise<RemoteAnswer<ProjectDetail>>;
  listProjectFiles: (request: ListProjectFilesRequest) => Promise<RemoteAnswer<ProjectFilesResult>>;
  updateProject: (request: UpdateProjectRequest) => Promise<RemoteAnswer<ProjectDetail>>;
  moveProject: (request: MoveProjectRequest) => Promise<RemoteAnswer<ProjectDetail>>;
  deleteProject: (request: { id: string; customerId?: string }) => Promise<RemoteAnswer<DeleteProjectResult>>;
  getSettings: (request: Record<string, never>) => Promise<RemoteAnswer<WorkbenchSettings>>;
  listWorkspaces: (request: Record<string, never>) => Promise<RemoteAnswer<WorkspaceListResult>>;
  inspectWorkspacePaths: (request: { paths: string[] }) => Promise<RemoteAnswer<WorkspacePathStatusResult>>;
  getRevision: (request: Record<string, never>) => Promise<RemoteAnswer<{ revision: number }>>;
  setWorkspaceRoot: (request: { path: string }) => Promise<RemoteAnswer<WorkbenchSettings>>;
  hideWorkspaces: (request: { paths: string[] }) => Promise<RemoteAnswer<WorkbenchSettings>>;
  refreshCatalog: (request: Record<string, never>) => Promise<RemoteAnswer<unknown>>;
  createProject: (request: { customerId: string; title: string; productLine?: string }) => Promise<RemoteAnswer<CreateProjectResult>>;
  createCustomer: (request: { name: string }) => Promise<RemoteAnswer<CreateCustomerResult>>;
  renameCustomer: (request: { id: string; name: string }) => Promise<RemoteAnswer<RenameCustomerResult>>;
  deleteCustomer: (request: { id: string }) => Promise<RemoteAnswer<DeleteCustomerResult>>;
  statistics: (request: Record<string, never>) => Promise<RemoteAnswer<WorkbenchStatistics>>;
  dueReminders: (request: DueRemindersRequest) => Promise<RemoteAnswer<DueRemindersResult>>;
  listSpaces: (request: Record<string, never>) => Promise<RemoteAnswer<ListSpacesResult>>;
  createSpace: (request: CreateSpaceRequest) => Promise<RemoteAnswer<WorkbenchSpace>>;
  updateSpace: (request: UpdateSpaceRequest) => Promise<RemoteAnswer<WorkbenchSpace>>;
  removeSpace: (request: { spaceId: string }) => Promise<RemoteAnswer<{ removedSpaceId: string; defaultSpaceId: string }>>;
  reorderSpaces: (request: { spaceIds: string[] }) => Promise<RemoteAnswer<WorkbenchSpace[]>>;
  setDefaultSpace: (request: { spaceId: string }) => Promise<RemoteAnswer<WorkbenchSpace>>;
  setSelectedSpace: (request: { spaceId: string }) => Promise<RemoteAnswer<WorkbenchSpace>>;
  updateSpacePolicy: (request: UpdateSpacePolicyRequest) => Promise<RemoteAnswer<WorkbenchSpace>>;
  getSpace: (request: { spaceId: string }) => Promise<RemoteAnswer<WorkbenchSpace>>;
  getSpacePolicy: (request: { spaceId: string }) => Promise<RemoteAnswer<{ spaceId: string; policy: WorkbenchSpace["policy"] }>>;
  searchSpaces: (request: { query: string }) => Promise<RemoteAnswer<SearchSpacesResult>>;
  getAuxiliaryCapabilities: (request: Record<string, never>) => Promise<RemoteAnswer<AuxiliaryCapabilitiesResult>>;
}

function unwrap<T>(answer: RemoteAnswer<T>, fallback: string): T {
  if (!answer.ok || answer.value === undefined) {
    throw new Error(answer.error?.message ?? fallback);
  }
  return answer.value;
}

export const inject = [
  "slots",
  "locale",
  "connection",
  "remote",
  "settingsScope",
  "workspaces",
  "layout",
  "sessions",
];

export function apply(ctx: ClientContext): void {
  const DEFAULT_ORDINARY_WORKSPACE_TITLE = "normal workspace";
  const hostSettings = ctx.settingsScope.bind<Config>({ namespace: WORKBENCH_SETTINGS_NAMESPACE });
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-workbench: dictionaries");
  ctx.effect(() => {
    remountPluginCss();
    return () => {
      releasePluginCss();
    };
  }, "dsh-workbench: chrome");
  ctx.effect(
    () => installFileDropCompatibilityBridge(),
    "dsh-workbench: file-drop compatibility",
  );
  const remoteOf = (): WorkbenchRemote | undefined =>
    ctx.get("remote.workbench") as WorkbenchRemote | undefined;

  async function waitForWorkspaceList(): Promise<void> {
    if (ctx.workspaces.list.getSnapshot().phase === "ready") return;
    await new Promise<void>((resolve) => {
      let stop = () => {};
      let timer = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        stop();
        window.clearTimeout(timer);
        resolve();
      };
      stop = ctx.workspaces.list.subscribe(() => {
        if (ctx.workspaces.list.getSnapshot().phase === "ready") finish();
      });
      timer = window.setTimeout(finish, 2_000);
      if (ctx.workspaces.list.getSnapshot().phase === "ready") finish();
    });
  }

  function isLegacyCasualWorkspace(path: string): boolean {
    return /(?:^|[\\/])\.dsh-casual-chats[\\/]*$/u.test(path);
  }

  async function defaultOrdinaryWorkspace(allowPick: boolean) {
    await waitForWorkspaceList();
    const workspaceState = ctx.workspaces.list.getSnapshot();
    const candidates = workspaceState.items.filter((item) => !isLegacyCasualWorkspace(item.path));
    const preferred = candidates.find(
      (item) => item.title.trim().toLocaleLowerCase() === DEFAULT_ORDINARY_WORKSPACE_TITLE,
    );
    if (preferred !== undefined) return preferred;

    const sessions = (ctx.sessions as unknown as ISessions).list.getSnapshot();
    const archived = new Set(workspaceState.archivedSessionIds);
    const recent = candidates
      .map((workspace) => ({
        workspace,
        updatedAt: workspace.sessionIds.reduce((latest, sessionId) => {
          if (archived.has(sessionId)) return latest;
          return Math.max(latest, sessions.byId[sessionId]?.updatedAt ?? -1);
        }, -1),
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.workspace;
    if (recent !== undefined) return recent;
    if (!allowPick) return undefined;

    const path = await ctx.workspaces.pickDirectory();
    if (path === null) return undefined;
    return ctx.workspaces.list.getSnapshot().items.find((item) => item.path === path)
      ?? await ctx.workspaces.create({ path });
  }

  async function startDefaultOrdinarySession(allowPick: boolean): Promise<boolean> {
    const workspace = await defaultOrdinaryWorkspace(allowPick);
    if (workspace === undefined) return false;
    ctx.workspaces.startSession(workspace.workspaceId);
    return true;
  }

  let workspaceReconcilePromise: Promise<void> | undefined;

  /**
   * DSH 的 Workspace 注册不会随磁盘目录被外部删除自动消失。启动及窗口重新聚焦时，
   * 注销路径已经不存在的记录，使官方 Workspace 选择器只保留当前有效目录。
   * Workspace 注销不会删除 Session 或其日志；旧会话只会回到 DSH 的未分组状态。
   */
  function reconcileMissingWorkspaceRegistrations(): Promise<void> {
    workspaceReconcilePromise ??= (async () => {
      const remote = remoteOf();
      if (remote === undefined) return;
      try {
        await waitForWorkspaceList();
        const items = ctx.workspaces.list.getSnapshot().items;
        if (items.length === 0) return;
        const inspected = unwrap(
          await remote.inspectWorkspacePaths({ paths: items.map((item) => item.path) }),
          "workspace path inspection failed",
        );
        const missing = new Set(inspected.missingPaths);
        for (const item of items) {
          if (!missing.has(item.path)) continue;
          try {
            await ctx.workspaces.delete(item.workspaceId);
          } catch {
            // 单条注销失败不影响其他失效记录；下次聚焦或启动时继续重试。
          }
        }
        if (missing.size > 0) bumpLibrary();
      } catch {
        // 自愈失败不阻塞启动；下次聚焦或启动时继续重试。
      }
    })().finally(() => {
      workspaceReconcilePromise = undefined;
    });
    return workspaceReconcilePromise;
  }

  const face = (): WorkbenchViewFace => ({
    ready: () => remoteOf() !== undefined,
    listProjects: async (query, filter, signal) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.listProjects({ query, filter }, signal), "list failed");
    },
    getRevision: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getRevision({}), "revision failed").revision;
    },
    getProject: async (id, customerId) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getProject({ id, ...(customerId === undefined ? {} : { customerId }) }), "project failed");
    },
    listProjectFiles: async (request) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.listProjectFiles(request), "files failed");
    },
    updateProject: async (request) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const updated = unwrap(await remote.updateProject(request), "update failed");
      bumpLibrary();
      return updated;
    },
    moveProject: async (request) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const moved = unwrap(await remote.moveProject(request), "move failed");
      bumpLibrary();
      return moved;
    },
    deleteProject: async (id, customerId) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      // 服务端删除时已把项目目录写入隐藏列表；此处只需刷新库版本让隐藏路径生效。
      const deleted = unwrap(await remote.deleteProject({ id, ...(customerId === undefined ? {} : { customerId }) }), "delete failed");
      bumpLibrary();
      return deleted;
    },
    getSettings: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getSettings({}), "settings failed");
    },
    listWorkspaces: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.listWorkspaces({}), "workspaces failed");
    },
    pickDirectory: () => ctx.workspaces.pickDirectory(),
    openPath: (path) => ctx.workspaces.openPath(path),
    setWorkspaceRoot: async (path) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      unwrap(await remote.setWorkspaceRoot({ path }), "set root failed");
      bumpLibrary();
    },
    hideWorkspaces: async (paths) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.hideWorkspaces({ paths }), "hide failed");
    },
    refreshCatalog: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const listed = unwrap(await remote.refreshCatalog({}), "refresh failed");
      bumpLibrary();
      return listed;
    },
    createProject: async (request) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const created = unwrap(await remote.createProject(request), "create failed");
      bumpLibrary();
      return created;
    },
    createCustomer: async (request) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const created = unwrap(await remote.createCustomer(request), "create failed");
      bumpLibrary();
      return created;
    },
    renameCustomer: async (request) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const renamed = unwrap(await remote.renameCustomer(request), "rename failed");
      bumpLibrary();
      return renamed;
    },
    deleteCustomer: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      // 服务端删除时已把客户下所有项目目录写入隐藏列表；此处只需刷新库版本。
      const deleted = unwrap(await remote.deleteCustomer({ id }), "delete failed");
      bumpLibrary();
      return deleted;
    },
    statistics: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.statistics({}), "statistics failed");
    },
    dueReminders: async (request) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.dueReminders(request), "due reminders failed");
    },
    listSpaces: async () => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.listSpaces({}), "list Spaces failed");
    },
    createSpace: async (request) => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      const result = unwrap(await remote.createSpace(request), "create Space failed"); bumpLibrary(); return result;
    },
    updateSpace: async (request) => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      const result = unwrap(await remote.updateSpace(request), "update Space failed"); bumpLibrary(); return result;
    },
    removeSpace: async (spaceId) => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      unwrap(await remote.removeSpace({ spaceId }), "remove Space failed"); bumpLibrary();
    },
    reorderSpaces: async (spaceIds) => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      const result = unwrap(await remote.reorderSpaces({ spaceIds }), "reorder Spaces failed"); bumpLibrary(); return result;
    },
    setDefaultSpace: async (spaceId) => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.setDefaultSpace({ spaceId }), "set default Space failed");
    },
    setSelectedSpace: async (spaceId) => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      const result = unwrap(await remote.setSelectedSpace({ spaceId }), "switch Space failed"); bumpLibrary(); return result;
    },
    updateSpacePolicy: async (request) => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.updateSpacePolicy(request), "update Space policy failed");
    },
    getSpace: async (spaceId) => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getSpace({ spaceId }), "get Space failed");
    },
    getSpacePolicy: async (spaceId) => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getSpacePolicy({ spaceId }), "get Space policy failed").policy;
    },
    searchSpaces: async (query) => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.searchSpaces({ query }), "global Space search failed");
    },
    getAuxiliaryCapabilities: async () => {
      const remote = remoteOf(); if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getAuxiliaryCapabilities({}), "auxiliary capability lookup failed");
    },
    listModels: async (): Promise<DshModelGroup[]> => {
      const connection = (ctx as ClientContext & { connection: ConnectionHandle }).connection;
      const { result } = await connection.api.llm.models({});
      if (!result.ok) throw new Error(result.error.message);
      return result.value.groups.map((group) => ({
        id: group.id,
        name: group.name,
        models: group.models.map((model) => ({ id: model.id, name: model.name })),
      }));
    },
  });

  const workbenchFace = face();

  // One fresh ordinary draft per browser page load. The window marker survives
  // client HMR, so plugin reloads do not interrupt the conversation the user is
  // already viewing; a real page refresh clears it and returns to New Session.
  const pageState = window as typeof window & { __dshWorkbenchFreshPage?: boolean };
  if (pageState.__dshWorkbenchFreshPage !== true) {
    pageState.__dshWorkbenchFreshPage = true;
    void startDefaultOrdinarySession(false)
      .then((started) => { if (!started) pageState.__dshWorkbenchFreshPage = false; })
      .catch(() => { pageState.__dshWorkbenchFreshPage = false; });
  }

  const startRegisteredWorkspaceSession = (targetWorkspaceId: WorkspaceId): void => {
    ctx.workspaces.startSession(targetWorkspaceId);
  };

  const injectSidebar = (): WorkbenchSidebarInjected => ({
    startSession: async () => {
      await startDefaultOrdinarySession(true);
    },
    startSpaceSession: async (spaceId, override) => {
      const listed = await workbenchFace.listSpaces();
      const space = listed.spaces.find((item) => item.id === spaceId);
      if (space === undefined) throw new Error(`Space not found: ${spaceId}`);
      await createSpaceSession(ctx, space, override);
    },
    openProjectSession: async (folderPath: string) => {
      const state = ctx.workspaces.list.getSnapshot();
      let workspace = state.items.find((item) => item.path === folderPath);
      if (workspace === undefined) {
        workspace = await ctx.workspaces.create({ path: folderPath });
      }
      // 有历史会话时打开最近一条（非空白、非归档、非子代理），否则回退到新建/复用空白会话
      if (reopenMostRecent(ctx, workspace.workspaceId)) return;
      ctx.workspaces.startSession(workspace.workspaceId);
    },
    startProjectSession: async (workspaceId) => {
      startRegisteredWorkspaceSession(workspaceId);
    },
    openSession: (sessionId) => {
      (ctx.sessions as unknown as ISessions).open(sessionId);
    },
    archiveSession: async (sessionId) => {
      await ctx.workspaces.archiveSession(sessionId);
    },
    removeBasicProject: async (workspaceId) => {
      await ctx.workspaces.delete(workspaceId);
    },
    toggleSidebar: () => {
      ctx.layout.toggleSidebar();
    },
  });

  /**
   * 尝试打开该工作区最近一条有内容的历史会话（非空白、非归档、非子代理）。
   * @returns 找到并已打开返回 true；无可复用历史会话返回 false（调用方走新建流程）。
   */
  function reopenMostRecent(ctx: ClientContext, workspaceId: WorkspaceId): boolean {
    const ws = ctx.workspaces.list.getSnapshot();
    const archived = new Set(ws.archivedSessionIds);
    // 类型歧义说明：client runtime 将其实例注入为 ctx.sessions（实现 ISessions），
    // 但传递依赖 dsh-session 也把宿主侧 SessionStore 合并进 Context.sessions 声明，
    // 在此构建中遮蔽了 ISessions 的类型名，因此通过 ISessions 显式访问。
    const sessions = (ctx.sessions as unknown as ISessions).list.getSnapshot();
    const sessionIds = ws.items.find((item) => item.workspaceId === workspaceId)?.sessionIds;
    if (sessionIds === undefined) return false;
    let best: SessionId | undefined;
    let bestAt = -1;
    for (const id of sessionIds) {
      if (archived.has(id)) continue;
      const summary = sessions.byId[id];
      if (summary === undefined || summary.blank) continue;
      if (summary.origin === "subagent" || summary.parentId !== undefined) continue;
      if (summary.updatedAt > bestAt) {
        bestAt = summary.updatedAt;
        best = id;
      }
    }
    if (best === undefined) return false;
    (ctx.sessions as unknown as ISessions).open(best);
    return true;
  }

  /** All registered Workbench roots. Sessions under any root belong exclusively
   * to Workbench; the Chats tab stays a flat list of unmanaged recent chats. */
  function useWorkbenchRoots(face: WorkbenchViewFace): {
    spaces: readonly WorkbenchSpace[];
    selectedSpaceId: string | undefined;
    selectedRootPath: string | undefined;
    selectedSpaceName: string | undefined;
  } {
    const epoch = useLibraryEpoch();
    const [state, setState] = useState<{
      spaces: readonly WorkbenchSpace[];
      selectedSpaceId: string | undefined;
      selectedRootPath: string | undefined;
      selectedSpaceName: string | undefined;
    }>({ spaces: [], selectedSpaceId: undefined, selectedRootPath: undefined, selectedSpaceName: undefined });
    useEffect(() => {
      let alive = true;
      let retryTimer: number | undefined;
      const load = async (): Promise<void> => {
        if (!face.ready()) {
          retryTimer = window.setTimeout(() => { void load(); }, 250);
          return;
        }
        try {
          const listed = await face.listSpaces();
          if (!alive) return;
           setState({
             spaces: listed.spaces,
             selectedSpaceId: listed.selectedSpaceId,
             selectedRootPath: listed.spaces.find((space) => space.id === listed.selectedSpaceId)?.rootPath,
            selectedSpaceName: listed.spaces.find((space) => space.id === listed.selectedSpaceId)?.name,
          });
        } catch {
          // remote 未就绪或读取失败：保留上一次结果，避免误清除隐藏路径
          if (alive) retryTimer = window.setTimeout(() => { void load(); }, 500);
        }
      };
      void load();
      return () => {
        alive = false;
        window.clearTimeout(retryTimer);
      };
    }, [epoch, face]);
    return state;
  }

  function BoundSidebar(props: WorkbenchSidebarSlotProps) {
    const workbenchT = ctx.locale.bind(NS);
    const workbenchRoots = useWorkbenchRoots(workbenchFace);
    const sessionState = props.useSessions((state) => state);
    const aliasesBySpace = inferLegacyRootAliases(
      workbenchRoots.spaces,
      Object.values(sessionState.byId).map((session) => session.cwd),
    );
    const managedRootPaths = workbenchRoots.spaces.flatMap((space) => [
      space.rootPath,
      ...(aliasesBySpace[space.id] ?? []),
    ]);
    const selectedRootAliases = workbenchRoots.selectedSpaceId === undefined
      ? []
      : aliasesBySpace[workbenchRoots.selectedSpaceId] ?? [];
    const settingsSnapshot = useSyncExternalStore(
      (listener) => hostSettings.subscribe(listener),
      () => hostSettings.getSnapshot(),
    );
    return (
      <WorkbenchSidebarRoot
        {...props}
        workbenchFace={workbenchFace}
        workbenchT={workbenchT}
        managedRootPaths={managedRootPaths}
         selectedSpaceId={workbenchRoots.selectedSpaceId}
         selectedRootPath={workbenchRoots.selectedRootPath}
        selectedRootAliases={selectedRootAliases}
        selectedSpaceName={workbenchRoots.selectedSpaceName}
        sidebarTitle={settingsSnapshot.value?.sidebarTitle?.trim() || "DSH"}
      />
    );
  }

  ctx.slots.inject("sidebar", () =>
    ctx.slots.register({
      name: "sidebar",
      locale: NS,
      priority: -2,
      children: {
        "sidebar.settings": { kind: "single", scope: "root" },
        "sidebar.settings.trailing": { kind: "list", scope: "root" },
        "sidebar.footer.action": { kind: "list", scope: "root" },
      },
      inject: injectSidebar,
    }, BoundSidebar),
  );

  ctx.effect(async () => {
    const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
    if (ctx.fiber.state >= 5) {
      await disposeRemote();
      return () => {};
    }
    bumpLibrary();
    await reconcileMissingWorkspaceRegistrations();
    const onFocus = () => { void reconcileMissingWorkspaceRegistrations(); };
    window.addEventListener("focus", onFocus);

    const stopSettings = ctx.slots.inject("settings.plugin.item", () =>
      registerWorkbenchSettingsCard(
        ctx.slots as unknown as CompatibleSettingsSlots,
        WorkbenchSettingsCard,
        {
          namespace: WORKBENCH_SETTINGS_NAMESPACE,
          legacyId: "dsh-workbench",
          legacyOrder: 40,
          locale: NS,
          inject: () => ({
            ...face(),
            hostSettings,
          }),
        },
      ));
    const stopLive = startWorkbenchLiveSync(() => workbenchFace.getRevision());

    const triggers = ctx.get("inputTriggers") as
      | Parameters<typeof registerProjectTriggers>[0]
      | undefined;
    const stopTriggers = registerProjectTriggers(
      triggers,
      (id) => workbenchFace.getProject(id),
      async () => {
        const listed = await workbenchFace.listProjects("", "all");
        return listed.projects.map((project) => ({
          id: project.id,
          title: project.title,
          customerName: project.customerName,
        }));
      },
    );

    return async () => {
      window.removeEventListener("focus", onFocus);
      stopLive();
      stopTriggers();
      stopSettings();
      await disposeRemote();
    };
  }, "dsh-workbench: remote-view");
}
