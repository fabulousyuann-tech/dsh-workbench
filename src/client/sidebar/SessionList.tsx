import { useState } from "react";
import type { WorkspaceId } from "../dshCompatibility.ts";
import {
  Button,
  IconBrowseOutline16,
  IconNewChatOutline16,
  IconTrashOutline16,
  Modal,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";

import type { WorkbenchKey } from "../locales.ts";
import { formatRelativeTime } from "../relativeTime.ts";
import type { SidebarSession } from "./sessionOwnership.ts";

export function SessionList({
  sessions,
  t,
  openSession,
  archiveSession,
  moveTargets = [],
  moveSession,
  onMoveError,
  compact = false,
}: {
  sessions: readonly SidebarSession[];
  t: (key: WorkbenchKey) => string;
  openSession: (sessionId: SidebarSession["id"]) => void;
  archiveSession: (sessionId: SidebarSession["id"]) => Promise<void>;
  moveTargets?: readonly { workspaceId: WorkspaceId; title: string; path: string }[];
  moveSession?: (sessionId: SidebarSession["id"], workspaceId: WorkspaceId) => Promise<void>;
  onMoveError?: (message: string) => void;
  compact?: boolean;
}) {
  const [movingSessionId, setMovingSessionId] = useState<SidebarSession["id"]>();
  const [archiveTarget, setArchiveTarget] = useState<SidebarSession>();
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string>();

  const move = async (session: SidebarSession, workspaceId: WorkspaceId): Promise<void> => {
    if (moveSession === undefined || movingSessionId !== undefined) return;
    setMovingSessionId(session.id);
    try {
      await moveSession(session.id, workspaceId);
    } catch (cause) {
      onMoveError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMovingSessionId(undefined);
    }
  };

  const closeArchiveConfirmation = (): void => {
    if (archiveBusy) return;
    setArchiveTarget(undefined);
    setArchiveError(undefined);
  };

  const confirmArchive = async (): Promise<void> => {
    if (archiveTarget === undefined || archiveBusy) return;
    setArchiveBusy(true);
    setArchiveError(undefined);
    try {
      await archiveSession(archiveTarget.id);
      setArchiveTarget(undefined);
    } catch (cause) {
      setArchiveError(cause instanceof Error ? cause.message : t("sessions.archiveFailed"));
    } finally {
      setArchiveBusy(false);
    }
  };

  return (
    <div className={compact ? "managedSessionList compact" : "managedSessionList"}>
      {sessions.map((session) => (
        <div key={session.id} className={session.current ? "managedSessionRow current" : "managedSessionRow"}>
          <button
            type="button"
            className="managedSessionMain"
            title={session.title}
            onClick={() => { openSession(session.id); }}
          >
            <IconNewChatOutline16 size={14} />
            <span className="managedSessionTitle">
              {session.blank ? t("session.new.label") : session.title}
            </span>
            {session.running && <span className="managedSessionStatus running" aria-label={t("sessions.running")} />}
            {!session.running && session.completed && <span className="managedSessionStatus completed" aria-label={t("sessions.completed")} />}
            <span className="managedSessionTime">{formatRelativeTime(session.updatedAt, Date.now(), t)}</span>
          </button>
          {moveSession !== undefined && (
            <Tooltip
              label={moveTargets.length === 0 ? t("sessions.moveUnavailable") : t("sessions.moveToProject")}
              delayMs={400}
            >
              <span className="managedSessionMove">
                <IconBrowseOutline16 size={14} />
                <select
                  value=""
                  disabled={movingSessionId !== undefined || moveTargets.length === 0}
                  aria-label={`${t("sessions.moveToProject")}: ${session.title}`}
                  onChange={(event) => {
                    const workspaceId = event.target.value as WorkspaceId;
                    if (workspaceId !== "") void move(session, workspaceId);
                  }}
                >
                  <option value="" disabled>{t("sessions.moveChooseProject")}</option>
                  {moveTargets.map((target) => (
                    <option key={target.workspaceId} value={target.workspaceId}>
                      {target.title} — {target.path}
                    </option>
                  ))}
                </select>
              </span>
            </Tooltip>
          )}
          <Tooltip label={t("sessions.archive")} delayMs={400}>
            <button
              type="button"
              className="managedSessionArchive"
              aria-label={`${t("sessions.archive")}: ${session.title}`}
              onClick={() => {
                setArchiveError(undefined);
                setArchiveTarget(session);
              }}
            >
              <IconTrashOutline16 size={14} />
            </button>
          </Tooltip>
        </div>
      ))}
      <Modal
        open={archiveTarget !== undefined}
        onClose={closeArchiveConfirmation}
        title={t("sessions.archive")}
        description={archiveTarget === undefined
          ? ""
          : t("sessions.archiveConfirm").replace("{title}", archiveTarget.title)}
        closeLabel={t("sessions.archiveCancel")}
        footer={(
          <>
            <Button variant="outline" disabled={archiveBusy} onClick={closeArchiveConfirmation}>
              {t("sessions.archiveCancel")}
            </Button>
            <Button variant="primary" disabled={archiveBusy} onClick={() => { void confirmArchive(); }}>
              {archiveBusy ? t("sessions.archiving") : t("sessions.archive")}
            </Button>
          </>
        )}
      >
        {archiveError !== undefined && <div role="alert">{archiveError}</div>}
      </Modal>
    </div>
  );
}
