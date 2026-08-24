import { mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import {
  createCustomerFolder,
  createProjectFolder,
  matchesFilter,
  matchesQuery,
  readProjectMarkdown,
  renameCustomerFolder,
  scanWorkspace,
} from "./catalog.ts";
import {
  resolveConfiguredPath,
  resolveDataDir,
  type Config,
} from "./config.ts";
import { startWorkspaceWatch } from "./libraryWatch.ts";
import { categorizeFiles, scanProjectFiles } from "./files.ts";
import {
  loadOverlay,
  overlayProjectKey,
  overlayPath,
  projectOverlayOf,
  saveOverlay,
  withOverlayLock,
} from "./overlay.ts";
import { WorkbenchSpaceService } from "./spaces.ts";
import { auxiliaryCapabilities } from "./auxiliary.ts";
import type {
  BatchUpdateError,
  BatchUpdateRequest,
  BatchUpdateResult,
  CreateCustomerRequest,
  CreateCustomerResult,
  CreateProjectRequest,
  CreateProjectResult,
  DeleteCustomerResult,
  DeleteProjectResult,
  DueReminderItem,
  DueRemindersRequest,
  DueRemindersResult,
  HideWorkspacesRequest,
  IdRequest,
  InspectWorkspacePathsRequest,
  ListProjectFilesRequest,
  ListProjectsRequest,
  ListProjectsResult,
  MoveProjectRequest,
  ProjectIdRequest,
  ProjectDetail,
  ProjectFilesResult,
  ProjectFilter,
  ProjectSummary,
  RenameCustomerRequest,
  RenameCustomerResult,
  SetWorkspaceRootRequest,
  UpdateProjectRequest,
  WorkbenchSettings,
  WorkbenchStatistics,
  WireProjectFilter,
  WorkspaceListResult,
  WorkspacePathStatusResult,
  CreateSpaceRequest,
  ListSpacesRequest,
  ListSpacesResult,
  RemoveSpaceRequest,
  ReorderSpacesRequest,
  ResolveSpaceRequest,
  ResolveSpaceResult,
  SetDefaultSpaceRequest,
  SetSelectedSpaceRequest,
  SpaceMigrationStatus,
  UpdateSpacePolicyRequest,
  UpdateSpaceRequest,
  WorkbenchSpace,
  SearchSpacesRequest,
  SearchSpacesResult,
  SpaceScopedRequest,
  SpacePolicyResult,
  AuxiliaryCapabilitiesResult,
} from "./types.ts";
import { PROJECT_STAGES } from "./types.ts";

export const WORKBENCH_SERVICE = "workbench";

function findProject(
  projects: readonly ProjectSummary[],
  id: string,
  customerId?: string,
): ProjectSummary | undefined {
  const matches = projects.filter((project) => project.id === id
    && (customerId === undefined || project.customerId === customerId));
  if (matches.length > 1) {
    throw new Error(`Project ID ${id} is ambiguous within this Space; provide customerId`);
  }
  return matches[0];
}

export class WorkbenchService extends TypertRemoteService {
  workspaceRoot: string;
  dataDir: string;
  cache: { workspaceRoot: string; items: Awaited<ReturnType<typeof scanWorkspace>> } | undefined;
  catalogRevision = 0;
  watchClose: (() => void) | undefined;
  watchedRoot: string | undefined;
  spaces: WorkbenchSpaceService;
  readonly appCtx: Context;

  constructor(ctx: Context, config: Config) {
    super(ctx, WORKBENCH_SERVICE);
    this.appCtx = ctx;
    this.workspaceRoot = resolveConfiguredPath("workspaceRoot", config.workspaceRoot);
    this.dataDir = resolveConfiguredPath("dataDir", resolveDataDir(config));
    this.spaces = new WorkbenchSpaceService(this.dataDir, this.workspaceRoot);
    ctx.effect(() => async () => {
      this.stopWatch();
    }, "dsh-workbench: workspace watch");
  }

  updateConfig(config: Config): void {
    const workspaceRoot = resolveConfiguredPath("workspaceRoot", config.workspaceRoot);
    const dataDir = resolveConfiguredPath("dataDir", resolveDataDir(config));
    if (workspaceRoot === this.workspaceRoot && dataDir === this.dataDir) return;
    this.workspaceRoot = workspaceRoot;
    this.dataDir = dataDir;
    this.spaces = new WorkbenchSpaceService(this.dataDir, this.workspaceRoot);
    this.stopWatch();
    this.invalidateCatalog();
  }

  invalidateCatalog(): void {
    this.cache = undefined;
    this.catalogRevision += 1;
  }

  stopWatch(): void {
    this.watchClose?.();
    this.watchClose = undefined;
    this.watchedRoot = undefined;
  }

  ensureWatch(workspaceRoot: string): void {
    if (this.watchedRoot === workspaceRoot && this.watchClose !== undefined) return;
    this.stopWatch();
    this.watchedRoot = workspaceRoot;
    this.watchClose = startWorkspaceWatch({
      workspaceRoot,
      overlayPath: overlayPath(this.dataDir),
      onChange: () => {
        this.invalidateCatalog();
      },
    }).close;
  }

  async scanned(spaceId?: string) {
    return withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir, this.workspaceRoot);
      const resolvedSpaceId = spaceId ?? overlay.selectedSpaceId ?? overlay.defaultSpaceId;
      const space = overlay.spaces[resolvedSpaceId];
      if (space === undefined) throw new Error(`Space not found: ${resolvedSpaceId}`);
      const workspaceRoot = space.rootPath;
      this.ensureWatch(workspaceRoot);
      if (this.cache?.workspaceRoot === workspaceRoot) {
        return { overlay, space, spaceId: resolvedSpaceId, workspaceRoot, items: this.cache.items };
      }
      const items = await scanWorkspace(workspaceRoot, { ...overlay, projects: projectOverlayOf(overlay, resolvedSpaceId) });
      this.cache = { workspaceRoot, items };
      return { overlay, space, spaceId: resolvedSpaceId, workspaceRoot, items };
    });
  }

  /** Project IDs are only Space-local; an unscoped duplicate must never be guessed. */
  async projectSpaceId(projectId: string, explicitSpaceId?: string, customerId?: string): Promise<string> {
    if (explicitSpaceId !== undefined) return (await this.spaces.resolve(explicitSpaceId)).spaceId;
    const overlay = await loadOverlay(this.dataDir, this.workspaceRoot);
    const matches: string[] = [];
    for (const space of Object.values(overlay.spaces)) {
      try {
        const items = await scanWorkspace(space.rootPath, { ...overlay, projects: projectOverlayOf(overlay, space.id) });
        if (items.projects.some((project) => project.id === projectId
          && (customerId === undefined || project.customerId === customerId))) matches.push(space.id);
      } catch { /* missing Spaces are not candidates */ }
    }
    if (matches.length > 1) throw new Error(`Project ID ${projectId} is ambiguous across Spaces (${matches.join(", ")}); provide spaceId`);
    return matches[0] ?? overlay.selectedSpaceId ?? overlay.defaultSpaceId;
  }

  async getRevision(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<{ revision: number }> {
    signal.throwIfAborted();
    if (this.watchClose === undefined) await this.scanned();
    return { revision: this.catalogRevision };
  }

  /**
   * DSH 的 Workspace 注册表不会因磁盘目录被外部删除而自动收敛。
   * 这里只做只读路径探测；是否注销 Workspace 由客户端运行时负责。
   */
  async inspectWorkspacePaths(
    request: InspectWorkspacePathsRequest,
    signal: AbortSignal,
  ): Promise<WorkspacePathStatusResult> {
    signal.throwIfAborted();
    const paths = [...new Set(request.paths)];
    const statuses = await Promise.all(paths.map(async (path) => ({
      path,
      available: await stat(path).then((item) => item.isDirectory(), () => false),
    })));
    signal.throwIfAborted();
    return {
      availablePaths: statuses.filter((item) => item.available).map((item) => item.path),
      missingPaths: statuses.filter((item) => !item.available).map((item) => item.path),
    };
  }

  async listProjects(
    request: ListProjectsRequest,
    signal: AbortSignal,
  ): Promise<ListProjectsResult> {
    signal.throwIfAborted();
    const filter = normalizeFilter(request.filter);
    const { overlay, space, spaceId, workspaceRoot, items } = await this.scanned(request.spaceId);
    const matches = (project: (typeof items.projects)[number]) =>
      matchesFilter(project, filter) && matchesQuery(project, request.query);
    const projects = items.projects.filter(matches);
    const showEmptyCustomers = request.query.trim() === "" && filter === "all";
    const customers = items.customers
      .map((customer) => ({ ...customer, projects: customer.projects.filter(matches) }))
      .filter((customer) => showEmptyCustomers || customer.projects.length > 0);
    return {
      settings: await this.settingsOf(spaceId, workspaceRoot, space),
      customers,
      projects,
      revision: this.catalogRevision,
    };
  }

  async getProject(request: ProjectIdRequest, signal: AbortSignal): Promise<ProjectDetail> {
    signal.throwIfAborted();
    const spaceId = await this.projectSpaceId(request.id, request.spaceId, request.customerId);
    const { items } = await this.scanned(spaceId);
    const project = findProject(items.projects, request.id, request.customerId);
    if (project === undefined) throw new Error(`project not found: ${request.id}`);
    return {
      ...project,
      projectMarkdown: await readProjectMarkdown(project.folderPath),
    };
  }

  /** 列出项目文件夹内归集后的文件（按类别 / 关键词过滤，便于查找 Office 等文件）。 */
  async listProjectFiles(
    request: ListProjectFilesRequest,
    signal: AbortSignal,
  ): Promise<ProjectFilesResult> {
    signal.throwIfAborted();
    const spaceId = await this.projectSpaceId(request.id, request.spaceId, request.customerId);
    const { items } = await this.scanned(spaceId);
    const project = findProject(items.projects, request.id, request.customerId);
    if (project === undefined) throw new Error(`project not found: ${request.id}`);
    const all = await scanProjectFiles(project.folderPath);
    const query = request.query?.trim().toLowerCase();
    const files = all.filter((file) => {
      if (request.category !== undefined && file.category !== request.category) return false;
      if (query === undefined || query === "") return true;
      return file.name.toLowerCase().includes(query) || file.relativePath.toLowerCase().includes(query);
    });
    return {
      id: project.id,
      folderPath: project.folderPath,
      files,
      byCategory: categorizeFiles(all),
    };
  }

  async getSettings(_request: Record<string, never>, signal: AbortSignal): Promise<WorkbenchSettings> {
    signal.throwIfAborted();
    const { space, spaceId, workspaceRoot } = await this.scanned();
    return this.settingsOf(spaceId, workspaceRoot, space);
  }

  /** 返回当前工作空间与最近使用过的工作空间列表。 */
  async listWorkspaces(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<WorkspaceListResult> {
    signal.throwIfAborted();
    const listed = await this.spaces.list();
    const current = listed.spaces.find((space) => space.id === listed.selectedSpaceId)!.rootPath;
    return { spaceId: listed.selectedSpaceId, current, workspaces: listed.spaces.filter((space) => space.id !== listed.selectedSpaceId).map((space) => space.rootPath) };
  }

  async setWorkspaceRoot(
    request: SetWorkspaceRootRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchSettings> {
    signal.throwIfAborted();
    const workspaceRoot = resolveUserPath(request.path);
    const space = request.spaceId === undefined
      ? await this.spaces.create({ rootPath: workspaceRoot })
      : await this.spaces.update({ spaceId: request.spaceId, rootPath: workspaceRoot });
    await this.spaces.setSelected(space.id);
    this.stopWatch(); this.invalidateCatalog();
    return this.settingsOf(space.id, space.rootPath, space);
  }

  async refreshCatalog(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<ListProjectsResult> {
    this.invalidateCatalog();
    return this.listProjects({ query: "", filter: "all" }, signal);
  }

  /**
   * 把一批已删除项目的目录路径加入持久隐藏列表：其 Workspace 从「会话」浏览区
   * 隐藏，但会话与注册都原样保留（可见性收起，不销毁数据）。
   */
  async hideWorkspaces(
    request: HideWorkspacesRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchSettings> {
    signal.throwIfAborted();
    return withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir, this.workspaceRoot);
      const spaceId = request.spaceId ?? overlay.selectedSpaceId ?? overlay.defaultSpaceId;
      const space = overlay.spaces[spaceId];
      if (space === undefined) throw new Error(`Space not found: ${spaceId}`);
      const next = [...new Set([...space.hiddenWorkspacePaths, ...request.paths])];
      space.hiddenWorkspacePaths = next;
      await saveOverlay(this.dataDir, overlay);
      return this.settingsOf(spaceId, space.rootPath, space);
    });
  }

  async createProject(
    request: CreateProjectRequest,
    signal: AbortSignal,
  ): Promise<CreateProjectResult> {
    signal.throwIfAborted();
    const { items } = await this.scanned(request.spaceId);
    const customer = items.customers.find((item) => item.id === request.customerId);
    if (customer === undefined) {
      throw new Error(`customer not found: ${request.customerId}`);
    }
    const created = await createProjectFolder(customer.folderPath, request.title, {
      title: request.title,
      ...(request.productLine === undefined ? {} : { productLine: request.productLine }),
      ...(request.stage === undefined ? {} : { stage: request.stage }),
      tags: [],
    });
    this.invalidateCatalog();
    return created;
  }

  /** 在 workspaceRoot 下新建客户文件夹。 */
  async createCustomer(
    request: CreateCustomerRequest,
    signal: AbortSignal,
  ): Promise<CreateCustomerResult> {
    signal.throwIfAborted();
    const { workspaceRoot } = await this.scanned(request.spaceId);
    const created = await createCustomerFolder(workspaceRoot, request.name);
    this.invalidateCatalog();
    return created;
  }

  /** 重命名客户文件夹（内部项目随目录整体迁移）。 */
  async renameCustomer(
    request: RenameCustomerRequest,
    signal: AbortSignal,
  ): Promise<RenameCustomerResult> {
    signal.throwIfAborted();
    const { items, workspaceRoot, spaceId } = await this.scanned(request.spaceId);
    const customer = items.customers.find((item) => item.id === request.id);
    if (customer === undefined) throw new Error(`customer not found: ${request.id}`);
    const renamed = await renameCustomerFolder(workspaceRoot, request.id, request.name);
    await withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir, this.workspaceRoot);
      for (const project of customer.projects) {
        const oldKey = overlayProjectKey(spaceId, customer.id, project.id);
        const nextKey = overlayProjectKey(spaceId, renamed.id, project.id);
        if (overlay.projects[oldKey] !== undefined) {
          overlay.projects[nextKey] = overlay.projects[oldKey];
          delete overlay.projects[oldKey];
        }
      }
      await saveOverlay(this.dataDir, overlay);
    });
    this.invalidateCatalog();
    return renamed;
  }

  async updateProject(
    request: UpdateProjectRequest,
    signal: AbortSignal,
  ): Promise<ProjectDetail> {
    signal.throwIfAborted();
    const resolvedSpaceId = await this.projectSpaceId(request.id, request.spaceId, request.customerId);
    const { items } = await this.scanned(resolvedSpaceId);
    const project = findProject(items.projects, request.id, request.customerId);
    if (project === undefined) throw new Error(`project not found: ${request.id}`);
    await withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir, this.workspaceRoot);
      const spaceId = resolvedSpaceId;
      const key = overlayProjectKey(spaceId, project.customerId, request.id);
      const legacyKey = overlayProjectKey(spaceId, request.id);
      const current = overlay.projects[key] ?? overlay.projects[legacyKey] ?? {};
      const next = { ...current };
      if (request.title !== undefined) {
        if (request.title === "") delete next.title;
        else next.title = request.title;
      }
      if (request.stage !== undefined) next.stage = request.stage;
      if (request.owner !== undefined) {
        if (request.owner === "") delete next.owner;
        else next.owner = request.owner;
      }
      if (request.productLine !== undefined) {
        if (request.productLine === "") delete next.productLine;
        else next.productLine = request.productLine;
      }
      if (request.archived !== undefined) {
        if (request.archived) next.archived = true;
        else delete next.archived;
      }
      overlay.projects[key] = next;
      if (items.projects.filter((item) => item.id === request.id).length === 1) {
        delete overlay.projects[legacyKey];
      }
      await saveOverlay(this.dataDir, overlay);
      this.invalidateCatalog();
    });
    return this.getProject({ id: request.id, customerId: project.customerId, spaceId: resolvedSpaceId }, signal);
  }

  /** 把项目文件夹移动到另一个客户目录下（ID/文件夹名不变）。 */
  async moveProject(
    request: MoveProjectRequest,
    signal: AbortSignal,
  ): Promise<ProjectDetail> {
    signal.throwIfAborted();
    const resolvedSpaceId = await this.projectSpaceId(request.id, request.spaceId, request.sourceCustomerId);
    const { items } = await this.scanned(resolvedSpaceId);
    const project = findProject(items.projects, request.id, request.sourceCustomerId);
    if (project === undefined) throw new Error(`project not found: ${request.id}`);
    const target = items.customers.find((item) => item.id === request.customerId);
    if (target === undefined) throw new Error(`customer not found: ${request.customerId}`);
    if (project.customerId === target.id) {
      return this.getProject({ id: request.id, customerId: project.customerId, spaceId: resolvedSpaceId }, signal);
    }
    const targetPath = join(target.folderPath, project.id);
    const exists = await stat(targetPath).then(() => true, () => false);
    if (exists) throw new Error(`target already exists: ${targetPath}`);
    await rename(project.folderPath, targetPath);
    await withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir, this.workspaceRoot);
      const sourceKey = overlayProjectKey(resolvedSpaceId, project.customerId, project.id);
      const targetKey = overlayProjectKey(resolvedSpaceId, target.id, project.id);
      const legacyKey = overlayProjectKey(resolvedSpaceId, project.id);
      const metadata = overlay.projects[sourceKey] ?? overlay.projects[legacyKey];
      if (metadata !== undefined) overlay.projects[targetKey] = metadata;
      delete overlay.projects[sourceKey];
      if (items.projects.filter((item) => item.id === request.id).length === 1) delete overlay.projects[legacyKey];
      await saveOverlay(this.dataDir, overlay);
    });
    this.invalidateCatalog();
    return this.getProject({ id: request.id, customerId: target.id, spaceId: resolvedSpaceId }, signal);
  }

  /** 把项目文件夹移入回收站 <workspaceRoot>/.trash/<customer>/<id>，并清掉 overlay 记录。 */
  async deleteProject(request: ProjectIdRequest, signal: AbortSignal): Promise<DeleteProjectResult> {
    signal.throwIfAborted();
    const resolvedSpaceId = await this.projectSpaceId(request.id, request.spaceId, request.customerId);
    const { items, workspaceRoot, spaceId } = await this.scanned(resolvedSpaceId);
    const project = findProject(items.projects, request.id, request.customerId);
    if (project === undefined) throw new Error(`project not found: ${request.id}`);
    const trashRoot = join(workspaceRoot, ".trash", project.customerId);
    await mkdir(trashRoot, { recursive: true });
    let targetPath = join(trashRoot, project.id);
    if (await stat(targetPath).then(() => true, () => false)) {
      let suffix = 2;
      while (await stat(targetPath).then(() => true, () => false)) {
        targetPath = join(trashRoot, `${project.id}-${suffix}`);
        suffix += 1;
      }
    }
    await rename(project.folderPath, targetPath);
    await withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir, this.workspaceRoot);
      delete overlay.projects[overlayProjectKey(spaceId, project.customerId, project.id)];
      if (items.projects.filter((item) => item.id === project.id).length === 1) {
        delete overlay.projects[overlayProjectKey(spaceId, project.id)];
      }
      // 可见性收起：把项目目录加入隐藏列表，其 Workspace 从「会话」浏览区隐藏，
      // 会话与注册原样保留，便于将来从回收站恢复后历史完整回来。
      const space = overlay.spaces[spaceId];
      if (space === undefined) throw new Error(`Space not found: ${spaceId}`);
      space.hiddenWorkspacePaths = [...new Set([...space.hiddenWorkspacePaths, project.folderPath])];
      await saveOverlay(this.dataDir, overlay);
    });
    this.invalidateCatalog();
    return { id: project.id, trashedPath: targetPath };
  }

  /**
   * 删除客户：把整个客户目录（连同项下所有项目）移入回收站
   * <workspaceRoot>/.trash/<customerId>，并清掉 overlay 中该客户所有项目的记录。
   */
  async deleteCustomer(request: IdRequest, signal: AbortSignal): Promise<DeleteCustomerResult> {
    signal.throwIfAborted();
    const { items, workspaceRoot, spaceId } = await this.scanned(request.spaceId);
    const customer = items.customers.find((item) => item.id === request.id);
    if (customer === undefined) throw new Error(`customer not found: ${request.id}`);

    // 回收站里若已有同名客户目录，则追加后缀，避免覆盖旧回收内容。
    let targetPath = join(workspaceRoot, ".trash", customer.id);
    if (await stat(targetPath).then(() => true, () => false)) {
      let suffix = 2;
      while (true) {
        targetPath = join(workspaceRoot, ".trash", `${customer.id}-${suffix}`);
        if (!(await stat(targetPath).then(() => true, () => false))) break;
        suffix += 1;
      }
    }
    await mkdir(join(workspaceRoot, ".trash"), { recursive: true });
    await rename(customer.folderPath, targetPath);

    // 清理 overlay 中该客户所有项目的记录，并把各项目目录加入隐藏列表（可见性收起）。
    const projectIds = customer.projects.map((project) => project.id);
    if (projectIds.length > 0) {
      await withOverlayLock(this.dataDir, async () => {
        const overlay = await loadOverlay(this.dataDir, this.workspaceRoot);
        for (const project of customer.projects) {
          delete overlay.projects[overlayProjectKey(spaceId, customer.id, project.id)];
          if (items.projects.filter((item) => item.id === project.id).length === 1) {
            delete overlay.projects[overlayProjectKey(spaceId, project.id)];
          }
        }
        const space = overlay.spaces[spaceId];
        if (space === undefined) throw new Error(`Space not found: ${spaceId}`);
        const hidden = [...new Set([
          ...space.hiddenWorkspacePaths,
          ...customer.projects.map((project) => project.folderPath),
        ])];
        space.hiddenWorkspacePaths = hidden;
        await saveOverlay(this.dataDir, overlay);
      });
    }
    this.invalidateCatalog();
    return { id: customer.id, trashedPath: targetPath, projects: projectIds.length };
  }

  /** 工作台统计快照（含归档项目），供统计工具与仪表盘使用。 */
  async statistics(
    request: SpaceScopedRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchStatistics> {
    signal.throwIfAborted();
    const { workspaceRoot, spaceId, items } = await this.scanned(request.spaceId);
    const projects = items.projects;
    const byStage = Object.fromEntries(
      PROJECT_STAGES.map((stage) => [stage, 0]),
    ) as Record<string, number>;
    const customerCounts = new Map<string, { id: string; name: string; count: number }>();
    const productLineCounts = new Map<string, number>();
    const ownerCounts = new Map<string, number>();
    let archivedProjects = 0;
    let doneProjects = 0;
    let overdueProjects = 0;
    let dueSoonProjects = 0;
    const today = startOfDay(new Date());
    for (const project of projects) {
      byStage[project.stage] = (byStage[project.stage] ?? 0) + 1;
      if (project.archived) {
        archivedProjects += 1;
        continue;
      }
      if (project.stage === "acceptance" || project.stage === "retrospective") doneProjects += 1;
      const customer = customerCounts.get(project.customerId) ?? {
        id: project.customerId,
        name: project.customerName,
        count: 0,
      };
      customer.count += 1;
      customerCounts.set(project.customerId, customer);
      if (project.productLine !== undefined) {
        productLineCounts.set(project.productLine, (productLineCounts.get(project.productLine) ?? 0) + 1);
      }
      if (project.owner !== undefined) {
        ownerCounts.set(project.owner, (ownerCounts.get(project.owner) ?? 0) + 1);
      }
      if (project.dueAt !== undefined) {
        const daysLeft = daysUntil(project.dueAt, today);
        if (daysLeft !== undefined) {
          if (daysLeft < 0) overdueProjects += 1;
          else if (daysLeft <= DUE_SOON_DAYS) dueSoonProjects += 1;
        }
      }
    }
    return {
      workspaceRoot,
      spaceId,
      totalProjects: projects.length,
      activeProjects: projects.length - archivedProjects,
      archivedProjects,
      doneProjects,
      customers: items.customers.length,
      byStage,
      byCustomer: [...customerCounts.values()].sort((left, right) => right.count - left.count),
      byProductLine: [...productLineCounts.entries()]
        .map(([productLine, count]) => ({ productLine, count }))
        .sort((left, right) => right.count - left.count),
      byOwner: [...ownerCounts.entries()]
        .map(([owner, count]) => ({ owner, count }))
        .sort((left, right) => right.count - left.count),
      overdueProjects,
      dueSoonProjects,
    };
  }

  /** 到期提醒：列出已过期与近期到期的项目（未归档未完结）。 */
  async dueReminders(request: DueRemindersRequest, signal: AbortSignal): Promise<DueRemindersResult> {
    signal.throwIfAborted();
    const { workspaceRoot, spaceId, items } = await this.scanned(request.spaceId);
    const horizonDays = Math.max(0, Math.floor(request.days ?? DUE_SOON_DAYS));
    const customer = request.customer?.trim().toLowerCase();
    const today = startOfDay(new Date());
    const candidates = items.projects.filter(
      (project) =>
        project.dueAt !== undefined
        && !project.archived
        && project.stage !== "acceptance"
        && project.stage !== "retrospective"
        && (customer === undefined || customer === "" || project.customerName.toLowerCase().includes(customer)),
    );
    const overdue: DueReminderItem[] = [];
    const dueSoon: DueReminderItem[] = [];
    for (const project of candidates) {
      const dueAt = project.dueAt;
      if (dueAt === undefined) continue;
      const daysLeft = daysUntil(dueAt, today);
      if (daysLeft === undefined) continue;
      const item: DueReminderItem = {
        id: project.id,
        title: project.title,
        customerName: project.customerName,
        stage: project.stage,
        dueAt,
        daysLeft,
        overdue: daysLeft < 0,
        ...(project.owner === undefined ? {} : { owner: project.owner }),
      };
      if (daysLeft < 0) overdue.push(item);
      else if (daysLeft <= horizonDays) dueSoon.push(item);
    }
    overdue.sort((left, right) => left.daysLeft - right.daysLeft);
    dueSoon.sort((left, right) => left.daysLeft - right.daysLeft);
    return { spaceId, workspaceRoot, horizonDays, overdue, dueSoon };
  }

  /** 批量更新项目：可同时改阶段/负责人/产品线/归档状态，并可整体移动所属客户。 */
  async batchUpdate(request: BatchUpdateRequest, signal: AbortSignal): Promise<BatchUpdateResult> {
    signal.throwIfAborted();
    const ids = [...new Set(request.ids.map((id) => id.trim()).filter((id) => id !== ""))];
    if (ids.length === 0) return { updated: 0, failed: 0, errors: [] };
    const { items } = await this.scanned(request.spaceId);
    const errors: BatchUpdateError[] = [];
    const failedIds = new Set<string>();
    const resolved = new Map<string, ProjectSummary>();
    for (const id of ids) {
      const matches = items.projects.filter((item) => item.id === id);
      if (matches.length > 1) {
        errors.push({ id, error: `project ID is ambiguous within this Space: ${id}` });
        failedIds.add(id);
        continue;
      }
      const project = matches[0];
      if (project === undefined) {
        errors.push({ id, error: `project not found: ${id}` });
        failedIds.add(id);
      } else {
        resolved.set(id, project);
      }
    }
    // 移动阶段（改目录层级，不影响 overlay）。
    if (request.customerId !== undefined) {
      const target = items.customers.find((item) => item.id === request.customerId);
      if (target === undefined) {
        for (const id of resolved.keys()) {
          errors.push({ id, error: `customer not found: ${request.customerId}` });
          failedIds.add(id);
        }
      } else {
        for (const [id, project] of resolved) {
          if (project.customerId === target.id) continue;
          const targetPath = join(target.folderPath, id);
          const exists = await stat(targetPath).then(() => true, () => false);
          if (exists) {
            errors.push({ id, error: `target already exists: ${targetPath}` });
            failedIds.add(id);
            continue;
          }
          await rename(project.folderPath, targetPath);
        }
      }
    }
    // 元数据阶段（一次 overlay 锁批量写入）。
    const metaIds = [...resolved.keys()].filter((id) => !failedIds.has(id));
    const hasMeta = request.stage !== undefined
      || request.owner !== undefined
      || request.productLine !== undefined
      || request.archived !== undefined;
    if (metaIds.length > 0 && hasMeta) {
      await withOverlayLock(this.dataDir, async () => {
        const overlay = await loadOverlay(this.dataDir, this.workspaceRoot);
        const spaceId = request.spaceId ?? overlay.selectedSpaceId ?? overlay.defaultSpaceId;
        for (const id of metaIds) {
          const project = resolved.get(id)!;
          const customerId = request.customerId ?? project.customerId;
          const key = overlayProjectKey(spaceId, customerId, id);
          const sourceKey = overlayProjectKey(spaceId, project.customerId, id);
          const legacyKey = overlayProjectKey(spaceId, id);
          const current = overlay.projects[sourceKey] ?? overlay.projects[legacyKey] ?? {};
          const next = { ...current };
          if (request.stage !== undefined) next.stage = request.stage;
          if (request.owner !== undefined) {
            if (request.owner === "") delete next.owner;
            else next.owner = request.owner;
          }
          if (request.productLine !== undefined) {
            if (request.productLine === "") delete next.productLine;
            else next.productLine = request.productLine;
          }
          if (request.archived !== undefined) {
            if (request.archived) next.archived = true;
            else delete next.archived;
          }
          overlay.projects[key] = next;
          if (sourceKey !== key) delete overlay.projects[sourceKey];
          delete overlay.projects[legacyKey];
        }
        await saveOverlay(this.dataDir, overlay);
      });
    }
    if (failedIds.size > 0 || (request.customerId !== undefined && resolved.size > 0) || (hasMeta && metaIds.length > 0)) {
      this.invalidateCatalog();
    }
    return { updated: ids.length - failedIds.size, failed: errors.length, errors };
  }

  async listSpaces(request: ListSpacesRequest, signal: AbortSignal): Promise<ListSpacesResult> {
    signal.throwIfAborted();
    return this.spaces.list(request.selectedSpaceId);
  }

  async createSpace(request: CreateSpaceRequest, signal: AbortSignal): Promise<WorkbenchSpace> {
    signal.throwIfAborted();
    const created = await this.spaces.create(request);
    this.stopWatch(); this.invalidateCatalog();
    return created;
  }

  async updateSpace(request: UpdateSpaceRequest, signal: AbortSignal): Promise<WorkbenchSpace> {
    signal.throwIfAborted();
    const updated = await this.spaces.update(request);
    this.stopWatch(); this.invalidateCatalog();
    return updated;
  }

  async removeSpace(request: RemoveSpaceRequest, signal: AbortSignal): Promise<{ removedSpaceId: string; defaultSpaceId: string }> {
    signal.throwIfAborted();
    const removed = await this.spaces.remove(request.spaceId);
    this.stopWatch(); this.invalidateCatalog();
    return removed;
  }

  async reorderSpaces(request: ReorderSpacesRequest, signal: AbortSignal): Promise<WorkbenchSpace[]> {
    signal.throwIfAborted(); return this.spaces.reorder(request.spaceIds);
  }

  async setDefaultSpace(request: SetDefaultSpaceRequest, signal: AbortSignal): Promise<WorkbenchSpace> {
    signal.throwIfAborted(); return this.spaces.setDefault(request.spaceId);
  }

  async setSelectedSpace(request: SetSelectedSpaceRequest, signal: AbortSignal): Promise<WorkbenchSpace> {
    signal.throwIfAborted();
    const selected = await this.spaces.setSelected(request.spaceId);
    this.stopWatch(); this.invalidateCatalog(); return selected;
  }

  async updateSpacePolicy(request: UpdateSpacePolicyRequest, signal: AbortSignal): Promise<WorkbenchSpace> {
    signal.throwIfAborted(); return this.spaces.updatePolicy(request);
  }

  async getSpace(request: SetDefaultSpaceRequest, signal: AbortSignal): Promise<WorkbenchSpace> {
    signal.throwIfAborted();
    const store = await this.spaces.store(); const space = store.spaces[request.spaceId];
    if (space === undefined) throw new Error(`Space not found: ${request.spaceId}`);
    return space;
  }

  async getSpacePolicy(request: SetDefaultSpaceRequest, signal: AbortSignal): Promise<SpacePolicyResult> {
    const space = await this.getSpace(request, signal); return { spaceId: space.id, policy: space.policy };
  }

  async resolveSpace(request: ResolveSpaceRequest, signal: AbortSignal): Promise<ResolveSpaceResult> {
    signal.throwIfAborted(); return this.spaces.resolve(request.spaceId, request.selectedSpaceId);
  }

  async getMigrationStatus(_request: Record<string, never>, signal: AbortSignal): Promise<SpaceMigrationStatus> {
    signal.throwIfAborted(); return this.spaces.migrationStatus();
  }

  async searchSpaces(request: SearchSpacesRequest, signal: AbortSignal): Promise<SearchSpacesResult> {
    signal.throwIfAborted();
    const overlay = await loadOverlay(this.dataDir, this.workspaceRoot);
    const query = request.query.trim();
    const projects: SearchSpacesResult["projects"] = [];
    const overview: SearchSpacesResult["overview"] = [];
    for (const space of Object.values(overlay.spaces).sort((a, b) => a.order - b.order)) {
      signal.throwIfAborted();
      try {
        const items = await scanWorkspace(space.rootPath, { ...overlay, projects: projectOverlayOf(overlay, space.id) });
        overview.push({ spaceId: space.id, name: space.name, customers: items.customers.length, projects: items.projects.length, pathStatus: "available" });
        for (const project of items.projects) if (query === "" || matchesQuery(project, query)) projects.push({ ...project, spaceId: space.id, spaceName: space.name });
      } catch {
        overview.push({ spaceId: space.id, name: space.name, customers: 0, projects: 0, pathStatus: "missing" });
      }
    }
    return { query, projects, overview };
  }

  async getAuxiliaryCapabilities(_request: Record<string, never>, signal: AbortSignal): Promise<AuxiliaryCapabilitiesResult> {
    signal.throwIfAborted(); return auxiliaryCapabilities(this.appCtx);
  }

  async settingsOf(
    spaceId: string,
    workspaceRoot: string,
    space: { rules?: string; hiddenWorkspacePaths: string[] },
  ): Promise<WorkbenchSettings> {
    return {
      spaceId,
      workspaceRoot,
      ...(space.rules === undefined || space.rules === "" ? {} : { rules: space.rules }),
      ...(space.hiddenWorkspacePaths.length === 0
        ? {}
        : { hiddenWorkspaces: space.hiddenWorkspacePaths }),
    };
  }
}

function resolveUserPath(path: string): string {
  return resolveConfiguredPath("workspaceRoot", path);
}

/** 旧版客户端的 legacy 过滤值（active/done/archived）统一按 "all" 处理。 */
function normalizeFilter(filter: WireProjectFilter): ProjectFilter {
  if (filter === "active" || filter === "done" || filter === "archived") return "all";
  return filter;
}

/** 统计工具中“即将到期”的默认窗口（天）。 */
export const DUE_SOON_DAYS = 7;

/** 把 Date 归一到本地时区当天 0 点。 */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 解析 YYYY-MM-DD 为本地当天 0 点；格式非法返回 undefined。 */
export function parseDay(value: string): Date | undefined {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (matched === null) return undefined;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(year, month - 1, day);
  // 拒绝会被 Date 自动滚动（如 02-30 → 03-02）的非法日期。
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date;
}

/** 距 today 的天数（负数表示已过期）；dueAt 无法解析时返回 undefined。 */
export function daysUntil(dueAt: string, today: Date): number | undefined {
  const target = parseDay(dueAt);
  if (target === undefined) return undefined;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
