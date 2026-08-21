export type ProjectStage =
  | "opportunity"
  | "requirement"
  | "planning"
  | "execution"
  | "acceptance"
  | "retrospective";

export const PROJECT_STAGES: readonly ProjectStage[] = [
  "opportunity",
  "requirement",
  "planning",
  "execution",
  "acceptance",
  "retrospective",
];

/** 项目列表过滤：全部，或按项目阶段精确过滤。 */
export type ProjectFilter = "all" | ProjectStage;

/** 旧版客户端（阶段化过滤落地前）发送的 legacy 过滤值，服务端按 "all" 处理。 */
export type LegacyProjectFilter = "active" | "done" | "archived";

/** 边界（wire）层允许的过滤值：新值 + legacy 兼容值。 */
export type WireProjectFilter = ProjectFilter | LegacyProjectFilter;

/** 项目主文档 project.md 的 frontmatter 字段（简单 key: value 形式）。 */
export interface ProjectFrontmatter {
  title?: string;
  productLine?: string;
  stage?: ProjectStage;
  owner?: string;
  startedAt?: string;
  dueAt?: string;
  tags: string[];
}

/** 扫描出来的项目概要（M1）。 */
export interface ProjectSummary {
  id: string;
  folderPath: string;
  title: string;
  date?: string;
  createdMs: number;
  productLine?: string;
  stage: ProjectStage;
  owner?: string;
  startedAt?: string;
  dueAt?: string;
  tags: string[];
  hasProjectDoc: boolean;
  customerId: string;
  customerName: string;
  archived: boolean;
}

/** 客户及其下属项目。 */
export interface CustomerSummary {
  id: string;
  folderPath: string;
  name: string;
  hasCustomerDoc: boolean;
  projects: ProjectSummary[];
}

export interface WorkbenchSettings {
  workspaceRoot: string;
  rules?: string;
}

export interface ListProjectsResult {
  settings: WorkbenchSettings;
  customers: CustomerSummary[];
  projects: ProjectSummary[];
  revision: number;
}

export interface ProjectDetail extends ProjectSummary {
  projectMarkdown: string;
}

/** overlay 中每个项目只存"文件之外的工作台状态"。 */
export interface OverlayProject {
  title?: string;
  stage?: ProjectStage;
  owner?: string;
  productLine?: string;
  archived?: boolean;
}

export interface WorkbenchMember {
  uid: string;
  name: string;
}

export interface OverlayStore {
  schemaVersion: 1;
  workspaceRoot?: string;
  rules?: string;
  members: WorkbenchMember[];
  projects: Record<string, OverlayProject>;
  /** 最近使用过的工作空间根目录（MRU，最新在前）。 */
  recentWorkspaces?: string[];
}

export interface WorkspaceListResult {
  /** 当前工作空间根目录。 */
  current: string;
  /** 最近使用过、且不等于当前的其他工作空间根目录。 */
  workspaces: string[];
}

export interface CreateProjectRequest {
  customerId: string;
  title: string;
  productLine?: string;
  stage?: ProjectStage;
}

export interface CreateProjectResult {
  id: string;
  folderPath: string;
}

export interface UpdateProjectRequest {
  id: string;
  title?: string;
  stage?: ProjectStage;
  owner?: string;
  productLine?: string;
  archived?: boolean;
}

export interface MoveProjectRequest {
  id: string;
  customerId: string;
}

export interface DeleteProjectResult {
  id: string;
  trashedPath: string;
}

export interface DeleteCustomerResult {
  id: string;
  trashedPath: string;
  /** 随客户一起被移入回收站的项目数。 */
  projects: number;
}

export interface CreateCustomerRequest {
  name: string;
}

export interface CreateCustomerResult {
  id: string;
  folderPath: string;
}

export interface RenameCustomerRequest {
  id: string;
  name: string;
}

export interface RenameCustomerResult {
  id: string;
  folderPath: string;
  name: string;
}

export interface ListProjectsRequest {
  query: string;
  filter: WireProjectFilter;
}

export interface IdRequest {
  id: string;
}

export interface SetWorkspaceRootRequest {
  path: string;
}

/** 工作台统计快照（含归档项目）。 */
export interface WorkbenchStatistics {
  workspaceRoot: string;
  /** 全部项目数（含归档）。 */
  totalProjects: number;
  /** 未归档项目数。 */
  activeProjects: number;
  /** 已归档项目数。 */
  archivedProjects: number;
  /** 未归档且已交付（acceptance/retrospective）的项目数。 */
  doneProjects: number;
  /** 客户数。 */
  customers: number;
  /** 按阶段计数。 */
  byStage: Record<string, number>;
  /** 按客户计数（仅列出有项目的客户）。 */
  byCustomer: { id: string; name: string; count: number }[];
  /** 按产品线计数。 */
  byProductLine: { productLine: string; count: number }[];
  /** 按负责人计数。 */
  byOwner: { owner: string; count: number }[];
  /** 有到期日且已过期、未归档未完结的项目数。 */
  overdueProjects: number;
  /** 有到期日、7 天内到期、未归档未完结的项目数。 */
  dueSoonProjects: number;
}

export interface DueReminderItem {
  id: string;
  title: string;
  customerName: string;
  stage: ProjectStage;
  dueAt: string;
  /** 距离到期日的天数（负数表示已过期）。 */
  daysLeft: number;
  overdue: boolean;
  owner?: string;
}

export interface DueRemindersRequest {
  /** 提前提醒窗口（天），默认 7；0 只列出已过期。 */
  days?: number;
  /** 按客户名称（部分匹配）过滤。 */
  customer?: string;
}

export interface DueRemindersResult {
  workspaceRoot: string;
  horizonDays: number;
  /** 已过到期日且未归档未完结的项目。 */
  overdue: DueReminderItem[];
  /** 未来 horizonDays 天内到期且未归档未完结的项目。 */
  dueSoon: DueReminderItem[];
}

export interface BatchUpdateRequest {
  ids: string[];
  stage?: ProjectStage;
  owner?: string;
  productLine?: string;
  archived?: boolean;
  /** 批量变更所属客户（移动项目文件夹）。 */
  customerId?: string;
}

export interface BatchUpdateError {
  id: string;
  error: string;
}

export interface BatchUpdateResult {
  /** 成功处理的项目数。 */
  updated: number;
  /** 失败的项目数。 */
  failed: number;
  errors: BatchUpdateError[];
}

/** 项目文件的归集类别（按扩展名归类，便于查找）。 */
export type FileCategory =
  | "word"
  | "excel"
  | "ppt"
  | "pdf"
  | "text"
  | "image"
  | "archive"
  | "other";

/** 项目文件夹下的一个文件。 */
export interface ProjectFile {
  name: string;
  /** 相对项目文件夹的路径（/ 分隔）。 */
  relativePath: string;
  category: FileCategory;
  sizeBytes: number;
  modifiedMs: number;
}

export interface ListProjectFilesRequest {
  /** 项目 ID（项目文件夹名）。 */
  id: string;
  /** 按文件名 / 相对路径关键词过滤（部分匹配）。 */
  query?: string;
  /** 只返回指定类别的文件。 */
  category?: FileCategory;
}

export interface ProjectFilesResult {
  id: string;
  folderPath: string;
  /** 项目文档 project.md 本身会忽略，不参与归集。 */
  files: ProjectFile[];
  /** 各类别文件数。 */
  byCategory: Record<FileCategory, number>;
}
