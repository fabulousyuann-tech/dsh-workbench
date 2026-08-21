import { useEffect, useRef, useState } from "react";
import {
  IconBrowseOutline16,
  IconNewChatOutline16,
  IconPanelLeftOutline16,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";

import type { WorkbenchViewFace } from "../face.ts";
import type { WorkbenchKey } from "../locales.ts";
import { setSidebarTab, useSidebarTab } from "../selection.ts";
import { WorkbenchBrand } from "./WorkbenchBrand.tsx";
import { WorkbenchSidebarPanel } from "./WorkbenchSidebarPanel.tsx";
import type { WorkbenchSidebarSlotProps } from "./slots.ts";
import "./WorkbenchSidebarRoot.css";

const COLLAPSE_SETTLE_MS = 150;
const SCROLLBAR_LINGER_MS = 2000;

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}

export type WorkbenchSidebarRootProps =
  & WorkbenchSidebarSlotProps
  & {
    tabLabels: { sessions: string; workbench: string };
    workbenchFace: WorkbenchViewFace;
    workbenchT: (key: WorkbenchKey) => string;
    /** Project folder paths; their Workspaces are hidden from the sessions region. */
    hiddenWorkspacePaths: readonly string[];
  };

export function WorkbenchSidebarRoot({
  collapsed,
  width,
  startSession,
  openProjectSession,
  toggleSidebar,
  t,
  renderSlot,
  tabLabels,
  workbenchFace,
  workbenchT,
  hiddenWorkspacePaths,
}: WorkbenchSidebarRootProps) {
  const [settled, setSettled] = useState(collapsed);
  useEffect(() => {
    if (!collapsed) {
      setSettled(false);
      return;
    }
    const timer = window.setTimeout(() => { setSettled(true); }, COLLAPSE_SETTLE_MS);
    return () => { window.clearTimeout(timer); };
  }, [collapsed]);

  const wide = !collapsed || !settled;
  const lastWideWidth = useRef(width);
  if (!collapsed) lastWideWidth.current = width;

  const everWide = useRef(!collapsed);
  if (!collapsed) everWide.current = true;

  const sidebarTab = useSidebarTab();

  const chooseTab = (tab: typeof sidebarTab): void => {
    setSidebarTab(tab);
  };

  const column = useRef<HTMLDivElement>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const lingerTimer = useRef<number | undefined>(undefined);

  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return;
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined;
      setPointerInside(false);
    }, SCROLLBAR_LINGER_MS);
  };

  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current);
    lingerTimer.current = undefined;
  };

  useEffect(() => {
    if (!pointerInside) return;
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom;
      if (inside) cancelLinger();
      else armLinger();
    };
    document.addEventListener("pointermove", onMove);
    return () => {
      document.removeEventListener("pointermove", onMove);
      cancelLinger();
    };
  }, [pointerInside]);

  const [workbenchMounted, setWorkbenchMounted] = useState(sidebarTab === "workbench");
  useEffect(() => {
    if (sidebarTab === "workbench") setWorkbenchMounted(true);
  }, [sidebarTab]);

  const sessionsVisible = !wide || sidebarTab === "sessions";
  const workbenchVisible = wide && sidebarTab === "workbench";

  return (
    <div
      ref={column}
      data-plugin="dsh-workbench"
      data-surface="sidebar"
      className={cx(
        !wide && "collapsed",
        !wide && everWide.current && "railIn",
        collapsed && wide && "fading",
        !pointerInside && "quietBars",
      )}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger();
        setPointerInside(true);
      }}
      onPointerLeave={() => { armLinger(); }}
    >
      <div className="logoRow">
        {wide && (
          <button
            type="button"
            className={cx("brandButton", "wide")}
            aria-label={t("session.new.label")}
            onClick={() => { startSession(); }}
          >
            <WorkbenchBrand />
          </button>
        )}
        <Tooltip label={collapsed ? t("toggle.open") : t("toggle.collapse")} delayMs={500}>
          <button
            type="button"
            className={cx("iconButton", "toggle")}
            aria-label={collapsed ? t("toggle.open") : t("toggle.collapse")}
            onClick={() => { toggleSidebar(); }}
          >
            {!wide && (
              <span className="railBrand">
                <WorkbenchBrand compact />
              </span>
            )}
            <IconPanelLeftOutline16 className="panelIcon" size={wide ? 16 : 18} />
          </button>
        </Tooltip>
      </div>

      {!wide && (
        <Tooltip label={t("session.new.label")} delayMs={500}>
          <button
            type="button"
            className="newSession"
            aria-label={t("session.new.label")}
            onClick={() => { startSession(); }}
          >
            <IconNewChatOutline16 size={18} />
          </button>
        </Tooltip>
      )}

      {wide && (
        <div className="tabRow">
          <div className="tabList" role="tablist" aria-label={tabLabels.sessions}>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "sessions"}
              className={cx("tabButton", sidebarTab === "sessions" && "active")}
              onClick={() => { chooseTab("sessions"); }}
            >
              <IconNewChatOutline16 size={14} />
              {tabLabels.sessions}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "workbench"}
              className={cx("tabButton", sidebarTab === "workbench" && "active")}
              onClick={() => { chooseTab("workbench"); }}
            >
              <IconBrowseOutline16 size={14} />
              {tabLabels.workbench}
            </button>
          </div>
        </div>
      )}

      <div className="regionArea">
        <div className={cx("regionPane", !sessionsVisible && "hidden")}>
          {wide && (
            <div className="headerNewSession">
              <Tooltip label={t("session.new.label")} delayMs={500}>
                <button
                  type="button"
                  className="iconButton"
                  aria-label={t("session.new.label")}
                  onClick={() => { startSession(); }}
                >
                  <IconNewChatOutline16 size={16} />
                </button>
              </Tooltip>
            </div>
          )}
          {renderSlot("sidebar.workspaces", {
            wide,
            expandSidebar: () => { if (collapsed) toggleSidebar(); },
            hiddenWorkspacePaths,
          })}
        </div>
        {workbenchMounted && (
          <div className={cx("regionPane", !workbenchVisible && "hidden")}>
            <WorkbenchSidebarPanel
              t={workbenchT}
              openProjectSession={openProjectSession}
              {...workbenchFace}
            />
          </div>
        )}
      </div>

      <div className="footArea">
        <div className="footerActions">
          {renderSlot("sidebar.footer.action", { wide })}
        </div>
        <div className="settingsArea">
          {renderSlot("sidebar.settings", { wide })}
        </div>
      </div>
    </div>
  );
}
