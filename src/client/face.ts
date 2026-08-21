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

export interface WorkbenchViewFace {
  ready: () => boolean;
  listProjects: (query: string, filter: ProjectFilter) => Promise<{
    settings: WorkbenchSettings;
    customers: CustomerSummary[];
    projects: ProjectSummary[];
    revision: number;
  }>;
  getRevision: () => Promise<number>;
  getProject: (id: string) => Promise<ProjectDetail>;
  listProjectFiles: (request: ListProjectFilesRequest) => Promise<ProjectFilesResult>;
  updateProject: (request: UpdateProjectRequest) => Promise<ProjectDetail>;
  moveProject: (request: MoveProjectRequest) => Promise<ProjectDetail>;
  deleteProject: (id: string) => Promise<DeleteProjectResult>;
  getSettings: () => Promise<WorkbenchSettings>;
  listWorkspaces: () => Promise<WorkspaceListResult>;
  pickDirectory: () => Promise<string | null>;
  openPath: (path: string) => Promise<void>;
  setWorkspaceRoot: (path: string) => Promise<void>;
  refreshCatalog: () => Promise<unknown>;
  createProject: (request: { customerId: string; title: string; productLine?: string }) => Promise<CreateProjectResult>;
  createCustomer: (request: { name: string }) => Promise<CreateCustomerResult>;
  renameCustomer: (request: { id: string; name: string }) => Promise<RenameCustomerResult>;
  deleteCustomer: (id: string) => Promise<DeleteCustomerResult>;
  statistics: () => Promise<WorkbenchStatistics>;
  dueReminders: (request: DueRemindersRequest) => Promise<DueRemindersResult>;
}
