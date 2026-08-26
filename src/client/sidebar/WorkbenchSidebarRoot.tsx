import { useEffect, useRef, useState } from "react";
import {
  IconNewChatOutline16,
  IconPanelLeftOutline16,
  IconSearchOutline16,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";

import type { WorkbenchViewFace } from "../face.ts";
import type { WorkbenchKey } from "../locales.ts";
import type { WorkbenchSpace } from "../../types.ts";
import { ActiveSessionsPanel } from "./ActiveSessionsPanel.tsx";
import { WorkbenchBrand } from "./WorkbenchBrand.tsx";
import { WorkbenchSidebarPanel } from "./WorkbenchSidebarPanel.tsx";
import { SpaceContextRail } from "./SpaceContextRail.tsx";
import { UnmanagedSessionsPanel } from "./UnmanagedSessionsPanel.tsx";
import { setProjectMapSidebarGeometry } from "../projectMap/store.ts";
import type { WorkbenchSidebarSlotProps } from "./slots.ts";
import "./WorkbenchSidebarRoot.css";

const COLLAPSE_SETTLE_MS = 150;
const SCROLLBAR_LINGER_MS = 2000;

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}

export type WorkbenchSidebarRootProps = WorkbenchSidebarSlotProps & {
  workbenchFace: WorkbenchViewFace;
  workbenchT: (key: WorkbenchKey) => string;
  managedRootPaths: readonly string[];
  spaces: readonly WorkbenchSpace[];
  aliasesBySpace: Readonly<Record<string, readonly string[]>>;
  selectedSpaceId: string | undefined;
  selectedRootPath: string | undefined;
  selectedRootAliases: readonly string[];
  selectedSpaceName: string | undefined;
  sidebarTitle: string;
};

export function WorkbenchSidebarRoot({
  collapsed,
  width,
  startSession,
  openProjectSession,
  startFolderSession,
  startProjectSession,
  moveSessionToProject,
  openSession,
  archiveSession,
  removeBasicProject,
  toggleSidebar,
  t,
  renderSlot,
  workbenchFace,
  workbenchT,
  managedRootPaths,
  spaces,
  aliasesBySpace,
  selectedSpaceId,
  selectedRootPath,
  selectedRootAliases,
  selectedSpaceName,
  sidebarTitle,
  useSessions,
  useWorkspaces,
}: WorkbenchSidebarRootProps) {
  const [settled, setSettled] = useState(collapsed);
  const [query, setQuery] = useState("");
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

  useEffect(() => {
    setProjectMapSidebarGeometry(collapsed ? 56 : width, collapsed);
  }, [collapsed, width]);

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
      onPointerEnter={() => { cancelLinger(); setPointerInside(true); }}
      onPointerLeave={() => { armLinger(); }}
    >
      <div className="logoRow">
        {wide && (
          <button type="button" className="brandButton wide" aria-label={t("session.new.label")} onClick={() => { void startSession(); }}>
            <WorkbenchBrand name={sidebarTitle} />
          </button>
        )}
        <Tooltip label={collapsed ? t("toggle.open") : t("toggle.collapse")} delayMs={500}>
          <button type="button" className="iconButton toggle" aria-label={collapsed ? t("toggle.open") : t("toggle.collapse")} onClick={toggleSidebar}>
            {!wide && <span className="railBrand" aria-hidden="true"><WorkbenchBrand compact /></span>}
            <IconPanelLeftOutline16 className="panelIcon" size={wide ? 16 : 18} />
          </button>
        </Tooltip>
      </div>

      {wide && (
        <div className="sidebarSearch">
          <IconSearchOutline16 size={15} />
          <input value={query} placeholder={workbenchT("sidebar.search")} aria-label={workbenchT("sidebar.search")} onChange={(event) => { setQuery(event.target.value); }} />
          {query !== "" && <button type="button" aria-label={workbenchT("toolbar.search.clear")} onClick={() => { setQuery(""); }}>×</button>}
        </div>
      )}

      <Tooltip label={t("session.new.label")} delayMs={500} disabled={wide}>
        <button type="button" className={wide ? "basicPrimaryNewSession" : "newSession"} aria-label={t("session.new.label")} onClick={() => { void startSession(); }}>
          <IconNewChatOutline16 size={wide ? 15 : 18} />
          {wide && <span>{t("session.new.label")}</span>}
        </button>
      </Tooltip>

      <div className="regionArea">
        {wide && (
          <div className="sidebarLibraryScroll">
            <ActiveSessionsPanel
              t={workbenchT}
              query={query}
              spaces={spaces}
              aliasesBySpace={aliasesBySpace}
              useSessions={useSessions}
              useWorkspaces={useWorkspaces}
              openSession={openSession}
            />
            <UnmanagedSessionsPanel
              t={workbenchT}
              query={query}
              useSessions={useSessions}
              useWorkspaces={useWorkspaces}
              managedRootPaths={managedRootPaths}
              openSession={openSession}
              archiveSession={archiveSession}
              openProjectSession={openProjectSession}
              startProjectSession={startProjectSession}
              moveSessionToProject={moveSessionToProject}
              pickDirectory={workbenchFace.pickDirectory}
              removeBasicProject={removeBasicProject}
            />
            <SpaceContextRail
              face={workbenchFace}
              t={workbenchT}
            >
              <WorkbenchSidebarPanel
                t={workbenchT}
                query={query}
                startFolderSession={startFolderSession}
                openSession={openSession}
                archiveSession={archiveSession}
                useSessions={useSessions}
                useWorkspaces={useWorkspaces}
                selectedSpaceName={selectedSpaceName}
                selectedSpaceId={selectedSpaceId}
                selectedRootPath={selectedRootPath}
                selectedRootAliases={selectedRootAliases}
                onProjectSessionOpen={() => {
                  if (window.matchMedia("(max-width: 959px)").matches && !collapsed) toggleSidebar();
                }}
                {...workbenchFace}
              />
            </SpaceContextRail>
          </div>
        )}
      </div>

      <div className="footArea">
        <div className="footerActions">{renderSlot("sidebar.footer.action", { wide })}</div>
        <div className="settingsRow">
          <div className="settingsArea">{renderSlot("sidebar.settings", { wide })}</div>
          <div className="settingsTrailing">{renderSlot("sidebar.settings.trailing", { wide })}</div>
        </div>
      </div>
    </div>
  );
}
