import { mkdir, rename, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

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
  expandHomePath,
  resolveDataDir,
  type Config,
} from "./config.ts";
import { startWorkspaceWatch } from "./libraryWatch.ts";
import { categorizeFiles, scanProjectFiles } from "./files.ts";
import {
  loadOverlay,
  overlayPath,
  pushRecentWorkspace,
  saveOverlay,
  withOverlayLock,
} from "./overlay.ts";
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
  IdRequest,
  ListProjectFilesRequest,
  ListProjectsRequest,
  ListProjectsResult,
  MoveProjectRequest,
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
} from "./types.ts";
import { PROJECT_STAGES } from "./types.ts";

export const WORKBENCH_SERVICE = "workbench";

export class WorkbenchService extends TypertRemoteService {
  workspaceRoot: string;
  readonly dataDir: string;
  cache: { workspaceRoot: string; items: Awaited<ReturnType<typeof scanWorkspace>> } | undefined;
  catalogRevision = 0;
  watchClose: (() => void) | undefined;
  watchedRoot: string | undefined;

  constructor(ctx: Context, config: Config) {
    super(ctx, WORKBENCH_SERVICE);
    this.workspaceRoot = resolveUserPath(config.workspaceRoot);
    this.dataDir = resolveUserPath(resolveDataDir(config));
    ctx.effect(() => async () => {
      this.stopWatch();
    }, "dsh-workbench: workspace watch");
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

  async scanned() {
    return withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
      const workspaceRoot = overlay.workspaceRoot ?? this.workspaceRoot;
      this.ensureWatch(workspaceRoot);
      if (this.cache?.workspaceRoot === workspaceRoot) {
        return { overlay, workspaceRoot, items: this.cache.items };
      }
      const items = await scanWorkspace(workspaceRoot, overlay);
      this.cache = { workspaceRoot, items };
      return { overlay, workspaceRoot, items };
    });
  }

  async getRevision(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<{ revision: number }> {
    signal.throwIfAborted();
    if (this.watchClose === undefined) await this.scanned();
    return { revision: this.catalogRevision };
  }

  async listProjects(
    request: ListProjectsRequest,
    signal: AbortSignal,
  ): Promise<ListProjectsResult> {
    signal.throwIfAborted();
    const filter = normalizeFilter(request.filter);
    const { overlay, workspaceRoot, items } = await this.scanned();
    const matches = (project: (typeof items.projects)[number]) =>
      matchesFilter(project, filter) && matchesQuery(project, request.query);
    const projects = items.projects.filter(matches);
    const showEmptyCustomers = request.query.trim() === "" && filter === "all";
    const customers = items.customers
      .map((customer) => ({ ...customer, projects: customer.projects.filter(matches) }))
      .filter((customer) => showEmptyCustomers || customer.projects.length > 0);
    return {
      settings: await this.settingsOf(workspaceRoot, overlay),
      customers,
      projects,
      revision: this.catalogRevision,
    };
  }

  async getProject(request: IdRequest, signal: AbortSignal): Promise<ProjectDetail> {
    signal.throwIfAborted();
    const { items } = await this.scanned();
    const project = items.projects.find((item) => item.id === request.id);
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
    const { items } = await this.scanned();
    const project = items.projects.find((item) => item.id === request.id);
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
    const overlay = await loadOverlay(this.dataDir);
    return this.settingsOf(overlay.workspaceRoot ?? this.workspaceRoot, overlay);
  }

  /** 返回当前工作空间与最近使用过的工作空间列表。 */
  async listWorkspaces(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<WorkspaceListResult> {
    signal.throwIfAborted();
    const overlay = await loadOverlay(this.dataDir);
    const current = overlay.workspaceRoot ?? this.workspaceRoot;
    const recent = (overlay.recentWorkspaces ?? []).filter((path) => path !== current);
    return { current, workspaces: recent };
  }

  async setWorkspaceRoot(
    request: SetWorkspaceRootRequest,
    signal: AbortSignal,
  ): Promise<WorkbenchSettings> {
    signal.throwIfAborted();
    const workspaceRoot = resolveUserPath(request.path);
    return withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
      const previous = overlay.workspaceRoot ?? this.workspaceRoot;
      overlay.workspaceRoot = workspaceRoot;
      overlay.recentWorkspaces = pushRecentWorkspace(
        pushRecentWorkspace(overlay.recentWorkspaces ?? [], previous),
        workspaceRoot,
      );
      await saveOverlay(this.dataDir, overlay);
      this.workspaceRoot = workspaceRoot;
      this.stopWatch();
      this.invalidateCatalog();
      return this.settingsOf(workspaceRoot, overlay);
    });
  }

  async refreshCatalog(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<ListProjectsResult> {
    this.invalidateCatalog();
    return this.listProjects({ query: "", filter: "all" }, signal);
  }

  async createProject(
    request: CreateProjectRequest,
    signal: AbortSignal,
  ): Promise<CreateProjectResult> {
    signal.throwIfAborted();
    const { items } = await this.scanned();
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
    const { workspaceRoot } = await this.scanned();
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
    const { items, workspaceRoot } = await this.scanned();
    const customer = items.customers.find((item) => item.id === request.id);
    if (customer === undefined) throw new Error(`customer not found: ${request.id}`);
    const renamed = await renameCustomerFolder(workspaceRoot, request.id, request.name);
    this.invalidateCatalog();
    return renamed;
  }

  async updateProject(
    request: UpdateProjectRequest,
    signal: AbortSignal,
  ): Promise<ProjectDetail> {
    signal.throwIfAborted();
    await withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
      const current = overlay.projects[request.id] ?? {};
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
      overlay.projects[request.id] = next;
      await saveOverlay(this.dataDir, overlay);
      this.invalidateCatalog();
    });
    return this.getProject({ id: request.id }, signal);
  }

  /** 把项目文件夹移动到另一个客户目录下（ID/文件夹名不变）。 */
  async moveProject(
    request: MoveProjectRequest,
    signal: AbortSignal,
  ): Promise<ProjectDetail> {
    signal.throwIfAborted();
    const { items } = await this.scanned();
    const project = items.projects.find((item) => item.id === request.id);
    if (project === undefined) throw new Error(`project not found: ${request.id}`);
    const target = items.customers.find((item) => item.id === request.customerId);
    if (target === undefined) throw new Error(`customer not found: ${request.customerId}`);
    if (project.customerId === target.id) {
      return this.getProject({ id: request.id }, signal);
    }
    const targetPath = join(target.folderPath, project.id);
    const exists = await stat(targetPath).then(() => true, () => false);
    if (exists) throw new Error(`target already exists: ${targetPath}`);
    await rename(project.folderPath, targetPath);
    this.invalidateCatalog();
    return this.getProject({ id: request.id }, signal);
  }

  /** 把项目文件夹移入回收站 <workspaceRoot>/.trash/<customer>/<id>，并清掉 overlay 记录。 */
  async deleteProject(request: IdRequest, signal: AbortSignal): Promise<DeleteProjectResult> {
    signal.throwIfAborted();
    const { items, workspaceRoot } = await this.scanned();
    const project = items.projects.find((item) => item.id === request.id);
    if (project === undefined) throw new Error(`project not found: ${request.id}`);
    const trashRoot = join(workspaceRoot, ".trash", project.customerId);
    await mkdir(trashRoot, { recursive: true });
    const targetPath = join(trashRoot, project.id);
    await rename(project.folderPath, targetPath);
    await withOverlayLock(this.dataDir, async () => {
      const overlay = await loadOverlay(this.dataDir);
      delete overlay.projects[project.id];
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
    const { items, workspaceRoot } = await this.scanned();
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

    // 清理 overlay 中该客户所有项目的记录。
    const projectIds = customer.projects.map((project) => project.id);
    if (projectIds.length > 0) {
      await withOverlayLock(this.dataDir, async () => {
        const overlay = await loadOverlay(this.dataDir);
        for (const id of projectIds) delete overlay.projects[id];
        await saveOverlay(this.dataDir, overlay);
      });
    }
    this.invalidateCatalog();
    return { id: customer.id, trashedPath: targetPath, projects: projectIds.length };
  }

  /** 工作台统计快照（含归档项目），供统计工具与仪表盘使用。 */
  async statistics(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<WorkbenchStatistics> {
    signal.throwIfAborted();
    const { workspaceRoot, items } = await this.scanned();
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
    const { workspaceRoot, items } = await this.scanned();
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
    return { workspaceRoot, horizonDays, overdue, dueSoon };
  }

  /** 批量更新项目：可同时改阶段/负责人/产品线/归档状态，并可整体移动所属客户。 */
  async batchUpdate(request: BatchUpdateRequest, signal: AbortSignal): Promise<BatchUpdateResult> {
    signal.throwIfAborted();
    const ids = [...new Set(request.ids.map((id) => id.trim()).filter((id) => id !== ""))];
    if (ids.length === 0) return { updated: 0, failed: 0, errors: [] };
    const { items } = await this.scanned();
    const errors: BatchUpdateError[] = [];
    const failedIds = new Set<string>();
    const resolved = new Map<string, ProjectSummary>();
    for (const id of ids) {
      const project = items.projects.find((item) => item.id === id);
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
        const overlay = await loadOverlay(this.dataDir);
        for (const id of metaIds) {
          const current = overlay.projects[id] ?? {};
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
          overlay.projects[id] = next;
        }
        await saveOverlay(this.dataDir, overlay);
      });
    }
    if (failedIds.size > 0 || (request.customerId !== undefined && resolved.size > 0) || (hasMeta && metaIds.length > 0)) {
      this.invalidateCatalog();
    }
    return { updated: ids.length - failedIds.size, failed: errors.length, errors };
  }

  async settingsOf(
    workspaceRoot: string,
    overlay: { workspaceRoot?: string; rules?: string },
  ): Promise<WorkbenchSettings> {
    return {
      workspaceRoot,
      ...(overlay.rules === undefined || overlay.rules === "" ? {} : { rules: overlay.rules }),
    };
  }
}

function resolveUserPath(path: string): string {
  const expanded = expandHomePath(path);
  if (!isAbsolute(expanded)) throw new Error(`path must be absolute: ${path}`);
  return expanded;
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
