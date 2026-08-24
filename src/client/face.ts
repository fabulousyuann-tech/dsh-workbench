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
} from "../types.ts";

export interface WorkbenchViewFace {
  ready: () => boolean;
  listProjects: (query: string, filter: ProjectFilter, signal?: AbortSignal) => Promise<{
    settings: WorkbenchSettings;
    customers: CustomerSummary[];
    projects: ProjectSummary[];
    revision: number;
  }>;
  getRevision: () => Promise<number>;
  getProject: (id: string, customerId?: string) => Promise<ProjectDetail>;
  listProjectFiles: (request: ListProjectFilesRequest) => Promise<ProjectFilesResult>;
  updateProject: (request: UpdateProjectRequest) => Promise<ProjectDetail>;
  moveProject: (request: MoveProjectRequest) => Promise<ProjectDetail>;
  deleteProject: (id: string, customerId?: string) => Promise<DeleteProjectResult>;
  getSettings: () => Promise<WorkbenchSettings>;
  listWorkspaces: () => Promise<WorkspaceListResult>;
  pickDirectory: () => Promise<string | null>;
  openPath: (path: string) => Promise<void>;
  setWorkspaceRoot: (path: string) => Promise<void>;
  /** 把已删除项目的目录路径加入持久隐藏列表（其 Workspace 从「会话」浏览区隐藏）。 */
  hideWorkspaces: (paths: string[]) => Promise<WorkbenchSettings>;
  refreshCatalog: () => Promise<unknown>;
  createProject: (request: { customerId: string; title: string; productLine?: string }) => Promise<CreateProjectResult>;
  createCustomer: (request: { name: string }) => Promise<CreateCustomerResult>;
  renameCustomer: (request: { id: string; name: string }) => Promise<RenameCustomerResult>;
  deleteCustomer: (id: string) => Promise<DeleteCustomerResult>;
  statistics: () => Promise<WorkbenchStatistics>;
  dueReminders: (request: DueRemindersRequest) => Promise<DueRemindersResult>;
  listSpaces: () => Promise<ListSpacesResult>;
  createSpace: (request: CreateSpaceRequest) => Promise<WorkbenchSpace>;
  updateSpace: (request: UpdateSpaceRequest) => Promise<WorkbenchSpace>;
  removeSpace: (spaceId: string) => Promise<void>;
  reorderSpaces: (spaceIds: string[]) => Promise<WorkbenchSpace[]>;
  setDefaultSpace: (spaceId: string) => Promise<WorkbenchSpace>;
  setSelectedSpace: (spaceId: string) => Promise<WorkbenchSpace>;
  updateSpacePolicy: (request: UpdateSpacePolicyRequest) => Promise<WorkbenchSpace>;
  getSpace: (spaceId: string) => Promise<WorkbenchSpace>;
  getSpacePolicy: (spaceId: string) => Promise<WorkbenchSpace["policy"]>;
  searchSpaces: (query: string) => Promise<SearchSpacesResult>;
  getAuxiliaryCapabilities: () => Promise<AuxiliaryCapabilitiesResult>;
  listModels: () => Promise<DshModelGroup[]>;
}
