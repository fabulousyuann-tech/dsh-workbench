import { useEffect, useState } from "react";
import type {
  ClientContext,
  ISessions,
  SessionId,
  WorkspaceId,
} from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";

import { TYPERT_REMOTE } from "../remote.ts";
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
import { WorkbenchSettingsCard } from "./WorkbenchSettingsCard.tsx";

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
  listProjects: (request: { query: string; filter: ProjectFilter }) => Promise<RemoteAnswer<{
    settings: WorkbenchSettings;
    customers: CustomerSummary[];
    projects: ProjectSummary[];
    revision: number;
  }>>;
  getProject: (request: { id: string }) => Promise<RemoteAnswer<ProjectDetail>>;
  listProjectFiles: (request: ListProjectFilesRequest) => Promise<RemoteAnswer<ProjectFilesResult>>;
  updateProject: (request: UpdateProjectRequest) => Promise<RemoteAnswer<ProjectDetail>>;
  moveProject: (request: MoveProjectRequest) => Promise<RemoteAnswer<ProjectDetail>>;
  deleteProject: (request: { id: string }) => Promise<RemoteAnswer<DeleteProjectResult>>;
  getSettings: (request: Record<string, never>) => Promise<RemoteAnswer<WorkbenchSettings>>;
  listWorkspaces: (request: Record<string, never>) => Promise<RemoteAnswer<WorkspaceListResult>>;
  getRevision: (request: Record<string, never>) => Promise<RemoteAnswer<{ revision: number }>>;
  setWorkspaceRoot: (request: { path: string }) => Promise<RemoteAnswer<WorkbenchSettings>>;
  refreshCatalog: (request: Record<string, never>) => Promise<RemoteAnswer<unknown>>;
  createProject: (request: { customerId: string; title: string; productLine?: string }) => Promise<RemoteAnswer<CreateProjectResult>>;
  createCustomer: (request: { name: string }) => Promise<RemoteAnswer<CreateCustomerResult>>;
  renameCustomer: (request: { id: string; name: string }) => Promise<RemoteAnswer<RenameCustomerResult>>;
  deleteCustomer: (request: { id: string }) => Promise<RemoteAnswer<DeleteCustomerResult>>;
  statistics: (request: Record<string, never>) => Promise<RemoteAnswer<WorkbenchStatistics>>;
  dueReminders: (request: DueRemindersRequest) => Promise<RemoteAnswer<DueRemindersResult>>;
}

function unwrap<T>(answer: RemoteAnswer<T>, fallback: string): T {
  if (!answer.ok || answer.value === undefined) {
    throw new Error(answer.error?.message ?? fallback);
  }
  return answer.value;
}

export const inject = ["slots", "locale", "remote", "workspaces", "layout", "sessions"];

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-workbench: dictionaries");
  ctx.effect(() => {
    remountPluginCss();
    return () => {
      releasePluginCss();
    };
  }, "dsh-workbench: chrome");
  const remoteOf = (): WorkbenchRemote | undefined =>
    ctx.get("remote.workbench") as WorkbenchRemote | undefined;

  const face = (): WorkbenchViewFace => ({
    ready: () => remoteOf() !== undefined,
    listProjects: async (query, filter) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.listProjects({ query, filter }), "list failed");
    },
    getRevision: async () => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getRevision({}), "revision failed").revision;
    },
    getProject: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      return unwrap(await remote.getProject({ id }), "project failed");
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
    deleteProject: async (id) => {
      const remote = remoteOf();
      if (remote === undefined) throw new Error("remote unavailable");
      const deleted = unwrap(await remote.deleteProject({ id }), "delete failed");
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
  });

  const workbenchFace = face();

  const injectSidebar = (): WorkbenchSidebarInjected => ({
    startSession: (workspaceId?: WorkspaceId) => {
      ctx.workspaces.startSession(workspaceId);
    },
    openProjectSession: (folderPath: string) => {
      void (async () => {
        const state = ctx.workspaces.list.getSnapshot();
        let workspace = state.items.find((item) => item.path === folderPath);
        if (workspace === undefined) {
          workspace = await ctx.workspaces.create({ path: folderPath });
        }
        // 有历史会话时打开最近一条（非空白、非归档、非子代理），否则回退到新建/复用空白会话
        if (reopenMostRecent(ctx, workspace.workspaceId)) return;
        ctx.workspaces.startSession(workspace.workspaceId);
      })();
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

  /**
   * 收集工作台所有项目文件夹路径（含归档）。这些文件夹对应的 Workspace 及其会话
   * 只在工作台 tab 里展示，不应出现在「会话」浏览区（交给 sidebar.workspaces 的
   * hiddenWorkspacePaths 过滤）。数据随工作台库版本（新增/删除/移动项目）刷新。
   */
  function useProjectFolderPaths(face: WorkbenchViewFace): readonly string[] {
    const epoch = useLibraryEpoch();
    const [paths, setPaths] = useState<readonly string[]>([]);
    useEffect(() => {
      let alive = true;
      void (async () => {
        if (!face.ready()) return;
        try {
          const listed = await face.listProjects("", "all");
          if (!alive) return;
          setPaths(listed.projects.map((project) => project.folderPath));
        } catch {
          // remote 未就绪或读取失败：保留上一次结果，避免误清除隐藏路径
        }
      })();
      return () => {
        alive = false;
      };
    }, [epoch, face]);
    return paths;
  }

  function BoundSidebar(props: WorkbenchSidebarSlotProps) {
    const workbenchT = ctx.locale.bind(NS);
    const hiddenWorkspacePaths = useProjectFolderPaths(workbenchFace);
    return (
      <WorkbenchSidebarRoot
        {...props}
        tabLabels={{
          sessions: workbenchT("tab.sessions"),
          workbench: workbenchT("tab"),
        }}
        workbenchFace={workbenchFace}
        workbenchT={workbenchT}
        hiddenWorkspacePaths={hiddenWorkspacePaths}
      />
    );
  }

  ctx.slots.inject("sidebar", () =>
    ctx.slots.register({
      name: "sidebar",
      locale: NS,
      priority: -2,
      children: {
        "sidebar.workspaces": { kind: "single", scope: "root" },
        "sidebar.settings": { kind: "single", scope: "root" },
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
      stopLive();
      stopTriggers();
      stopSettings();
      await disposeRemote();
    };
  }, "dsh-workbench: remote-view");
}
