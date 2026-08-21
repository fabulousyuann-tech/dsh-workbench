import { useEffect, useState } from "react";

import type {
  DueRemindersRequest,
  DueRemindersResult,
  WorkbenchStatistics,
} from "../types.ts";
import type { WorkbenchKey } from "./locales.ts";
import { useLibraryEpoch } from "./selection.ts";

const STAT_META: ReadonlyArray<{ key: WorkbenchKey; pick: (s: WorkbenchStatistics) => number }> = [
  { key: "dashboard.stat.total", pick: (s) => s.totalProjects },
  { key: "dashboard.stat.active", pick: (s) => s.activeProjects },
  { key: "dashboard.stat.done", pick: (s) => s.doneProjects },
  { key: "dashboard.stat.archived", pick: (s) => s.archivedProjects },
  { key: "dashboard.stat.customers", pick: (s) => s.customers },
  { key: "dashboard.stat.dueSoon", pick: (s) => s.dueSoonProjects },
];

function dueLabel(daysLeft: number, overdue: boolean, t: (key: WorkbenchKey) => string): string {
  if (overdue) return t("dashboard.due.overdueDays").replace("{n}", String(-daysLeft));
  if (daysLeft === 0) return t("dashboard.due.today");
  return t("dashboard.due.days").replace("{n}", String(daysLeft));
}

export function WorkbenchDashboard({
  ready,
  statistics,
  dueReminders,
  t,
  onOpenProject,
}: {
  ready: () => boolean;
  statistics: () => Promise<WorkbenchStatistics>;
  dueReminders: (request: DueRemindersRequest) => Promise<DueRemindersResult>;
  t: (key: WorkbenchKey) => string;
  onOpenProject: (id: string) => void;
}) {
  const libraryEpoch = useLibraryEpoch();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<WorkbenchStatistics | undefined>(undefined);
  const [reminders, setReminders] = useState<DueRemindersResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open || !ready()) return;
    let cancelled = false;
    setError(undefined);
    Promise.all([
      statistics(),
      dueReminders({}),
    ]).then(([nextStats, nextReminders]) => {
      if (cancelled) return;
      setStats(nextStats);
      setReminders(nextReminders);
    }).catch((cause) => {
      if (cancelled) return;
      setError(cause instanceof Error ? cause.message : t("detail.loadFailed"));
    });
    return () => { cancelled = true; };
  }, [open, libraryEpoch]);

  const reminderCount = (reminders?.overdue.length ?? 0) + (reminders?.dueSoon.length ?? 0);

  return (
    <div className="dashboard">
      <button
        type="button"
        className={open ? "dashboardToggle open" : "dashboardToggle"}
        aria-expanded={open}
        onClick={() => { setOpen(!open); }}
      >
        <span className="dashboardTitle">{t("dashboard.title")}</span>
        {stats !== undefined && (
          <span className="dashboardBadge">
            {t("dashboard.stat.overdue")} {stats.overdueProjects}
          </span>
        )}
        <span className={open ? "dashboardChevron open" : "dashboardChevron"}>›</span>
      </button>
      {open && (
        <div className="dashboardBody">
          {error !== undefined && <div className="dashboardError">{error}</div>}
          {stats !== undefined && (
            <div className="dashboardStats">
              {STAT_META.map((meta) => (
                <div key={meta.key} className="dashboardStat">
                  <div className="dashboardStatValue">{meta.pick(stats)}</div>
                  <div className="dashboardStatLabel">{t(meta.key)}</div>
                </div>
              ))}
            </div>
          )}
          {reminderCount > 0 && (
            <div className="dashboardReminders">
              {reminders!.overdue.length > 0 && (
                <div className="dashboardReminderGroup overdue">
                  <div className="dashboardReminderLabel">{t("dashboard.due.overdue")}</div>
                  {reminders!.overdue.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="dashboardReminderItem"
                      title={item.title}
                      onClick={() => { onOpenProject(item.id); }}
                    >
                      <span className="dashboardReminderName">{item.title}</span>
                      <span className="dashboardReminderMeta">
                        {item.customerName}
                        {item.owner !== undefined ? ` · ${t("dashboard.due.owner")}：${item.owner}` : ""}
                      </span>
                      <span className="dashboardReminderDays">
                        {dueLabel(item.daysLeft, true, t)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {reminders!.dueSoon.length > 0 && (
                <div className="dashboardReminderGroup soon">
                  <div className="dashboardReminderLabel">{t("dashboard.due.soon")}</div>
                  {reminders!.dueSoon.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="dashboardReminderItem"
                      title={item.title}
                      onClick={() => { onOpenProject(item.id); }}
                    >
                      <span className="dashboardReminderName">{item.title}</span>
                      <span className="dashboardReminderMeta">
                        {item.customerName}
                        {item.owner !== undefined ? ` · ${t("dashboard.due.owner")}：${item.owner}` : ""}
                      </span>
                      <span className="dashboardReminderDays">
                        {dueLabel(item.daysLeft, false, t)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {reminderCount === 0 && stats !== undefined && (
            <div className="dashboardEmpty">{t("dashboard.due.empty")}</div>
          )}
        </div>
      )}
    </div>
  );
}
