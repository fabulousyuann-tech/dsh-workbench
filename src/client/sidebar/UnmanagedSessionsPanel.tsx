import { useState } from "react";
import type {
  SessionId,
  SessionListState,
  WorkspaceId,
  WorkspaceListState,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { SnapshotSelectorHook } from "@deepseek-ai/dsh-client-ui-slots";
import {
  IconBrowseOutline16,
  IconChevronDownOutline14,
  IconPlusOutline16,
  IconTrashOutline16,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";

import type { WorkbenchKey } from "../locales.ts";
import { SessionList } from "./SessionList.tsx";
import {
  deriveBasicSessionPartition,
  isPathInside,
  type BasicSessionProject,
} from "./sessionOwnership.ts";
import "./UnmanagedSessionsPanel.css";

export function UnmanagedSessionsPanel({
  t,
  query,
  useSessions,
  useWorkspaces,
  managedRootPaths,
  openSession,
  archiveSession,
  openProjectSession,
  startProjectSession,
  pickDirectory,
  removeBasicProject,
}: {
  t: (key: WorkbenchKey) => string;
  query: string;
  useSessions: SnapshotSelectorHook<SessionListState>;
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>;
  managedRootPaths: readonly string[];
  openSession: (sessionId: SessionId) => void;
  archiveSession: (sessionId: SessionId) => Promise<void>;
  openProjectSession: (folderPath: string) => Promise<void>;
  startProjectSession: (workspaceId: WorkspaceId) => Promise<void>;
  pickDirectory: () => Promise<string | null>;
  removeBasicProject: (workspaceId: WorkspaceId) => Promise<void>;
}) {
  const sessions = useSessions((state) => state);
  const workspaces = useWorkspaces((state) => state);
  const partition = deriveBasicSessionPartition(
    sessions,
    workspaces.items,
    workspaces.archivedSessionIds,
    managedRootPaths,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleLoose = normalizedQuery === "" ? partition.loose : partition.loose.filter((session) =>
    session.title.toLocaleLowerCase().includes(normalizedQuery),
  );
  const visibleProjects = normalizedQuery === "" ? partition.projects : partition.projects.filter((project) =>
    project.title.toLocaleLowerCase().includes(normalizedQuery)
      || project.path.toLocaleLowerCase().includes(normalizedQuery)
      || project.sessions.some((session) => session.title.toLocaleLowerCase().includes(normalizedQuery)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const addProject = async (): Promise<void> => {
    const path = await pickDirectory();
    if (path === null) return;
    if (managedRootPaths.some((root) => isPathInside(path, root))) {
      setError(t("sessions.project.managed"));
      return;
    }
    setBusy(true); setError(undefined);
    try { await openProjectSession(path); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("sessions.project.addFailed")); }
    finally { setBusy(false); }
  };

  return (
    <section className="unmanagedSessions" aria-label={t("tab.sessions")}>
      <div className="unmanagedSessionsHeader">{t("sessions.recent")}</div>
      {sessions.phase === "pending" || workspaces.phase === "pending" ? (
        <div className="unmanagedSessionsEmpty">{t("sessions.loading")}</div>
      ) : visibleLoose.length === 0 ? (
        <div className="unmanagedSessionsEmpty compact">{t("sessions.empty")}</div>
      ) : (
        <SessionList
          sessions={visibleLoose}
          t={t}
          openSession={openSession}
          archiveSession={archiveSession}
        />
      )}

      <div className="basicProjectsHeading">
        <span>{t("sessions.projects")}</span>
        <Tooltip label={t("sessions.project.add")} delayMs={400}>
          <button
            type="button"
            className="basicProjectAdd"
            disabled={busy}
            aria-label={t("sessions.project.add")}
            onClick={() => { void addProject(); }}
          >
            <IconPlusOutline16 size={15} />
          </button>
        </Tooltip>
      </div>
      {error !== undefined && <div className="basicProjectError" role="alert">{error}</div>}
      {visibleProjects.length === 0 ? (
        <div className="unmanagedSessionsEmpty compact">{t("sessions.projects.empty")}</div>
      ) : visibleProjects.map((project) => (
        <BasicProjectGroup
          key={project.workspaceId}
          project={project}
          t={t}
          openProjectSession={openProjectSession}
          startProjectSession={startProjectSession}
          openSession={openSession}
          archiveSession={archiveSession}
          removeBasicProject={removeBasicProject}
        />
      ))}
    </section>
  );
}

function BasicProjectGroup({
  project,
  t,
  openProjectSession,
  startProjectSession,
  openSession,
  archiveSession,
  removeBasicProject,
}: {
  project: BasicSessionProject;
  t: (key: WorkbenchKey) => string;
  openProjectSession: (folderPath: string) => Promise<void>;
  startProjectSession: (workspaceId: WorkspaceId) => Promise<void>;
  openSession: (sessionId: SessionId) => void;
  archiveSession: (sessionId: SessionId) => Promise<void>;
  removeBasicProject: (workspaceId: WorkspaceId) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async (): Promise<void> => {
    if (!window.confirm(t("sessions.project.removeConfirm").replace("{title}", project.title))) return;
    setBusy(true);
    try { await removeBasicProject(project.workspaceId); }
    finally { setBusy(false); }
  };

  const createSession = async (): Promise<void> => {
    setBusy(true);
    try {
      await startProjectSession(project.workspaceId);
      setExpanded(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="basicProjectGroup">
      <div className="basicProjectRow">
        <button
          type="button"
          className="basicProjectExpand"
          aria-expanded={expanded}
          aria-label={`${t(expanded ? "sessions.project.collapse" : "sessions.project.expand")}: ${project.title}`}
          onClick={() => { setExpanded(!expanded); }}
        >
          <IconChevronDownOutline14 className={expanded ? "chevron open" : "chevron"} />
        </button>
        <button
          type="button"
          className="basicProjectMain"
          disabled={busy}
          title={project.path}
          aria-label={`${t("sessions.project.open")}: ${project.title}`}
          onClick={() => { void openProjectSession(project.path); }}
        >
          <IconBrowseOutline16 size={16} />
          <span>{project.title}</span>
          <small>{project.sessions.length}</small>
        </button>
        <Tooltip label={t("sessions.project.newChat")} delayMs={400}>
          <button
            type="button"
            className="basicProjectNew"
            disabled={busy}
            aria-label={`${t("sessions.project.newChat")}: ${project.title}`}
            onClick={() => { void createSession(); }}
          >
            <IconPlusOutline16 size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t("sessions.project.remove")} delayMs={400}>
          <button
            type="button"
            className="basicProjectRemove"
            disabled={busy}
            aria-label={`${t("sessions.project.remove")}: ${project.title}`}
            onClick={() => { void remove(); }}
          >
            <IconTrashOutline16 size={14} />
          </button>
        </Tooltip>
      </div>
      {expanded && (
        <div className="basicProjectSessions">
          {project.sessions.length === 0 ? (
            <div className="basicProjectNoChats">{t("sessions.project.noChats")}</div>
          ) : (
            <SessionList
              sessions={project.sessions}
              t={t}
              openSession={openSession}
              archiveSession={archiveSession}
              compact
            />
          )}
        </div>
      )}
    </div>
  );
}
