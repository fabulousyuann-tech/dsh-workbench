import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, Modal, RiskConfirmation } from "@deepseek-ai/dsh-client-ui-primitives";

import type {
  CustomerSummary,
  FileCategory,
  ListProjectFilesRequest,
  MoveProjectRequest,
  ProjectDetail,
  ProjectFile,
  ProjectFilesResult,
  UpdateProjectRequest,
} from "../types.ts";
import { parseFrontmatter } from "../frontmatter.ts";
import type { WorkbenchKey } from "./locales.ts";
import "./WorkbenchProjectDetail.css";

const FILE_CATEGORY_LABEL_KEY: Record<FileCategory, WorkbenchKey> = {
  word: "files.category.word",
  excel: "files.category.excel",
  ppt: "files.category.ppt",
  pdf: "files.category.pdf",
  text: "files.category.text",
  image: "files.category.image",
  archive: "files.category.archive",
  other: "files.category.other",
};

const FILE_CATEGORY_ORDER: readonly FileCategory[] = [
  "word",
  "excel",
  "ppt",
  "pdf",
  "text",
  "image",
  "archive",
  "other",
];

type DetailTab = "overview" | "document" | "files";

const DETAIL_TABS: ReadonlyArray<{ value: DetailTab; label: WorkbenchKey }> = [
  { value: "overview", label: "detail.tab.overview" },
  { value: "document", label: "detail.tab.document" },
  { value: "files", label: "detail.tab.files" },
];

export function WorkbenchProjectDetail({
  getProject,
  listProjectFiles,
  updateProject,
  moveProject,
  deleteProject,
  openPath,
  t,
  customers,
  projectId,
  customerId,
  onClose,
  onSaved,
}: {
  getProject: (id: string, customerId?: string) => Promise<ProjectDetail>;
  listProjectFiles: (request: ListProjectFilesRequest) => Promise<ProjectFilesResult>;
  updateProject: (request: UpdateProjectRequest) => Promise<ProjectDetail>;
  moveProject: (request: MoveProjectRequest) => Promise<ProjectDetail>;
  deleteProject: (id: string, customerId?: string) => Promise<unknown>;
  openPath: (path: string) => Promise<void>;
  t: (key: WorkbenchKey) => string;
  customers: CustomerSummary[];
  projectId: string;
  customerId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [detail, setDetail] = useState<ProjectDetail | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftProductLine, setDraftProductLine] = useState("");
  const [draftOwner, setDraftOwner] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | undefined>(undefined);
  const [moveCustomer, setMoveCustomer] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [files, setFiles] = useState<ProjectFilesResult | undefined>(undefined);
  const [fileQuery, setFileQuery] = useState("");
  const [fileCategory, setFileCategory] = useState<FileCategory | "all">("all");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [documentSource, setDocumentSource] = useState(false);

  const load = async (): Promise<void> => {
    setError(undefined);
    try {
      const next = await getProject(projectId, customerId);
      setDetail(next);
      setMoveCustomer("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("detail.loadFailed"));
    }
  };

  useEffect(() => {
    setEditing(false);
    setSaveError(undefined);
    setLifecycleError(undefined);
    setDeleteOpen(false);
    setDeleteAcknowledged(false);
    setFiles(undefined);
    setFileQuery("");
    setFileCategory("all");
    setFileError(undefined);
    setActiveTab("overview");
    setDocumentSource(false);
    void load();
  }, [projectId, customerId]);

  const loadFiles = async (): Promise<void> => {
    if (listProjectFiles === undefined) return;
    setFileLoading(true);
    setFileError(undefined);
    try {
      const request: ListProjectFilesRequest = { id: projectId, customerId };
      if (fileQuery.trim() !== "") request.query = fileQuery.trim();
      if (fileCategory !== "all") request.category = fileCategory;
      const next = await listProjectFiles(request);
      setFiles(next);
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : t("detail.loadFailed"));
    } finally {
      setFileLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "files" || detail === undefined || listProjectFiles === undefined) return;
    const handle = window.setTimeout(() => {
      void loadFiles();
    }, 150);
    return () => {
      window.clearTimeout(handle);
    };
  }, [projectId, customerId, fileQuery, fileCategory, detail?.id, activeTab]);

  const startEdit = (): void => {
    if (detail === undefined) return;
    setDraftTitle(detail.title);
    setDraftProductLine(detail.productLine ?? "");
    setDraftOwner(detail.owner ?? "");
    setSaveError(undefined);
    setEditing(true);
  };

  const onSave = async (): Promise<void> => {
    if (detail === undefined || saving || draftTitle.trim() === "") return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const request: UpdateProjectRequest = {
        id: detail.id,
        customerId: detail.customerId,
        title: draftTitle.trim(),
        ...(draftProductLine.trim() === "" ? {} : { productLine: draftProductLine.trim() }),
        ...(draftOwner.trim() === "" ? {} : { owner: draftOwner.trim() }),
      };
      const next = await updateProject(request);
      setDetail(next);
      setEditing(false);
      onSaved?.();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t("detail.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const onArchiveToggle = async (): Promise<void> => {
    if (detail === undefined || lifecycleBusy) return;
    setLifecycleBusy(true);
    setLifecycleError(undefined);
    try {
      const next = await updateProject({ id: detail.id, customerId: detail.customerId, archived: !detail.archived });
      setDetail(next);
      onSaved?.();
    } catch (cause) {
      setLifecycleError(cause instanceof Error ? cause.message : t("detail.lifecycleError"));
    } finally {
      setLifecycleBusy(false);
    }
  };

  const onMove = async (): Promise<void> => {
    if (detail === undefined || lifecycleBusy || moveCustomer === "" || moveCustomer === detail.customerId) {
      return;
    }
    setLifecycleBusy(true);
    setLifecycleError(undefined);
    try {
      const next = await moveProject({ id: detail.id, sourceCustomerId: detail.customerId, customerId: moveCustomer });
      setDetail(next);
      setMoveCustomer("");
      onSaved?.();
    } catch (cause) {
      setLifecycleError(cause instanceof Error ? cause.message : t("detail.lifecycleError"));
    } finally {
      setLifecycleBusy(false);
    }
  };

  const onDeleteConfirm = async (): Promise<void> => {
    if (detail === undefined || lifecycleBusy) return;
    setLifecycleBusy(true);
    setLifecycleError(undefined);
    try {
      await deleteProject(detail.id, detail.customerId);
      setDeleteOpen(false);
      onSaved?.();
      onClose();
    } catch (cause) {
      setLifecycleError(cause instanceof Error ? cause.message : t("detail.lifecycleError"));
      setDeleteOpen(false);
    } finally {
      setLifecycleBusy(false);
    }
  };

  const moveOptions = detail === undefined
    ? []
    : customers.filter((customer) => customer.id !== detail.customerId);

  const title = detail?.title ?? projectId;
  const notSet = t("common.notSet");

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t("detail.title")}
      closeLabel={t("detail.close")}
      className={editing ? "wbDetailModal editing" : "wbDetailModal"}
      footer={editing
        ? (
          <>
            <Button variant="outline" disabled={saving} onClick={() => { setEditing(false); }}>
              {t("detail.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={saving || draftTitle.trim() === ""}
              onClick={() => { void onSave(); }}
            >
              {saving ? t("detail.saving") : t("detail.save")}
            </Button>
          </>
        )
        : undefined}
    >
      <div data-plugin="dsh-workbench" data-surface="project-detail">
        {error !== undefined && <div className="detailError">{error}</div>}
        {error === undefined && detail === undefined && (
          <div className="detailEmpty">{t("empty.loading")}</div>
        )}
        {detail !== undefined && !editing && (
          <div className="detailView">
            <div className="detailSticky">
              <div className="detailHeader">
                <div className="detailHeaderTitle">
                  <span className="detailTitleText">{title}</span>
                  {detail.archived && (
                    <span className="detailArchivedBadge">{t("detail.archivedBadge")}</span>
                  )}
                </div>
                <div className="detailHeaderActions">
                  <Button
                    variant="outline"
                    onClick={() => { void openPath(detail.folderPath); }}
                  >
                    {t("detail.openFolder")}
                  </Button>
                  <Button variant="primary" onClick={startEdit}>
                    {t("detail.edit")}
                  </Button>
                </div>
              </div>

              <div className="detailTabs" role="tablist" aria-label={t("detail.sections")}>
                {DETAIL_TABS.map((tab, index) => (
                  <button
                    key={tab.value}
                    id={`wb-detail-tab-${tab.value}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.value}
                    aria-controls={`wb-detail-panel-${tab.value}`}
                    tabIndex={activeTab === tab.value ? 0 : -1}
                    className={activeTab === tab.value ? "detailTab active" : "detailTab"}
                    onClick={() => { setActiveTab(tab.value); }}
                    onKeyDown={(event) => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const nextIndex = event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? DETAIL_TABS.length - 1
                          : (index + (event.key === "ArrowRight" ? 1 : -1) + DETAIL_TABS.length) % DETAIL_TABS.length;
                      const next = DETAIL_TABS[nextIndex];
                      if (next === undefined) return;
                      setActiveTab(next.value);
                      const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']");
                      tabs?.[nextIndex]?.focus();
                    }}
                  >
                    <span>{t(tab.label)}</span>
                    {tab.value === "files" && files !== undefined && (
                      <span className="detailTabCount">{files.files.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {activeTab === "overview" && (
              <div
                id="wb-detail-panel-overview"
                className="detailPanel"
                role="tabpanel"
                aria-labelledby="wb-detail-tab-overview"
              >
                <div className="detailMetaGrid">
                  <DetailMetaItem label={t("detail.customer")} value={detail.customerName} />
                  <DetailMetaItem label={t("detail.productLine")} value={detail.productLine || notSet} />
                  <DetailMetaItem label={t("detail.owner")} value={detail.owner || notSet} />
                  <DetailMetaItem label={t("detail.date")} value={detail.date ?? notSet} />
                  <DetailMetaItem label={t("detail.startedAt")} value={detail.startedAt ?? notSet} />
                  <DetailMetaItem label={t("detail.dueAt")} value={detail.dueAt ?? notSet} />
                  <DetailMetaItem
                    label={t("detail.tags")}
                    value={detail.tags.length === 0 ? t("detail.noTags") : detail.tags.join("、")}
                  />
                </div>

                <section className="detailManagement" aria-labelledby="wb-detail-management-title">
                  <div className="detailSectionHeader">
                    <h3 id="wb-detail-management-title" className="detailSectionTitle">{t("detail.move.title")}</h3>
                  </div>
                  <div className="detailActionRow">
                    <div className="detailActionCopy">
                      <span className="detailActionLabel">{t("detail.move")}</span>
                      <span className="detailActionHint">{t("detail.moveHint")}</span>
                    </div>
                    <div className="detailActionBody">
                      <select
                        className="detailSelect detailMoveSelect"
                        value={moveCustomer}
                        aria-label={t("detail.move.customer")}
                        disabled={lifecycleBusy}
                        onChange={(event) => { setMoveCustomer(event.target.value); }}
                      >
                        <option value="">{t("common.notSelected")}</option>
                        {moveOptions.map((customer) => (
                          <option key={customer.id} value={customer.id}>{customer.name}</option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        disabled={lifecycleBusy || moveOptions.length === 0 || moveCustomer === "" || moveCustomer === detail.customerId}
                        onClick={() => { void onMove(); }}
                      >
                        {t("detail.move.confirm")}
                      </Button>
                    </div>
                  </div>
                  <div className="detailActionRow">
                    <div className="detailActionCopy">
                      <span className="detailActionLabel">
                        {detail.archived ? t("detail.restore") : t("detail.archive")}
                      </span>
                      <span className="detailActionHint">{t("detail.archiveHint")}</span>
                    </div>
                    <div className="detailActionBody compact">
                      <Button
                        variant="outline"
                        disabled={lifecycleBusy}
                        onClick={() => { void onArchiveToggle(); }}
                      >
                        {detail.archived ? t("detail.restore") : t("detail.archive")}
                      </Button>
                    </div>
                  </div>
                  {lifecycleError !== undefined && <div className="detailError">{lifecycleError}</div>}
                </section>

                <section className="detailDanger" aria-labelledby="wb-detail-danger-title">
                  <div className="detailActionCopy">
                    <h3 id="wb-detail-danger-title" className="detailDangerTitle">{t("detail.danger")}</h3>
                    <span className="detailActionHint">{t("detail.deleteHint")}</span>
                  </div>
                  <Button
                    className="detailDangerButton"
                    variant="outline"
                    disabled={lifecycleBusy}
                    onClick={() => { setDeleteOpen(true); }}
                  >
                    {t("detail.delete")}
                  </Button>
                </section>
              </div>
            )}

            {activeTab === "document" && (
              <div
                id="wb-detail-panel-document"
                className="detailPanel"
                role="tabpanel"
                aria-labelledby="wb-detail-tab-document"
              >
                <div className="detailDocumentHeader">
                  <div className="detailDocTitle">{t("detail.markdown")}</div>
                  {detail.projectMarkdown !== "" && (
                    <button
                      type="button"
                      className="detailDocumentMode"
                      onClick={() => { setDocumentSource(!documentSource); }}
                    >
                      {documentSource ? t("detail.documentPreview") : t("detail.documentSource")}
                    </button>
                  )}
                </div>
                {detail.projectMarkdown === ""
                  ? <div className="detailEmpty">{t("detail.noMarkdown")}</div>
                  : documentSource
                    ? <pre className="detailMarkdown">{detail.projectMarkdown}</pre>
                    : <ProjectMarkdownPreview markdown={detail.projectMarkdown} />}
              </div>
            )}

            {activeTab === "files" && listProjectFiles !== undefined && (
              <div
                id="wb-detail-panel-files"
                className="detailPanel"
                role="tabpanel"
                aria-labelledby="wb-detail-tab-files"
              >
                <ProjectFilesSection
                  files={files}
                  query={fileQuery}
                  category={fileCategory}
                  loading={fileLoading}
                  error={fileError}
                  t={t}
                  onQueryChange={setFileQuery}
                  onCategoryChange={setFileCategory}
                  onOpenFile={(file) => { void openPath(`${detail.folderPath}/${file.relativePath}`); }}
                />
              </div>
            )}
          </div>
        )}
        {detail !== undefined && editing && (
          <div className="detailEdit">
            <div className="detailField">
              <label className="detailLabel" htmlFor="wb-detail-title">{t("detail.projectName")}</label>
              <Input
                id="wb-detail-title"
                className="detailInput"
                value={draftTitle}
                placeholder={t("detail.placeholder.title")}
                disabled={saving}
                onChange={(event) => { setDraftTitle(event.target.value); }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void onSave();
                }}
              />
            </div>
            <div className="detailField">
              <label className="detailLabel" htmlFor="wb-detail-product">{t("detail.productLine")}</label>
              <Input
                id="wb-detail-product"
                className="detailInput"
                value={draftProductLine}
                placeholder={t("detail.placeholder.productLine")}
                disabled={saving}
                onChange={(event) => { setDraftProductLine(event.target.value); }}
              />
            </div>
            <div className="detailField">
              <label className="detailLabel" htmlFor="wb-detail-owner">{t("detail.owner")}</label>
              <Input
                id="wb-detail-owner"
                className="detailInput"
                value={draftOwner}
                placeholder={t("detail.placeholder.owner")}
                disabled={saving}
                onChange={(event) => { setDraftOwner(event.target.value); }}
              />
            </div>
            {saveError !== undefined && <div className="detailError">{saveError}</div>}
          </div>
        )}
        {detail !== undefined && (
          <RiskConfirmation
            open={deleteOpen}
            title={t("detail.delete.title")}
            description={t("detail.deleteHint")}
            acknowledgeLabel={t("detail.deleteAcknowledge")}
            cancelLabel={t("detail.cancel")}
            closeLabel={t("detail.cancel")}
            confirmLabel={t("detail.deleteConfirm")}
            acknowledged={deleteAcknowledged}
            disabled={lifecycleBusy}
            onAcknowledgedChange={setDeleteAcknowledged}
            onCancel={() => { setDeleteOpen(false); }}
            onConfirm={() => { void onDeleteConfirm(); }}
          />
        )}
      </div>
    </Modal>
  );
}

function DetailMetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detailMetaItem">
      <span className="detailMetaLabel">{label}</span>
      <span className="detailMetaValue">{value}</span>
    </div>
  );
}

function ProjectMarkdownPreview({ markdown }: { markdown: string }) {
  const body = parseFrontmatter(markdown).body.trim();
  if (body === "") return null;

  const blocks: ReactNode[] = [];
  const lines = body.split(/\r?\n/);
  let code: string[] | undefined;

  const pushCode = (key: number): void => {
    if (code === undefined) return;
    blocks.push(<pre key={`code-${key}`} className="detailMarkdownCode">{code.join("\n")}</pre>);
    code = undefined;
  };

  lines.forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      if (code === undefined) code = [];
      else pushCode(index);
      return;
    }
    if (code !== undefined) {
      code.push(line);
      return;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? "";
      if (level === 1) blocks.push(<h2 key={index}>{text}</h2>);
      else if (level === 2) blocks.push(<h3 key={index}>{text}</h3>);
      else blocks.push(<h4 key={index}>{text}</h4>);
      return;
    }

    const task = /^\s*-\s*\[([ xX])\]\s+(.+)$/.exec(line);
    if (task !== null) {
      const checked = task[1]?.toLowerCase() === "x";
      blocks.push(
        <div key={index} className="detailMarkdownTask">
          <span className={checked ? "detailMarkdownCheck checked" : "detailMarkdownCheck"} aria-hidden="true">
          </span>
          <span>{task[2]}</span>
        </div>,
      );
      return;
    }

    const listItem = /^\s*[-*]\s+(.+)$/.exec(line);
    if (listItem !== null) {
      blocks.push(<div key={index} className="detailMarkdownListItem"><span aria-hidden="true">•</span><span>{listItem[1]}</span></div>);
      return;
    }

    if (line.trim() === "") {
      blocks.push(<div key={index} className="detailMarkdownBreak" aria-hidden="true" />);
      return;
    }

    blocks.push(<p key={index}>{line}</p>);
  });
  pushCode(lines.length);

  return <div className="detailMarkdownPreview">{blocks}</div>;
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function ProjectFilesSection({
  files,
  query,
  category,
  loading,
  error,
  t,
  onQueryChange,
  onCategoryChange,
  onOpenFile,
}: {
  files: ProjectFilesResult | undefined;
  query: string;
  category: FileCategory | "all";
  loading: boolean;
  error: string | undefined;
  t: (key: WorkbenchKey) => string;
  onQueryChange: (value: string) => void;
  onCategoryChange: (value: FileCategory | "all") => void;
  onOpenFile: (file: ProjectFile) => void;
}) {
  const grouped = FILE_CATEGORY_ORDER
    .map((cat) => ({ cat, files: files?.files.filter((file) => file.category === cat) ?? [] }))
    .filter((group) => group.files.length > 0);
  const total = files?.files.length ?? 0;

  return (
    <div className="detailFiles">
      <div className="detailFilesHeader">
        <span className="detailDocTitle">{t("detail.files")}</span>
        {files !== undefined && (
          <span className="detailFilesCount">
            {t("detail.filesCount").replace("{n}", String(total))}
          </span>
        )}
      </div>
      <div className="detailFilesToolbar">
        <Input
          className="detailFilesSearch"
          value={query}
          placeholder={t("detail.filesSearch")}
          aria-label={t("detail.filesSearch")}
          onChange={(event) => { onQueryChange(event.target.value); }}
        />
        <select
          className="detailFilesSelect"
          value={category}
          aria-label={t("detail.filesFilter")}
          onChange={(event) => { onCategoryChange(event.target.value as FileCategory | "all"); }}
        >
          <option value="all">{t("detail.filesAll")}</option>
          {FILE_CATEGORY_ORDER.map((cat) => (
            <option key={cat} value={cat}>
              {t(FILE_CATEGORY_LABEL_KEY[cat])}
              {files !== undefined && files.byCategory[cat] > 0 ? ` (${files.byCategory[cat]})` : ""}
            </option>
          ))}
        </select>
      </div>
      {error !== undefined && <div className="detailFilesError">{error}</div>}
      {loading && files === undefined && (
        <div className="detailFilesSkeleton" aria-label={t("empty.loading")} role="status">
          <span />
          <span />
          <span />
        </div>
      )}
      {!loading && files !== undefined && grouped.length === 0 && (
        <div className="detailEmpty">{t("detail.filesEmpty")}</div>
      )}
      {grouped.map((group) => (
        <div key={group.cat} className="detailFilesGroup">
          <div className="detailFilesGroupLabel">
            {t(FILE_CATEGORY_LABEL_KEY[group.cat])}
            <span className="detailFilesGroupCount">{group.files.length}</span>
          </div>
          <div className="detailFilesList">
            {group.files.map((file) => (
              <button
                key={file.relativePath}
                type="button"
                className="detailFileRow"
                title={file.relativePath}
                aria-label={`${t("detail.filesOpen")}: ${file.name}`}
                onClick={() => { onOpenFile(file); }}
              >
                <span className="detailFileIcon">{fileCategoryGlyph(file.category)}</span>
                <span className="detailFileBody">
                  <span className="detailFileName">{file.name}</span>
                  <span className="detailFilePath">{file.relativePath}</span>
                </span>
                <span className="detailFileMeta">{formatFileSize(file.sizeBytes)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function fileCategoryGlyph(category: FileCategory): string {
  switch (category) {
    case "word": return "W";
    case "excel": return "X";
    case "ppt": return "P";
    case "pdf": return "PDF";
    case "image": return "IMG";
    case "text": return "TXT";
    case "archive": return "ZIP";
    default: return "FILE";
  }
}
