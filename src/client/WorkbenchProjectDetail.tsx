import { useEffect, useState } from "react";
import { Button, Input, Modal, RiskConfirmation } from "@deepseek-ai/dsh-client-ui-primitives";

import type {
  CustomerSummary,
  FileCategory,
  ListProjectFilesRequest,
  MoveProjectRequest,
  ProjectDetail,
  ProjectFile,
  ProjectFilesResult,
  ProjectStage,
  UpdateProjectRequest,
} from "../types.ts";
import { PROJECT_STAGES } from "../types.ts";
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
  onClose,
  onSaved,
}: {
  getProject: (id: string) => Promise<ProjectDetail>;
  listProjectFiles: (request: ListProjectFilesRequest) => Promise<ProjectFilesResult>;
  updateProject: (request: UpdateProjectRequest) => Promise<ProjectDetail>;
  moveProject: (request: MoveProjectRequest) => Promise<ProjectDetail>;
  deleteProject: (id: string) => Promise<unknown>;
  openPath: (path: string) => Promise<void>;
  t: (key: WorkbenchKey) => string;
  customers: CustomerSummary[];
  projectId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [detail, setDetail] = useState<ProjectDetail | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftStage, setDraftStage] = useState<ProjectStage>("opportunity");
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

  const load = async (): Promise<void> => {
    setError(undefined);
    try {
      const next = await getProject(projectId);
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
    void load();
  }, [projectId]);

  const loadFiles = async (): Promise<void> => {
    if (listProjectFiles === undefined) return;
    setFileLoading(true);
    setFileError(undefined);
    try {
      const request: ListProjectFilesRequest = { id: projectId };
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
    if (detail === undefined || listProjectFiles === undefined) return;
    const handle = window.setTimeout(() => {
      void loadFiles();
    }, 150);
    return () => {
      window.clearTimeout(handle);
    };
  }, [projectId, fileQuery, fileCategory, detail?.id]);

  const startEdit = (): void => {
    if (detail === undefined) return;
    setDraftTitle(detail.title);
    setDraftStage(detail.stage);
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
        title: draftTitle.trim(),
        stage: draftStage,
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
      const next = await updateProject({ id: detail.id, archived: !detail.archived });
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
      const next = await moveProject({ id: detail.id, customerId: moveCustomer });
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
      await deleteProject(detail.id);
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

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t("detail.title")}
      closeLabel={t("detail.close")}
      className="wbDetailModal"
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
            <div className="detailMeta">
              <div className="detailRow">
                <span className="detailLabel">{t("detail.customer")}</span>
                <span className="detailValue">{detail.customerName}</span>
              </div>
              <div className="detailRow">
                <span className="detailLabel">{t("detail.stage")}</span>
                <span className="detailValue">
                  {t(`stage.${detail.stage}`)}
                </span>
              </div>
              <div className="detailRow">
                <span className="detailLabel">{t("detail.productLine")}</span>
                <span className="detailValue">
                  {detail.productLine !== undefined && detail.productLine !== "" ? detail.productLine : "—"}
                </span>
              </div>
              <div className="detailRow">
                <span className="detailLabel">{t("detail.owner")}</span>
                <span className="detailValue">
                  {detail.owner !== undefined && detail.owner !== "" ? detail.owner : "—"}
                </span>
              </div>
              <div className="detailRow">
                <span className="detailLabel">{t("detail.date")}</span>
                <span className="detailValue">{detail.date ?? "—"}</span>
              </div>
              <div className="detailRow">
                <span className="detailLabel">{t("detail.startedAt")}</span>
                <span className="detailValue">{detail.startedAt ?? "—"}</span>
              </div>
              <div className="detailRow">
                <span className="detailLabel">{t("detail.dueAt")}</span>
                <span className="detailValue">{detail.dueAt ?? "—"}</span>
              </div>
              <div className="detailRow">
                <span className="detailLabel">{t("detail.tags")}</span>
                <span className="detailValue">
                  {detail.tags.length === 0 ? t("detail.noTags") : detail.tags.join("、")}
                </span>
              </div>
            </div>
            <div className="detailDocTitle">{t("detail.markdown")}</div>
            {detail.projectMarkdown === ""
              ? <div className="detailEmpty">{t("detail.noMarkdown")}</div>
              : <pre className="detailMarkdown">{detail.projectMarkdown}</pre>}
            {listProjectFiles !== undefined && (
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
            )}
            <div className="detailActions">
              <div className="detailActionsTitle">{t("detail.move.title")}</div>
              <div className="detailActionRow">
                <span className="detailActionLabel">{t("detail.move")}</span>
                <div className="detailActionBody">
                  <select
                    className="detailSelect detailMoveSelect"
                    value={moveCustomer}
                    disabled={lifecycleBusy}
                    onChange={(event) => { setMoveCustomer(event.target.value); }}
                  >
                    {moveOptions.length === 0
                      ? <option value="">—</option>
                      : (
                        <>
                          <option value="">—</option>
                          {moveOptions.map((customer) => (
                            <option key={customer.id} value={customer.id}>{customer.name}</option>
                          ))}
                        </>
                      )}
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
                <span className="detailActionLabel">
                  {detail.archived ? t("detail.restore") : t("detail.archive")}
                </span>
                <div className="detailActionBody">
                  <Button
                    variant="outline"
                    disabled={lifecycleBusy}
                    onClick={() => { void onArchiveToggle(); }}
                  >
                    {detail.archived ? t("detail.restore") : t("detail.archive")}
                  </Button>
                </div>
              </div>
              <div className="detailActionRow">
                <span className="detailActionLabel">{t("detail.delete")}</span>
                <div className="detailActionBody">
                  <Button
                    variant="outline"
                    disabled={lifecycleBusy}
                    onClick={() => { setDeleteOpen(true); }}
                  >
                    {t("detail.delete")}
                  </Button>
                </div>
              </div>
              {lifecycleError !== undefined && <div className="detailError">{lifecycleError}</div>}
            </div>
          </div>
        )}
        {detail !== undefined && editing && (
          <div className="detailEdit">
            <div className="detailField">
              <label className="detailLabel" htmlFor="wb-detail-title">{t("detail.title")}</label>
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
              <label className="detailLabel" htmlFor="wb-detail-stage">{t("detail.stage")}</label>
              <select
                id="wb-detail-stage"
                className="detailSelect"
                value={draftStage}
                disabled={saving}
                onChange={(event) => { setDraftStage(event.target.value as ProjectStage); }}
              >
                {PROJECT_STAGES.map((stage) => (
                  <option key={stage} value={stage}>{t(`stage.${stage}`)}</option>
                ))}
              </select>
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
          onChange={(event) => { onQueryChange(event.target.value); }}
        />
        <select
          className="detailFilesSelect"
          value={category}
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
      {loading && files === undefined && <div className="detailEmpty">{t("empty.loading")}</div>}
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
                onClick={() => { onOpenFile(file); }}
              >
                <span className="detailFileIcon">{fileCategoryGlyph(file.category)}</span>
                <span className="detailFileName">{file.name}</span>
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
