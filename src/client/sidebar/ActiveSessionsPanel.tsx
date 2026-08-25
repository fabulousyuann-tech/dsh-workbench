import type {
  SessionListState,
  WorkspaceListState,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { SnapshotSelectorHook } from "@deepseek-ai/dsh-client-ui-slots";

import type { WorkbenchKey } from "../locales.ts";
import { formatRelativeTime } from "../relativeTime.ts";
import {
  deriveActiveSessions,
  type ActiveSidebarSession,
  type ActiveSpaceDescriptor,
} from "./sessionOwnership.ts";
import "./ActiveSessionsPanel.css";

function statusKey(session: ActiveSidebarSession): WorkbenchKey {
  if (session.activity === "running") return "sessions.active.running";
  if (session.activity === "completed") return "sessions.active.completed";
  if (session.pendingInteraction === "approval") return "sessions.active.pending.approval";
  if (session.pendingInteraction === "plan-review") return "sessions.active.pending.planReview";
  return "sessions.active.pending.question";
}

export function ActiveSessionsPanel({
  t,
  query,
  spaces,
  aliasesBySpace,
  useSessions,
  useWorkspaces,
  openSession,
}: {
  t: (key: WorkbenchKey) => string;
  query: string;
  spaces: readonly ActiveSpaceDescriptor[];
  aliasesBySpace: Readonly<Record<string, readonly string[]>>;
  useSessions: SnapshotSelectorHook<SessionListState>;
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>;
  openSession: (sessionId: ActiveSidebarSession["id"]) => void;
}) {
  const sessions = useSessions((state) => state);
  const workspaces = useWorkspaces((state) => state);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const active = deriveActiveSessions(
    sessions,
    workspaces.items,
    workspaces.archivedSessionIds,
    spaces,
    aliasesBySpace,
  ).filter((session) => normalizedQuery === ""
    || session.title.toLocaleLowerCase().includes(normalizedQuery)
    || session.ownerLabel.toLocaleLowerCase().includes(normalizedQuery));

  if (active.length === 0) return null;
  return (
    <section className="activeSessionsPanel" aria-label={t("sessions.active.title")}>
      <div className="activeSessionsHeading">
        <span className="activeSessionsHeadingDot" aria-hidden="true" />
        <strong>{t("sessions.active.title")}</strong>
        <small>{active.length}</small>
      </div>
      <div className="activeSessionsList">
        {active.map((session) => (
          <button
            key={session.id}
            type="button"
            className={session.current ? "activeSessionRow current" : "activeSessionRow"}
            title={`${session.title}${session.ownerLabel === "" ? "" : ` · ${session.ownerLabel}`}`}
            onClick={() => { openSession(session.id); }}
          >
            <span className={`activeSessionState ${session.activity}`} aria-hidden="true" />
            <span className="activeSessionBody">
              <span className="activeSessionTitle">{session.title}</span>
              <span className="activeSessionOwner">
                {session.ownerLabel === "" ? t("sessions.active.ordinary") : session.ownerLabel}
              </span>
            </span>
            <span className={`activeSessionBadge ${session.activity}`}>{t(statusKey(session))}</span>
            <span className="activeSessionTime">{formatRelativeTime(session.updatedAt, Date.now(), t)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
