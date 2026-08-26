import { useEffect, useMemo, useRef, useState } from "react";
import type {
  SessionId,
  SessionListState,
  WorkspaceListState,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { SnapshotSelectorHook } from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  IconCloseFill14,
  IconEditOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconBranchOutline16,
  IconListPenOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  Input,
  Menu,
  Modal,
  RiskConfirmation,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";

import type { CustomerSummary, ProjectSummary } from "../../types.ts";
import type { WorkbenchViewFace } from "../face.ts";
import type { WorkbenchKey } from "../locales.ts";
import { formatRelativeTime } from "../relativeTime.ts";
import { useLibraryEpoch } from "../selection.ts";
import { WorkbenchProjectDetail } from "../WorkbenchProjectDetail.tsx";
import { openProjectMap } from "../projectMap/store.ts";
import { SessionList } from "./SessionList.tsx";
import { deriveWorkbenchSessions, isPathInside, rebaseDirectoryFromAliases } from "./sessionOwnership.ts";
import "./WorkbenchSidebarPanel.css";

export function WorkbenchSidebarPanel({
  t,
  query,
  ready,
  startFolderSession,
  listProjects,
  getProject,
  listProjectFiles,
  updateProject,
  moveProject,
  deleteProject,
  openPath,
  refreshCatalog,
  createProject,
  createCustomer,
  renameCustomer,
  deleteCustomer,
  useSessions,
  useWorkspaces,
  openSession,
  archiveSession,
  selectedRootPath,
  selectedRootAliases,
  selectedSpaceName,
  selectedSpaceId,
  onProjectSessionOpen,
}: WorkbenchViewFace & {
  t: (key: WorkbenchKey) => string;
  query: string;
  startFolderSession: (folderPath: string) => Promise<void>;
  useSessions: SnapshotSelectorHook<SessionListState>;
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>;
  openSession: (sessionId: SessionId) => void;
  archiveSession: (sessionId: SessionId) => Promise<void>;
  selectedRootPath: string | undefined;
  selectedRootAliases: readonly string[];
  selectedSpaceName: string | undefined;
  selectedSpaceId: string | undefined;
  onProjectSessionOpen?: () => void;
}) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const toolbarRoot = useRef<HTMLDivElement>(null);
  const listAbort = useRef<AbortController>();
  const listRequestId = useRef(0);
  const listRequested = useRef(false);
  const libraryEpoch = useLibraryEpoch();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCustomerId, setCreateCustomerId] = useState("");
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerBusy, setCustomerBusy] = useState(false);
  const [customerError, setCustomerError] = useState<string | undefined>(undefined);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameId, setRenameId] = useState("");
  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | undefined>(undefined);
  const [detailTarget, setDetailTarget] = useState<ProjectSummary | null>(null);
  const [openingPath, setOpeningPath] = useState<string>();
  const [activeSessionPath, setActiveSessionPath] = useState<string>();
  const sessionState = useSessions((state) => state);
  const workspaceState = useWorkspaces((state) => state);
  const ownerTargets = customers.flatMap((customer) => [
    { id: customer.folderPath, path: customer.folderPath, kind: "customer" as const },
    ...customer.projects.map((project) => ({
      id: project.folderPath,
      path: project.folderPath,
      kind: "project" as const,
    })),
  ]);
  const managedSessions = deriveWorkbenchSessions(
    sessionState,
    workspaceState.items,
    workspaceState.archivedSessionIds,
    selectedRootPath,
    selectedRootAliases,
    ownerTargets,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRootSessions = normalizedQuery === ""
    ? managedSessions.root
    : managedSessions.root.filter((session) => session.title.toLocaleLowerCase().includes(normalizedQuery));
  const visibleCustomers = useMemo(() => customers.flatMap((customer) => {
    if (normalizedQuery === "") return [customer];
    const customerMatches = `${customer.name} ${customer.id}`.toLocaleLowerCase().includes(normalizedQuery);
    const customerSessionMatches = (managedSessions.byTargetId[customer.folderPath] ?? [])
      .some((session) => session.title.toLocaleLowerCase().includes(normalizedQuery));
    const projects = customer.projects.filter((project) => customerMatches
      || `${project.title} ${project.id}`.toLocaleLowerCase().includes(normalizedQuery)
      || (managedSessions.byTargetId[project.folderPath] ?? [])
        .some((session) => session.title.toLocaleLowerCase().includes(normalizedQuery)));
    return customerMatches || customerSessionMatches || projects.length > 0
      ? [{ ...customer, projects }]
      : [];
  }), [customers, managedSessions, normalizedQuery]);
  const currentSessionPath = sessionState.current === undefined
    ? undefined
    : workspaceState.items.find((workspace) => workspace.sessionIds.includes(sessionState.current!))?.path
      ?? sessionState.byId[sessionState.current]?.cwd;
  const effectiveActiveSessionPath = selectedRootPath === undefined
    ? currentSessionPath ?? activeSessionPath
    : rebaseDirectoryFromAliases(currentSessionPath ?? activeSessionPath, selectedRootPath, selectedRootAliases);

  const openDetail = (project: ProjectSummary): void => {
    setDetailTarget(project);
  };

  const createFolderSession = async (folderPath: string): Promise<void> => {
    if (openingPath !== undefined) return;
    setOpeningPath(folderPath); setError(undefined);
    try {
      await startFolderSession(folderPath);
      setActiveSessionPath(folderPath);
      onProjectSessionOpen?.();
    } catch (cause) {
      setError(`${t("session.openFailed")}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { setOpeningPath(undefined); }
  };

  const createProjectSession = (project: ProjectSummary): Promise<void> => createFolderSession(project.folderPath);
  const createCustomerSession = (customer: CustomerSummary): Promise<void> => createFolderSession(customer.folderPath);

  const loadList = async (nextQuery = query) => {
    if (!ready()) {
      setError(t("empty.remote"));
      setLoading(false);
      return;
    }
    listAbort.current?.abort();
    const controller = new AbortController();
    const requestId = ++listRequestId.current;
    listAbort.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      // Ownership must always be derived from the complete catalog. Filtering the
      // server response by session text can otherwise make managed sessions jump
      // temporarily to the Workbench root while the user searches.
      const result = await listProjects("", "all", controller.signal);
      if (controller.signal.aborted || requestId !== listRequestId.current) return;
      setCustomers(result.customers);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== listRequestId.current) return;
      setError(cause instanceof Error ? cause.message : t("empty.error"));
    } finally {
      if (requestId === listRequestId.current) {
        listAbort.current = undefined;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    listAbort.current?.abort();
    const delay = listRequested.current ? 350 : 0;
    listRequested.current = true;
    const handle = window.setTimeout(() => {
      void loadList(query);
    }, delay);
    return () => {
      window.clearTimeout(handle);
    };
  }, [query, libraryEpoch]);

  useEffect(() => () => {
    listAbort.current?.abort();
  }, []);

  useEffect(() => {
    if (!createMenuOpen) return;
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || toolbarRoot.current?.contains(event.target) === true) return;
      setCreateMenuOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("click", onClick); };
  }, [createMenuOpen]);

  const openCreate = (): void => {
    setCreateCustomerId(customers[0]?.id ?? "");
    setCreateOpen(true);
  };

  const closeCreate = (): void => {
    if (creating) return;
    setCreateOpen(false);
    setCreateName("");
    setCreateCustomerId("");
    setCreateError(undefined);
  };

  const onCreate = async () => {
    const title = createName.trim();
    if (title === "" || creating) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      await createProject({ customerId: createCustomerId, title });
      setCreateOpen(false);
      setCreateName("");
      await loadList(query);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : t("create.failed"));
    } finally {
      setCreating(false);
    }
  };

  const closeCustomerCreate = (): void => {
    if (customerBusy) return;
    setCustomerOpen(false);
    setCustomerName("");
    setCustomerError(undefined);
  };

  const onCustomerCreate = async () => {
    const name = customerName.trim();
    if (name === "" || customerBusy) return;
    setCustomerBusy(true);
    setCustomerError(undefined);
    try {
      await createCustomer({ name });
      setCustomerOpen(false);
      setCustomerName("");
      await loadList(query);
    } catch (cause) {
      setCustomerError(cause instanceof Error ? cause.message : t("customer.create.failed"));
    } finally {
      setCustomerBusy(false);
    }
  };

  const openRename = (customer: CustomerSummary): void => {
    setRenameId(customer.id);
    setRenameName(customer.name);
    setRenameError(undefined);
    setRenameOpen(true);
  };

  const closeRename = (): void => {
    if (renameBusy) return;
    setRenameOpen(false);
    setRenameId("");
    setRenameName("");
    setRenameError(undefined);
  };

  const onRename = async () => {
    const name = renameName.trim();
    if (name === "" || renameBusy || renameId === "") return;
    setRenameBusy(true);
    setRenameError(undefined);
    try {
      await renameCustomer({ id: renameId, name });
      setRenameOpen(false);
      setRenameId("");
      setRenameName("");
      await loadList(query);
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : t("customer.rename.failed"));
    } finally {
      setRenameBusy(false);
    }
  };

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomerSummary | null>(null);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const [projectDeleteOpen, setProjectDeleteOpen] = useState(false);
  const [projectDeleteTarget, setProjectDeleteTarget] = useState<ProjectSummary | null>(null);
  const [projectDeleteAcknowledged, setProjectDeleteAcknowledged] = useState(false);
  const [projectDeleteBusy, setProjectDeleteBusy] = useState(false);
  const [projectDeleteError, setProjectDeleteError] = useState<string | undefined>(undefined);

  const openDelete = (customer: CustomerSummary): void => {
    setDeleteTarget(customer);
    setDeleteAcknowledged(false);
    setDeleteError(undefined);
    setDeleteOpen(true);
  };

  const closeDelete = (): void => {
    if (deleteBusy) return;
    setDeleteOpen(false);
    setDeleteTarget(null);
    setDeleteError(undefined);
  };

  const onDeleteConfirm = async (): Promise<void> => {
    if (deleteTarget === null || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(undefined);
    try {
      await deleteCustomer(deleteTarget.id);
      setDeleteOpen(false);
      setDeleteTarget(null);
      await loadList(query);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : t("customer.deleteFailed"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const openProjectDelete = (project: ProjectSummary): void => {
    setProjectDeleteTarget(project);
    setProjectDeleteAcknowledged(false);
    setProjectDeleteError(undefined);
    setProjectDeleteOpen(true);
  };

  const closeProjectDelete = (): void => {
    if (projectDeleteBusy) return;
    setProjectDeleteOpen(false);
    setProjectDeleteTarget(null);
    setProjectDeleteError(undefined);
  };

  const onProjectDeleteConfirm = async (): Promise<void> => {
    if (projectDeleteTarget === null || projectDeleteBusy) return;
    setProjectDeleteBusy(true); setProjectDeleteError(undefined);
    try {
      await deleteProject(projectDeleteTarget.id, projectDeleteTarget.customerId);
      if (activeSessionPath === projectDeleteTarget.folderPath) setActiveSessionPath(undefined);
      setProjectDeleteOpen(false); setProjectDeleteTarget(null);
      await loadList(query);
    } catch (cause) {
      setProjectDeleteError(cause instanceof Error ? cause.message : t("detail.lifecycleError"));
    } finally { setProjectDeleteBusy(false); }
  };

  const activeProject = customers.flatMap((customer) => customer.projects).find((project) =>
    isPathInside(effectiveActiveSessionPath, project.folderPath),
  );
  const activeCustomer = customers.find((customer) =>
    isPathInside(effectiveActiveSessionPath, customer.folderPath)
      || customer.projects.some((project) => project.folderPath === activeProject?.folderPath),
  );

  return (
    <div className="workbenchPanel" data-surface="workbench-panel" aria-label={selectedSpaceName ?? t("tab")}>
      {(activeCustomer !== undefined || activeProject !== undefined) && (
        <div className="workbenchContextTrail">
          <span>{activeCustomer?.name}</span>
          {activeProject !== undefined && <><span aria-hidden="true">›</span><strong>{activeProject.title}</strong></>}
        </div>
      )}
      <div ref={toolbarRoot} className="workbenchControls">
        <div className="workbenchInlineToolbar">
          <div className="toolbarMenuWrap primaryCreateWrap">
            <Tooltip label={t("toolbar.addCustomerOrProject")} delayMs={400}>
              <button
                type="button"
                className="inlineCreateMenuButton"
                aria-label={t("toolbar.addCustomerOrProject")}
                aria-expanded={createMenuOpen}
                onClick={() => { setCreateMenuOpen(!createMenuOpen); }}
              >
                <IconPlusOutline16 size={15} />
              </button>
            </Tooltip>
            {createMenuOpen && <div className="toolbarPopover createPopover" role="menu">
              <button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); setCustomerOpen(true); }}>{t("toolbar.customer.new")}</button>
              <button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); if (customers.length === 0) { setError(t("create.needCustomer")); return; } openCreate(); }}>{t("toolbar.create")}</button>
            </div>}
          </div>
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={closeCreate}
        title={t("create.title")}
        closeLabel={t("create.cancel")}
        footer={(
          <>
            <Button variant="outline" disabled={creating} onClick={closeCreate}>
              {t("create.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={creating || createName.trim() === "" || createCustomerId === ""}
              onClick={() => { void onCreate(); }}
            >
              {t("create.confirm")}
            </Button>
          </>
        )}
      >
        <div data-plugin="dsh-workbench" data-surface="create-dialog">
          <div className="createField">
            <label className="createLabel" htmlFor="wb-create-name">{t("create.name")}</label>
            <Input
              id="wb-create-name"
              className="createInput"
              value={createName}
              placeholder={t("create.name.placeholder")}
              autoFocus={true}
              disabled={creating}
              onChange={(event) => { setCreateName(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void onCreate();
              }}
            />
          </div>
          <div className="createField">
            <label className="createLabel" htmlFor="wb-create-customer">{t("create.customer")}</label>
            <select
              id="wb-create-customer"
              className="createSelect"
              value={createCustomerId}
              disabled={creating}
              onChange={(event) => { setCreateCustomerId(event.target.value); }}
            >
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </div>
          {createError !== undefined && <div className="createError">{createError}</div>}
        </div>
      </Modal>

      <Modal
        open={customerOpen}
        onClose={closeCustomerCreate}
        title={t("customer.create.title")}
        closeLabel={t("customer.create.cancel")}
        footer={(
          <>
            <Button variant="outline" disabled={customerBusy} onClick={closeCustomerCreate}>
              {t("customer.create.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={customerBusy || customerName.trim() === ""}
              onClick={() => { void onCustomerCreate(); }}
            >
              {t("customer.create.confirm")}
            </Button>
          </>
        )}
      >
        <div data-plugin="dsh-workbench" data-surface="customer-dialog">
          <div className="createField">
            <label className="createLabel" htmlFor="wb-customer-name">{t("customer.create.name")}</label>
            <Input
              id="wb-customer-name"
              className="createInput"
              value={customerName}
              placeholder={t("customer.create.name.placeholder")}
              autoFocus={true}
              disabled={customerBusy}
              onChange={(event) => { setCustomerName(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void onCustomerCreate();
              }}
            />
          </div>
          {customerError !== undefined && <div className="createError">{customerError}</div>}
        </div>
      </Modal>

      <Modal
        open={renameOpen}
        onClose={closeRename}
        title={t("customer.rename.title")}
        closeLabel={t("customer.rename.cancel")}
        footer={(
          <>
            <Button variant="outline" disabled={renameBusy} onClick={closeRename}>
              {t("customer.rename.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={renameBusy || renameName.trim() === ""}
              onClick={() => { void onRename(); }}
            >
              {t("customer.rename.confirm")}
            </Button>
          </>
        )}
      >
        <div data-plugin="dsh-workbench" data-surface="customer-dialog">
          <div className="createField">
            <label className="createLabel" htmlFor="wb-customer-rename">{t("customer.rename.name")}</label>
            <Input
              id="wb-customer-rename"
              className="createInput"
              value={renameName}
              placeholder={t("customer.rename.name.placeholder")}
              autoFocus={true}
              disabled={renameBusy}
              onChange={(event) => { setRenameName(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void onRename();
              }}
            />
          </div>
          {renameError !== undefined && <div className="createError">{renameError}</div>}
        </div>
      </Modal>

      <div className="workbenchList">
        {error !== undefined && <div className="workbenchEmpty">{error}</div>}
        {error === undefined && customers.length === 0 && !loading && (
          <div className="workbenchEmpty">
            <div>{t("empty.customers")}</div>
          </div>
        )}
        {error === undefined && customers.length > 0 && visibleCustomers.length === 0
          && visibleRootSessions.length === 0 && !loading && (
          <div className="workbenchEmpty">{t("empty.noMatch")}</div>
        )}
        {visibleRootSessions.length > 0 && (
          <div className="managedSessionSection">
            <div className="managedSessionSectionTitle">{t("sessions.workbench")}</div>
            <SessionList
              sessions={visibleRootSessions}
              t={t}
              openSession={openSession}
              archiveSession={archiveSession}
            />
          </div>
        )}
        {visibleCustomers.map((customer) => (
          <CustomerGroup
            key={customer.id}
            customer={customer}
            t={t}
            onCreate={createProjectSession}
            onCreateCustomerSession={createCustomerSession}
            onOpenDetail={openDetail}
            openingPath={openingPath}
            activeSessionPath={effectiveActiveSessionPath}
            onRename={openRename}
            onDelete={openDelete}
            onDeleteProject={openProjectDelete}
            customerSessions={managedSessions.byTargetId[customer.folderPath] ?? []}
            sessionsByProjectId={managedSessions.byTargetId}
            openSession={openSession}
            archiveSession={archiveSession}
            forceExpanded={normalizedQuery !== ""}
            selectedSpaceId={selectedSpaceId}
            selectedSpaceName={selectedSpaceName}
            selectedRootPath={selectedRootPath}
            selectedRootAliases={selectedRootAliases}
          />
        ))}
      </div>

      <RiskConfirmation
        open={deleteOpen}
        title={t("customer.delete.title")}
        description={[
          deleteTarget === null ? t("customer.deleteHint") : `${t("customer.deletePrompt").replace("{name}", deleteTarget.name)} ${t("customer.deleteHint")}`,
          deleteError,
        ].filter(Boolean).join(" ")}
        acknowledgeLabel={t("detail.deleteAcknowledge")}
        cancelLabel={t("detail.cancel")}
        confirmLabel={t("customer.deleteConfirm")}
        acknowledged={deleteAcknowledged}
        disabled={deleteBusy}
        onAcknowledgedChange={setDeleteAcknowledged}
        onCancel={closeDelete}
        onConfirm={() => { void onDeleteConfirm(); }}
      />

      <RiskConfirmation
        open={projectDeleteOpen}
        title={t("detail.delete.title")}
        description={[t("detail.deletePrompt"), t("detail.deleteHint"), projectDeleteError].filter(Boolean).join(" ")}
        acknowledgeLabel={t("detail.deleteAcknowledge")}
        cancelLabel={t("detail.cancel")}
        confirmLabel={t("detail.deleteConfirm")}
        acknowledged={projectDeleteAcknowledged}
        disabled={projectDeleteBusy}
        onAcknowledgedChange={setProjectDeleteAcknowledged}
        onCancel={closeProjectDelete}
        onConfirm={() => { void onProjectDeleteConfirm(); }}
      />

      {detailTarget !== null && (
        <WorkbenchProjectDetail
          getProject={getProject}
          listProjectFiles={listProjectFiles}
          updateProject={updateProject}
          moveProject={moveProject}
          deleteProject={deleteProject}
          openPath={openPath}
          t={t}
          customers={customers}
          projectId={detailTarget.id}
          customerId={detailTarget.customerId}
          onClose={() => { setDetailTarget(null); }}
          onSaved={() => { void loadList(query); }}
        />
      )}
    </div>
  );
}

function CustomerGroup({
  customer,
  t,
  onCreate,
  onCreateCustomerSession,
  onOpenDetail,
  openingPath,
  activeSessionPath,
  onRename,
  onDelete,
  onDeleteProject,
  customerSessions,
  sessionsByProjectId,
  openSession,
  archiveSession,
  forceExpanded,
  selectedSpaceId,
  selectedSpaceName,
  selectedRootPath,
  selectedRootAliases,
}: {
  customer: CustomerSummary;
  t: (key: WorkbenchKey) => string;
  onCreate: (project: ProjectSummary) => Promise<void>;
  onCreateCustomerSession: (customer: CustomerSummary) => Promise<void>;
  onOpenDetail: (project: ProjectSummary) => void;
  openingPath: string | undefined;
  activeSessionPath: string | undefined;
  onRename: (customer: CustomerSummary) => void;
  onDelete: (customer: CustomerSummary) => void;
  onDeleteProject: (project: ProjectSummary) => void;
  customerSessions: ReturnType<typeof deriveWorkbenchSessions>["root"];
  sessionsByProjectId: ReturnType<typeof deriveWorkbenchSessions>["byTargetId"];
  openSession: (sessionId: SessionId) => void;
  archiveSession: (sessionId: SessionId) => Promise<void>;
  forceExpanded: boolean;
  selectedSpaceId: string | undefined;
  selectedSpaceName: string | undefined;
  selectedRootPath: string | undefined;
  selectedRootAliases: readonly string[];
}) {
  const activeWithin = isPathInside(activeSessionPath, customer.folderPath);
  const [expandedOverride, setExpandedOverride] = useState<boolean>();
  const shownExpanded = expandedOverride ?? (forceExpanded || activeWithin);
  const hasContents = customer.projects.length > 0 || customerSessions.length > 0;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setExpandedOverride(undefined);
  }, [activeWithin, forceExpanded]);

  return (
    <div className="customerGroup">
      <div className={activeSessionPath === customer.folderPath ? "customerHeader sessionActive" : "customerHeader"}>
        <button
          type="button"
          className="customerToggle"
          title={t(shownExpanded ? "customer.collapse" : "customer.expand")}
          aria-label={`${t(shownExpanded ? "customer.collapse" : "customer.expand")}: ${customer.name}`}
          aria-expanded={shownExpanded}
          onClick={() => { setExpandedOverride(!shownExpanded); }}
        >
          <span className="customerIcon">
            {shownExpanded ? <IconFolderOpen16 size={15} /> : <IconFolderClose16 size={15} />}
          </span>
          <span className="customerName">{customer.name}</span>
          <span className="customerCount">{t("customer.projects").replace("{n}", String(customer.projects.length))}</span>
        </button>
        <Tooltip label={t("sessions.customer.newChat")} delayMs={400}>
          <button
            type="button"
            className="rowAction customerNewSessionAction"
            aria-label={`${t("sessions.customer.newChat")}: ${customer.name}`}
            disabled={openingPath !== undefined}
            onClick={() => { void onCreateCustomerSession(customer); }}
          >
            <IconPlusOutline16 size={15} />
          </button>
        </Tooltip>
        <Menu
          className="customerMoreMenuRoot"
          open={menuOpen}
          portal
          compact
          align="end"
          anchor={(
            <Tooltip label={t("customer.more")} delayMs={400} disabled={menuOpen}>
              <button
                type="button"
                className="rowAction customerMoreAction"
                aria-label={`${t("customer.more")}: ${customer.name}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => { setMenuOpen(!menuOpen); }}
              >
                <span className="projectMoreGlyph" aria-hidden="true">…</span>
              </button>
            </Tooltip>
          )}
          items={[
            { id: "rename", label: t("customer.rename"), icon: <IconEditOutline16 size={15} /> },
            { type: "separator", id: "destructive" },
            { id: "delete", label: t("customer.delete"), icon: <IconTrashOutline16 size={15} />, danger: true },
          ]}
          onClose={() => { setMenuOpen(false); }}
          onSelect={(id) => {
            setMenuOpen(false);
            if (id === "rename") onRename(customer);
            else if (id === "delete") onDelete(customer);
          }}
        />
      </div>
      {shownExpanded && (
        <div className="customerProjects">
          {!hasContents && <div className="customerEmpty">{t("empty.noMatch")}</div>}
          {customerSessions.length > 0 && (
            <SessionList
              sessions={customerSessions}
              t={t}
              openSession={openSession}
              archiveSession={archiveSession}
              compact
            />
          )}
          {customer.projects.map((project) => (
            <ProjectSessionGroup
              key={project.id}
              project={project}
              selected={isPathInside(activeSessionPath, project.folderPath)}
              opening={openingPath === project.folderPath}
              sessions={sessionsByProjectId[project.folderPath] ?? []}
              t={t}
              onCreate={() => { void onCreate(project); }}
              onOpenDetail={() => { onOpenDetail(project); }}
              onOpenMap={() => {
                if (selectedSpaceId === undefined || selectedRootPath === undefined) return;
                openProjectMap({
                  spaceId: selectedSpaceId,
                  spaceName: selectedSpaceName ?? selectedRootPath,
                  rootPath: selectedRootPath,
                  rootAliases: selectedRootAliases,
                  customerId: project.customerId,
                  customerName: project.customerName,
                  projectId: project.id,
                  projectTitle: project.title,
                  projectPath: project.folderPath,
                });
              }}
              onDelete={() => { onDeleteProject(project); }}
              openSession={openSession}
              archiveSession={archiveSession}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectSessionGroup({
  project,
  selected,
  opening,
  sessions,
  t,
  onCreate,
  onOpenDetail,
  onOpenMap,
  onDelete,
  openSession,
  archiveSession,
}: {
  project: ProjectSummary;
  selected: boolean;
  opening: boolean;
  sessions: ReturnType<typeof deriveWorkbenchSessions>["root"];
  t: (key: WorkbenchKey) => string;
  onCreate: () => void;
  onOpenDetail: () => void;
  onOpenMap: () => void;
  onDelete: () => void;
  openSession: (sessionId: SessionId) => void;
  archiveSession: (sessionId: SessionId) => Promise<void>;
}) {
  const [expandedOverride, setExpandedOverride] = useState<boolean>();
  const expanded = expandedOverride ?? selected;

  useEffect(() => {
    setExpandedOverride(undefined);
  }, [selected]);

  return (
    <div className="projectSessionGroup">
      <ProjectRow
        project={project}
        selected={selected}
        opening={opening}
        expanded={expanded}
        t={t}
        onToggle={() => { setExpandedOverride(!expanded); }}
        onCreate={() => { setExpandedOverride(true); onCreate(); }}
        onOpenDetail={onOpenDetail}
        onOpenMap={onOpenMap}
        onDelete={onDelete}
      />
      {expanded && sessions.length > 0 && (
        <SessionList sessions={sessions} t={t} openSession={openSession} archiveSession={archiveSession} compact />
      )}
    </div>
  );
}

function ProjectRow({
  project,
  selected,
  opening,
  expanded,
  t,
  onToggle,
  onCreate,
  onOpenDetail,
  onOpenMap,
  onDelete,
}: {
  project: ProjectSummary;
  selected: boolean;
  opening: boolean;
  expanded: boolean;
  t: (key: WorkbenchKey) => string;
  onToggle: () => void;
  onCreate: () => void;
  onOpenDetail: () => void;
  onOpenMap: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={selected ? "projectRow selected" : "projectRow"}>
      <button
        type="button"
        className="projectRowMain"
        title={t(expanded ? "sessions.project.collapse" : "sessions.project.expand")}
        aria-label={`${t(expanded ? "sessions.project.collapse" : "sessions.project.expand")}: ${project.title}`}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="rowIcon">
          {expanded
            ? <IconFolderOpen16 className="projectFallback" size={16} />
            : <IconFolderClose16 className="projectFallback" size={16} />}
        </span>
        <span className="rowBody">
          <span className="rowTitle">
            <span className="rowTitleText">{project.title}</span>
            {project.archived && <span className="rowArchivedBadge">{t("detail.archivedBadge")}</span>}
          </span>
          <span className="rowMeta">
            <span className="rowDate">{formatRelativeTime(project.createdMs, Date.now(), t)}</span>
          </span>
        </span>
      </button>
      <Tooltip label={t("sessions.project.newChat")} delayMs={400}>
        <button
          type="button"
          className="rowAction projectNewSessionAction"
          aria-label={`${t("sessions.project.newChat")}: ${project.title}`}
          disabled={opening}
          onClick={onCreate}
        >
          <IconPlusOutline16 size={15} />
        </button>
      </Tooltip>
      <Menu
        className="projectMoreMenuRoot"
        open={menuOpen}
        portal
        compact
        align="end"
        anchor={(
          <Tooltip label={t("project.more")} delayMs={400} disabled={menuOpen}>
            <button
              type="button"
              className="rowAction projectMoreAction"
              aria-label={`${t("project.more")}: ${project.title}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => { setMenuOpen(!menuOpen); }}
            >
              <span className="projectMoreGlyph" aria-hidden="true">…</span>
            </button>
          </Tooltip>
        )}
        items={[
          { id: "overview", label: t("project.overview"), icon: <IconListPenOutline16 size={15} /> },
          { id: "map", label: t("project.map"), icon: <IconBranchOutline16 size={15} /> },
          { type: "separator", id: "destructive" },
          { id: "delete", label: t("detail.delete"), icon: <IconTrashOutline16 size={15} />, danger: true },
        ]}
        onClose={() => { setMenuOpen(false); }}
        onSelect={(id) => {
          setMenuOpen(false);
          if (id === "overview") onOpenDetail();
          else if (id === "map") onOpenMap();
          else if (id === "delete") onDelete();
        }}
      />
    </div>
  );
}
