import {
  IconNewChatOutline16,
  IconTrashOutline16,
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
  compact = false,
}: {
  sessions: readonly SidebarSession[];
  t: (key: WorkbenchKey) => string;
  openSession: (sessionId: SidebarSession["id"]) => void;
  archiveSession: (sessionId: SidebarSession["id"]) => Promise<void>;
  compact?: boolean;
}) {
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
          <Tooltip label={t("sessions.archive")} delayMs={400}>
            <button
              type="button"
              className="managedSessionArchive"
              aria-label={`${t("sessions.archive")}: ${session.title}`}
              onClick={() => {
                if (!window.confirm(t("sessions.archiveConfirm").replace("{title}", session.title))) return;
                void archiveSession(session.id);
              }}
            >
              <IconTrashOutline16 size={14} />
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
