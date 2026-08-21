import type { ProjectFilter, ProjectStage } from "../types.ts";
import { PROJECT_STAGES } from "../types.ts";

export const WORKBENCH_STORAGE_KEY = "dsh-workbench/ui/v1";

export type SidebarTab = "sessions" | "workbench";

export interface WorkbenchUiState {
  schemaVersion: 1;
  selectedId: string | null;
  filter: ProjectFilter;
  query: string;
  sidebarTab: SidebarTab;
}

export const DEFAULT_UI_STATE: WorkbenchUiState = {
  schemaVersion: 1,
  selectedId: null,
  filter: "all",
  query: "",
  sidebarTab: "sessions",
};

export interface WorkbenchStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function browserWorkbenchStorage(): WorkbenchStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadWorkbenchUiState(storage: WorkbenchStorage | undefined): WorkbenchUiState {
  if (storage === undefined) return { ...DEFAULT_UI_STATE };
  try {
    const raw = storage.getItem(WORKBENCH_STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_UI_STATE };
    const parsed = JSON.parse(raw) as Partial<WorkbenchUiState>;
    const isFilter = (value: unknown): value is ProjectFilter =>
      value === "all" || (typeof value === "string" && PROJECT_STAGES.includes(value as ProjectStage));
    return {
      schemaVersion: 1,
      selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : null,
      filter: isFilter(parsed.filter) ? parsed.filter : "all",
      query: typeof parsed.query === "string" ? parsed.query : "",
      sidebarTab: parsed.sidebarTab === "workbench" ? "workbench" : "sessions",
    };
  } catch {
    return { ...DEFAULT_UI_STATE };
  }
}

export function saveWorkbenchUiState(
  storage: WorkbenchStorage | undefined,
  state: WorkbenchUiState,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
