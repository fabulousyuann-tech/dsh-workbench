import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import {
  IconCloseFill14,
  IconChevronDownOutline14,
  IconPlusOutline16,
  IconSettingsOutline16,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";

import { SPACE_COLORS, SPACE_ICONS } from "../../types.ts";
import type { DshModelGroup, ModelRouteRef, SearchSpacesResult, SpaceStatus } from "../../types.ts";
import type { WorkbenchViewFace } from "../face.ts";
import type { WorkbenchKey } from "../locales.ts";
import "./SpaceContextRail.css";

function initials(name: string): string { return [...name.trim()].slice(0, 2).join("").toUpperCase() || "S"; }
function modelValue(route?: ModelRouteRef): string { return route === undefined ? "" : JSON.stringify([route.provider, route.model]); }
function modelRoute(value: string): ModelRouteRef | undefined {
  if (value === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
      return { provider: parsed[0], model: parsed[1] };
    }
  } catch {}
  return undefined;
}

export function SpaceContextRail({ face, t, children }: {
  face: WorkbenchViewFace;
  t: (key: WorkbenchKey) => string;
  children?: ReactNode;
}) {
  const [spaces, setSpaces] = useState<SpaceStatus[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [defaultId, setDefaultId] = useState("");
  const [manager, setManager] = useState(false);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [global, setGlobal] = useState<SearchSpacesResult>();
  const [expandedSpaceId, setExpandedSpaceId] = useState<string>();
  const [modelGroups, setModelGroups] = useState<DshModelGroup[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string>();

  const reload = async (): Promise<void> => {
    try {
      const listed = await face.listSpaces(); setSpaces(listed.spaces);
      setSelectedId(listed.selectedSpaceId); setDefaultId(listed.defaultSpaceId); setError(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load Spaces"); }
  };
  const loadModels = async (): Promise<void> => {
    setModelsLoading(true); setModelsError(undefined);
    try { setModelGroups(await face.listModels()); }
    catch (cause) { setModelsError(cause instanceof Error ? cause.message : t("space.modelsUnavailable")); }
    finally { setModelsLoading(false); }
  };
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    if (!manager) return;
    void reload(); void loadModels();
    const onFocus = (): void => { void reload(); };
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("focus", onFocus); };
  }, [manager]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setPalette(true); }
    };
    window.addEventListener("keydown", onKey); return () => { window.removeEventListener("keydown", onKey); };
  }, [selectedId]);
  useEffect(() => {
    if (!palette && !manager) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void face.searchSpaces(query).then((value) => { if (!controller.signal.aborted) setGlobal(value); }, () => {}); }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [palette, manager, query, face]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" ? spaces : spaces.filter((space) => `${space.name} ${space.rootPath}`.toLowerCase().includes(q));
  }, [spaces, query]);

  const movePaletteFocus = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!["ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") { setPalette(false); return; }
    const buttons = [...(event.currentTarget.closest(".spacePaletteResults")?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const current = buttons.indexOf(event.currentTarget);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    buttons[(current + delta + buttons.length) % buttons.length]?.focus();
  };

  const select = async (spaceId: string): Promise<void> => {
    if (busy) return;
    if (spaceId === selectedId) {
      setExpandedSpaceId(expandedSpaceId === spaceId ? undefined : spaceId);
      return;
    }
    setBusy(true); try { await face.setSelectedSpace(spaceId); setSelectedId(spaceId); setPalette(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Switch failed"); }
    finally { setBusy(false); setExpandedSpaceId(spaceId); }
  };

  const mutate = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError(undefined);
    try { await work(); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Operation failed"); }
    finally { setBusy(false); }
  };

  const add = async (): Promise<void> => {
    const rootPath = await face.pickDirectory(); if (rootPath === null) return;
    setBusy(true); setError(undefined);
    try {
      const created = await face.createSpace({ rootPath });
      await face.setSelectedSpace(created.id);
      await reload(); setExpandedSpaceId(created.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Operation failed"); }
    finally { setBusy(false); }
  };

  const relocate = async (space: SpaceStatus): Promise<void> => {
    if (busy) return;
    const rootPath = await face.pickDirectory();
    if (rootPath === null || rootPath === space.rootPath) return;
    const confirmed = window.confirm(
      t("space.pathChangeConfirm")
        .replace("{name}", space.name)
        .replace("{old}", space.rootPath)
        .replace("{next}", rootPath),
    );
    if (!confirmed) return;
    await mutate(() => face.updateSpace({ spaceId: space.id, rootPath }));
  };
  return <>
    <section className="spaceContext library" aria-label={t("space.label")}>
      <div className="spaceLibraryHeading">
        <strong>{t("space.section")}</strong>
        <Tooltip label={t("space.settings")} delayMs={400}>
          <button type="button" className="spaceManageRail" aria-label={t("space.settings")} onClick={() => { setManager(true); }}><IconSettingsOutline16 size={15} /></button>
        </Tooltip>
        <span className="spaceLibraryHeadingSpacer" aria-hidden="true" />
        <Tooltip label={t("space.add")} delayMs={400}>
          <button type="button" disabled={busy} aria-label={t("space.add")} onClick={() => { void add(); }}><IconPlusOutline16 size={15} /></button>
        </Tooltip>
      </div>
      <div className="spaceLibraryList">
        {spaces.map((space) => {
          const expanded = space.id === selectedId && expandedSpaceId === space.id;
          return <div key={space.id} className={expanded ? "spaceLibraryGroup expanded" : "spaceLibraryGroup"}>
            <button
              type="button"
              className={space.id === selectedId ? "spaceLibraryRow selected" : "spaceLibraryRow"}
              aria-expanded={expanded}
              aria-label={space.name}
              disabled={busy}
              onClick={() => { void select(space.id); }}
            >
              <span className={`spaceRailBadge color-${space.color}`}>{initials(space.name)}</span>
              <span className="spaceLibraryName">{space.name}</span>
              {space.pathStatus === "missing" && <span className="spaceRailMissing" aria-label={t("space.folderMissing")}>!</span>}
              <IconChevronDownOutline14 className={expanded ? "spaceLibraryChevron open" : "spaceLibraryChevron"} />
            </button>
            {space.id === selectedId && (
              <div
                className={expanded ? "spaceLibraryChildren open" : "spaceLibraryChildren"}
                aria-hidden={!expanded}
              >
                <div className="spaceLibraryChildrenInner">{children}</div>
              </div>
            )}
          </div>;
        })}
      </div>
      {error !== undefined && <p className="spaceLibraryError" role="alert">{error}</p>}
    </section>

    {palette && <div className="spaceOverlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPalette(false); }}>
      <section className="spacePalette" role="dialog" aria-modal="true" aria-label={t("space.search")}>
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(".spacePaletteResults button")?.focus(); } if (event.key === "Escape") setPalette(false); }} placeholder={t("space.search")} aria-label={t("space.search")} />
        <div className="spacePaletteResults">{filtered.map((space) => <button type="button" key={space.id} onKeyDown={movePaletteFocus} onClick={() => { void select(space.id); }}>
          <span className={`spaceDot color-${space.color}`}>{initials(space.name)}</span><span><strong>{space.name}</strong><small>{space.rootPath}</small></span>
        </button>)}
        {(global?.projects ?? []).map((project) => <button type="button" key={`${project.spaceId}:${project.id}`} onKeyDown={movePaletteFocus} onClick={() => { void (async () => { await select(project.spaceId); await face.openPath(project.folderPath); })(); }}>
          <span className="spaceDot color-slate">P</span><span><strong>{project.title}</strong><small>{project.spaceName} · {project.customerName}</small></span>
        </button>)}</div>
        <footer><span>⌘/Ctrl K</span><button type="button" onClick={() => { setPalette(false); }}>{t("space.close")}</button></footer>
      </section>
    </div>}

    {manager && <div className="spaceOverlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setManager(false); }}>
      <section className="spaceManager" role="dialog" aria-modal="true" aria-label={t("space.manage")}>
        <header><div><h2>{t("space.title")}</h2><p>{t("space.description")}</p></div><button type="button" aria-label={t("space.close")} onClick={() => { setManager(false); }}><IconCloseFill14 /></button></header>
        {error !== undefined && <p className="spaceError" role="alert">{error}</p>}
        <div className="spaceManagerList">{spaces.map((space, index) => <article key={space.id} className={space.id === selectedId ? "selected" : ""}>
          <div className="spaceManagerLead"><span className={`spaceDot color-${space.color}`}>{initials(space.name)}</span><div><strong>{space.name}</strong></div>
            <button type="button" className="spaceRemoveButton" disabled={spaces.length === 1 || busy} title={spaces.length === 1 ? t("space.lastRequired") : t("space.remove")} onClick={() => { if (window.confirm(t("space.removeConfirm").replace("{name}", space.name))) void mutate(() => face.removeSpace(space.id)); }}>{t("space.remove")}</button>
          </div>
          <p className="spaceOverview">{t("space.customersProjects").replace("{c}", String(global?.overview.find((item) => item.spaceId === space.id)?.customers ?? 0)).replace("{p}", String(global?.overview.find((item) => item.spaceId === space.id)?.projects ?? 0))}</p>
          <div className="spacePathField">
            <div><span>{t("space.path")}</span><code title={space.rootPath}>{space.rootPath}</code><small>{t("space.pathHint")}</small></div>
            <button type="button" disabled={busy} onClick={() => { void relocate(space); }}>{t("space.changePath")}</button>
          </div>
          <div className="spaceFields">
            <label>{t("space.name")}<input defaultValue={space.name} onBlur={(event) => { if (event.target.value !== space.name) void mutate(() => face.updateSpace({ spaceId: space.id, name: event.target.value })); }} /></label>
            <label>{t("space.color")}<select value={space.color} onChange={(event) => { void mutate(() => face.updateSpace({ spaceId: space.id, color: event.target.value as typeof space.color })); }}>{SPACE_COLORS.map((color) => <option key={color}>{color}</option>)}</select></label>
            <label>{t("space.icon")}<select value={space.icon} onChange={(event) => { void mutate(() => face.updateSpace({ spaceId: space.id, icon: event.target.value as typeof space.icon })); }}>{SPACE_ICONS.map((icon) => <option key={icon}>{icon}</option>)}</select></label>
          </div>
          <details className="policyFields"><summary>{t("space.policy")}</summary><p>{t("space.policyHint")}</p><div>
            <label className="spaceModelField">{t("space.modelId")}<select value={modelValue(space.policy.model)} disabled={modelsLoading} onChange={(event) => { const route = modelRoute(event.target.value); void mutate(() => face.updateSpacePolicy({ spaceId: space.id, model: route ?? null })); }}>
              <option value="">{modelsLoading ? t("space.modelsLoading") : t("space.inheritDshModel")}</option>
              {space.policy.model !== undefined && !modelGroups.some((group) => group.id === space.policy.model?.provider && group.models.some((model) => model.id === space.policy.model?.model)) && <option value={modelValue(space.policy.model)}>{space.policy.model.provider}/{space.policy.model.model} · {t("space.modelUnavailable")}</option>}
              {modelGroups.map((group) => <optgroup key={group.id} label={group.name}>{group.models.map((model) => <option key={`${group.id}:${model.id}`} value={modelValue({ provider: group.id, model: model.id })}>{model.name}{model.name === model.id ? "" : ` · ${model.id}`}</option>)}</optgroup>)}
            </select>{modelsError !== undefined && <small className="modelCatalogError" role="alert">{t("space.modelsUnavailable")}: {modelsError}</small>}</label>
            <label>{t("space.agentPreset")}<input defaultValue={space.policy.agentPreset ?? ""} placeholder={t("space.inherit")} onBlur={(event) => { const value = event.target.value.trim(); if (value !== (space.policy.agentPreset ?? "")) void mutate(() => face.updateSpacePolicy({ spaceId: space.id, agentPreset: value === "" ? null : value })); }} /></label>
            <label>{t("space.permissionPreset")}<input defaultValue={space.policy.permissionPreset ?? ""} placeholder={t("space.inherit")} onBlur={(event) => { const value = event.target.value.trim(); if (value !== (space.policy.permissionPreset ?? "")) void mutate(() => face.updateSpacePolicy({ spaceId: space.id, permissionPreset: value === "" ? null : value })); }} /></label>
            <label>{t("space.auxiliary")}<select value={space.policy.auxiliary.mode} onChange={(event) => { void mutate(() => face.updateSpacePolicy({ spaceId: space.id, auxiliary: { ...space.policy.auxiliary, mode: event.target.value as "inherit" | "override" | "disabled" } })); }}><option value="inherit">{t("space.inherit")}</option><option value="override">{t("space.override")}</option><option value="disabled">{t("space.disabled")}</option></select></label>
          </div></details>
          {space.pathStatus === "missing" && <p className="missingCallout">{t("space.folderMissing")}
            <button type="button" onClick={() => { void relocate(space); }}>{t("space.relocate")}</button>
            <button type="button" onClick={() => { setError(undefined); }}>{t("space.keep")}</button>
            <button type="button" disabled={spaces.length === 1 || busy} title={spaces.length === 1 ? t("space.lastRequired") : t("space.remove")} onClick={() => { if (window.confirm(t("space.removeConfirm").replace("{name}", space.name))) void mutate(() => face.removeSpace(space.id)); }}>{t("space.remove")}</button></p>}
          <div className="spaceActions">
            <button type="button" disabled={busy} onClick={() => { void mutate(() => face.updateSpace({ spaceId: space.id, pinned: !space.pinned })); }}>{t(space.pinned ? "space.unpin" : "space.pin")}</button>
            <button type="button" disabled={space.id === defaultId} onClick={() => { void mutate(() => face.setDefaultSpace(space.id)); }}>{t(space.id === defaultId ? "space.default" : "space.makeDefault")}</button>
            <button type="button" disabled={index === 0} onClick={() => { const ids = spaces.map((item) => item.id); [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!]; void mutate(() => face.reorderSpaces(ids)); }}>{t("space.moveUp")}</button>
            <button type="button" disabled={index === spaces.length - 1} onClick={() => { const ids = spaces.map((item) => item.id); [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!]; void mutate(() => face.reorderSpaces(ids)); }}>{t("space.moveDown")}</button>
          </div>
        </article>)}</div>
        <footer><button type="button" onClick={() => { void add(); }}>{t("space.add")}</button></footer>
      </section>
    </div>}
  </>;
}
