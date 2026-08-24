import type { SessionId, WorkspaceId } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type { SessionPolicyOverride } from "../../policy.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "sidebar.workspaces": { kind: "single"; scope: "root"; owner: SidebarSectionOwnerProps };
    "sidebar.settings": { kind: "single"; scope: "root"; owner: SidebarSettingsOwnerProps };
    "sidebar.footer.action": { kind: "list"; scope: "root"; owner: SidebarFooterActionOwnerProps };
  }
}

export interface SidebarSectionOwnerProps {
  wide: boolean;
  expandSidebar: () => void;
  /**
   * Host directory paths whose Workspaces must be hidden from the sessions
   * browsing region: every project folder is surfaced only in the workbench
   * tab, so its Workspaces (and their sessions) never show under "会话".
   */
  hiddenWorkspacePaths?: readonly string[];
}

export interface SidebarSettingsOwnerProps {
  wide: boolean;
}

export interface SidebarFooterActionOwnerProps {
  wide: boolean;
}

export interface WorkbenchSidebarInjected {
  /** Create an ordinary chat in the preferred user-managed Workspace. */
  startSession: () => Promise<void>;
  startSpaceSession: (spaceId: string, override?: SessionPolicyOverride) => Promise<void>;
  /**
   * Enter (or create) the session bound to a project folder: registers the
   * folder as a Workspace when needed, then connects and opens its blank
   * session.
   */
  openProjectSession: (folderPath: string) => Promise<void>;
  /** Always start a fresh chat inside an already registered basic Workspace. */
  startProjectSession: (workspaceId: WorkspaceId) => Promise<void>;
  openSession: (sessionId: SessionId) => void;
  archiveSession: (sessionId: SessionId) => Promise<void>;
  removeBasicProject: (workspaceId: WorkspaceId) => Promise<void>;
  toggleSidebar: () => void;
}

export type WorkbenchSidebarSlotProps =
  & PropsRuntime<"sidebar">
  & PropsRenderSlots<"sidebar.settings" | "sidebar.footer.action">
  & WorkbenchSidebarInjected
  & PropsLocale<"dsh.workbench">;
