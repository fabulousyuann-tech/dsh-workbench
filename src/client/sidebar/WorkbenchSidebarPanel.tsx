import { useEffect, useRef, useState } from "react";
import {
  Button,
  IconBrowseOutline16,
  IconChevronDownOutline14,
  IconCloseFill14,
  IconDataOutline16,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconProjectAddOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  Input,
  Modal,
  RiskConfirmation,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";

import type { CustomerSummary, ProjectFilter, ProjectSummary } from "../../types.ts";
import { PROJECT_STAGES } from "../../types.ts";
import type { WorkbenchViewFace } from "../face.ts";
import type { WorkbenchKey } from "../locales.ts";
import { formatRelativeTime } from "../relativeTime.ts";
import { useLibraryEpoch, useSelectedId } from "../selection.ts";
import { WorkbenchDashboard } from "../WorkbenchDashboard.tsx";
import { WorkbenchProjectDetail } from "../WorkbenchProjectDetail.tsx";
import "./WorkbenchSidebarPanel.css";

export function WorkbenchSidebarPanel({
  t,
  ready,
  openProjectSession,
  listProjects,
  listWorkspaces,
  setWorkspaceRoot,
  pickDirectory,
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
  statistics,
  dueReminders,
}: WorkbenchViewFace & {
  t: (key: WorkbenchKey) => string;
  openProjectSession: (folderPath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRoot = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const libraryEpoch = useLibraryEpoch();
  const [selectedId, setSelectedId] = useSelectedId();
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
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
  const [detailId, setDetailId] = useState<string | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [wsRoot, setWsRoot] = useState("");
  const [wsList, setWsList] = useState<string[]>([]);
  const [wsBusy, setWsBusy] = useState(false);
  const [wsError, setWsError] = useState<string | undefined>(undefined);
  const wsRootRef = useRef<HTMLDivElement>(null);

  const openDetail = (id: string): void => {
    setSelectedId(id);
    setDetailId(id);
  };

  const enterProject = (project: ProjectSummary): void => {
    setSelectedId(project.id);
    openProjectSession(project.folderPath);
  };

  const loadList = async (nextQuery = query, nextFilter = filter) => {
    if (!ready()) {
      setError(t("empty.remote"));
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const result = await listProjects(nextQuery, nextFilter);
      setCustomers(result.customers);
      const currentId = selectedIdRef.current;
      if (nextQuery === "" && currentId !== null && !result.projects.some((project) => project.id === currentId)) {
        setSelectedId(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("empty.error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadList(query, filter);
    }, 200);
    return () => {
      window.clearTimeout(handle);
    };
  }, [query, filter, libraryEpoch]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInput.current?.focus({ preventScroll: true });
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) {
        return;
      }
      searchInput.current?.blur();
      if (query !== "") return;
      setSearchOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("click", onClick); };
  }, [searchOpen, query]);

  const loadWorkspaces = async () => {
    if (!ready()) return;
    try {
      const result = await listWorkspaces();
      setWsRoot(result.current);
      setWsList(result.workspaces);
    } catch {
      setWsRoot("");
      setWsList([]);
    }
  };

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadWorkspaces();
    }, 200);
    return () => {
      window.clearTimeout(handle);
    };
  }, [libraryEpoch]);

  useEffect(() => {
    if (!wsOpen) return;
    const onClick = (event: MouseEvent): void => {
      if (wsRootRef.current?.contains(event.target as Node) === true) return;
      setWsOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("click", onClick); };
  }, [wsOpen]);

  const switchWorkspace = async (path: string) => {
    if (wsBusy || path === wsRoot) {
      setWsOpen(false);
      return;
    }
    setWsBusy(true);
    setWsError(undefined);
    try {
      await setWorkspaceRoot(path);
      setWsRoot(path);
      setWsOpen(false);
    } catch (cause) {
      setWsError(cause instanceof Error ? cause.message : t("workspace.switchFailed"));
    } finally {
      setWsBusy(false);
    }
  };

  const pickWorkspace = async () => {
    const path = await pickDirectory();
    if (path === null) return;
    await switchWorkspace(path);
  };

  const closeSearch = (): void => {
    setQuery("");
    setSearchOpen(false);
  };

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
      await loadList(query, filter);
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
      await loadList(query, filter);
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
      await loadList(query, filter);
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
      await loadList(query, filter);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : t("customer.deleteFailed"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const filterOptions: Array<{ value: ProjectFilter; label: WorkbenchKey }> = [
    { value: "all", label: "filter.all" },
    ...PROJECT_STAGES.map((stage) => ({ value: stage, label: `stage.${stage}` as WorkbenchKey })),
  ];

  const chooseFilter = (value: ProjectFilter): void => {
    setFilter(value);
  };

  return (
    <div className="workbenchPanel" data-surface="workbench-panel">
      <div className="workbenchHeader">
        <div className={searchOpen ? "searchSlot expanded" : "searchSlot"}>
          <div
            ref={searchRoot}
            className={searchOpen ? "workbenchSearch expanded" : "workbenchSearch"}
            onClick={() => {
              if (searchOpen) return;
              setSearchOpen(true);
            }}
          >
            <Tooltip label={t("toolbar.search")} delayMs={500} disabled={searchOpen}>
              <button
                type="button"
                className="searchButton"
                aria-label={t("toolbar.search.aria")}
                aria-expanded={searchOpen}
                onClick={() => { setSearchOpen(true); }}
              >
                <IconSearchOutline16 size={searchOpen ? 11 : 14} />
              </button>
            </Tooltip>
            <input
              ref={searchInput}
              className="searchInput"
              value={query}
              placeholder={t("toolbar.search")}
              tabIndex={searchOpen ? 0 : -1}
              onChange={(event) => { setQuery(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                closeSearch();
              }}
            />
            {searchOpen && (
              <button
                type="button"
                className="clearButton"
                aria-label={t("toolbar.search.clear")}
                onClick={(event) => {
                  event.stopPropagation();
                  closeSearch();
                }}
              >
                <IconCloseFill14 />
              </button>
            )}
          </div>
        </div>
        <div className={searchOpen ? "headerActions hidden" : "headerActions"}>
          <Tooltip label={t("toolbar.customer.new")} delayMs={500}>
            <button
              type="button"
              className="iconButton"
              aria-label={t("toolbar.customer.new")}
              onClick={() => { setCustomerOpen(true); }}
            >
              <IconFolderOpenOutline16 size={16} />
            </button>
          </Tooltip>
          <Tooltip label={t("toolbar.refresh")} delayMs={500}>
            <button
              type="button"
              className="iconButton"
              aria-label={t("toolbar.refresh")}
              onClick={() => {
                void refreshCatalog().then(() => loadList(query, filter));
              }}
            >
              <IconRefreshOutline16 size={16} />
            </button>
          </Tooltip>
          <Tooltip label={t("toolbar.create")} delayMs={500}>
            <button
              type="button"
              className="iconButton"
              aria-label={t("toolbar.create.aria")}
              onClick={() => {
                if (customers.length === 0) {
                  setError(t("create.needCustomer"));
                  return;
                }
                openCreate();
              }}
            >
              <IconProjectAddOutline16 size={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="workspaceBar" ref={wsRootRef}>
        <button
          type="button"
          className="workspaceButton"
          aria-label={t("workspace.switch.title")}
          aria-expanded={wsOpen}
          title={wsRoot === "" ? undefined : wsRoot}
          onClick={() => { setWsOpen(!wsOpen); }}
        >
          <IconFolderOpenOutline16 size={14} />
          <span className="workspaceName">
            {wsRoot === "" ? t("workspace.switch.title") : workspaceBasename(wsRoot)}
          </span>
          <IconChevronDownOutline14 className={wsOpen ? "workspaceChevron open" : "workspaceChevron"} />
        </button>
        {wsOpen && (
          <div className="workspaceMenu">
            <div className="workspaceMenuLabel">{t("workspace.current")}</div>
            <div className="workspaceCurrentPath" title={wsRoot}>{wsRoot}</div>
            {wsList.length === 0 ? (
              <div className="workspaceEmpty">{t("workspace.empty")}</div>
            ) : (
              <>
                <div className="workspaceMenuLabel">{t("workspace.recent")}</div>
                {wsList.map((path) => (
                  <button
                    key={path}
                    type="button"
                    className="workspaceItem"
                    disabled={wsBusy}
                    title={path}
                    onClick={() => { void switchWorkspace(path); }}
                  >
                    <span className="workspaceItemName">{workspaceBasename(path)}</span>
                    <span className="workspaceItemPath">{path}</span>
                  </button>
                ))}
              </>
            )}
            {wsError !== undefined && <div className="workspaceError">{wsError}</div>}
            <div className="workspaceMenuDivider" />
            <button
              type="button"
              className="workspaceItem pick"
              disabled={wsBusy}
              onClick={() => { void pickWorkspace(); }}
            >
              <IconProjectAddOutline16 size={14} />
              <span className="workspaceItemName">{t("workspace.pick")}</span>
            </button>
          </div>
        )}
      </div>

      <WorkbenchDashboard
        ready={ready}
        statistics={statistics}
        dueReminders={dueReminders}
        t={t}
        onOpenProject={(id) => { openDetail(id); }}
      />

      <div className="filterRow" role="tablist" aria-label="filter">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            className={filter === option.value ? "filterButton active" : "filterButton"}
            onClick={() => { chooseFilter(option.value); }}
          >
            {t(option.label)}
          </button>
        ))}
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
            <button
              type="button"
              className="emptyCreateCustomer"
              onClick={() => { setCustomerOpen(true); }}
            >
              {t("toolbar.customer.new")}
            </button>
          </div>
        )}
        {customers.map((customer) => (
          <CustomerGroup
            key={customer.id}
            customer={customer}
            selectedId={selectedId}
            t={t}
            onEnter={enterProject}
            onOpenDetail={openDetail}
            onRename={openRename}
            onDelete={openDelete}
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

      {detailId !== null && (
        <WorkbenchProjectDetail
          getProject={getProject}
          listProjectFiles={listProjectFiles}
          updateProject={updateProject}
          moveProject={moveProject}
          deleteProject={deleteProject}
          openPath={openPath}
          t={t}
          customers={customers}
          projectId={detailId}
          onClose={() => { setDetailId(null); }}
          onSaved={() => { void loadList(query, filter); }}
        />
      )}
    </div>
  );
}

function CustomerGroup({
  customer,
  selectedId,
  t,
  onEnter,
  onOpenDetail,
  onRename,
  onDelete,
}: {
  customer: CustomerSummary;
  selectedId: string | null;
  t: (key: WorkbenchKey) => string;
  onEnter: (project: ProjectSummary) => void;
  onOpenDetail: (id: string) => void;
  onRename: (customer: CustomerSummary) => void;
  onDelete: (customer: CustomerSummary) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasProjects = customer.projects.length > 0;

  return (
    <div className="customerGroup">
      <div className="customerHeader">
        <button
          type="button"
          className="customerToggle"
          aria-expanded={expanded}
          onClick={() => { setExpanded(!expanded); }}
        >
          <span className={expanded ? "chevron open" : "chevron"}>›</span>
          <span className="customerName">{customer.name}</span>
          <span className="customerCount">{t("customer.projects").replace("{n}", String(customer.projects.length))}</span>
        </button>
        <button
          type="button"
          className="customerRename"
          aria-label={`${t("customer.rename")}: ${customer.name}`}
          title={t("customer.rename")}
          onClick={() => { onRename(customer); }}
        >
          <IconEditOutline16 size={14} />
        </button>
        <button
          type="button"
          className="customerDelete"
          aria-label={`${t("customer.delete")}: ${customer.name}`}
          title={t("customer.delete")}
          onClick={() => { onDelete(customer); }}
        >
          <IconTrashOutline16 size={14} />
        </button>
      </div>
      {expanded && (
        <div className="customerProjects">
          {!hasProjects && <div className="customerEmpty">{t("empty.noMatch")}</div>}
          {customer.projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              selected={project.id === selectedId}
              t={t}
              onEnter={() => { onEnter(project); }}
              onOpenDetail={() => { onOpenDetail(project.id); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function workspaceBasename(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] ?? cleaned;
}

function ProjectRow({
  project,
  selected,
  t,
  onEnter,
  onOpenDetail,
}: {
  project: ProjectSummary;
  selected: boolean;
  t: (key: WorkbenchKey) => string;
  onEnter: () => void;
  onOpenDetail: () => void;
}) {
  return (
    <div className={selected ? "projectRow selected" : "projectRow"}>
      <button
        type="button"
        className="projectRowMain"
        title={t("project.enter")}
        onClick={onEnter}
      >
        <span className="rowIcon">
          <IconBrowseOutline16 className="projectFallback" size={16} />
        </span>
        <span className="rowBody">
          <span className="rowTitle">
            <span className="rowTitleText">{project.title}</span>
            {project.archived && <span className="rowArchivedBadge">{t("detail.archivedBadge")}</span>}
          </span>
          <span className="rowMeta">
            {project.productLine !== undefined && project.productLine !== "" && (
              <span className="rowProduct">{project.productLine}</span>
            )}
            <span className="rowDate">{formatRelativeTime(project.createdMs, Date.now(), t)}</span>
          </span>
        </span>
      </button>
      <Tooltip label={t("project.overview")} delayMs={500}>
        <button
          type="button"
          className="rowAction"
          aria-label={t("project.overview")}
          onClick={onOpenDetail}
        >
          <IconDataOutline16 size={14} />
        </button>
      </Tooltip>
    </div>
  );
}
