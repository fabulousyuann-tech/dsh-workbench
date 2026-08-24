import { useEffect, useState, useSyncExternalStore } from "react";
import type { SettingsScope } from "@deepseek-ai/dsh-client-runtime/client";
import { Button, IconChevronDownOutline14, Input } from "@deepseek-ai/dsh-client-ui-primitives";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";

import type { Config } from "../config.ts";
import type { WorkbenchViewFace } from "./face.ts";
import type { WorkbenchKey } from "./locales.ts";
import "./WorkbenchSettingsCard.css";

export type WorkbenchSettingsCardProps =
  & PropsRuntime<"settings.plugin.item">
  & PropsLocale<"dsh.workbench">
  & InjectFace<
    Pick<WorkbenchViewFace, "ready" | "getSettings" | "setWorkspaceRoot" | "pickDirectory"> & {
      hostSettings: Pick<SettingsScope<Config>, "getSnapshot" | "subscribe" | "set" | "unset">;
    }
  >;

export function WorkbenchSettingsCard({
  t,
  ready,
  getSettings,
  setWorkspaceRoot,
  pickDirectory,
  hostSettings,
}: WorkbenchSettingsCardProps) {
  const [open, setOpen] = useState(false);
  const [savedRoot, setSavedRoot] = useState("");
  const [draftRoot, setDraftRoot] = useState("");
  const [rootLoaded, setRootLoaded] = useState(false);
  const [savedDataDir, setSavedDataDir] = useState("");
  const [draftDataDir, setDraftDataDir] = useState("");
  const [savedSidebarTitle, setSavedSidebarTitle] = useState("DSH");
  const [draftSidebarTitle, setDraftSidebarTitle] = useState("DSH");
  const [hostLoaded, setHostLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ready()) return;
    let cancelled = false;
    void getSettings().then((settings) => {
      if (cancelled) return;
      setSavedRoot(settings.workspaceRoot);
      setDraftRoot(settings.workspaceRoot);
      setRootLoaded(true);
    }, () => {
      if (!cancelled) setRootLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, getSettings]);

  const hostSnapshot = useSyncExternalStore(
    (listener) => hostSettings.subscribe(listener),
    () => hostSettings.getSnapshot(),
  );
  const resolvedDataDir = hostSnapshot.value?.dataDir;
  const resolvedSidebarTitle = hostSnapshot.value?.sidebarTitle ?? "DSH";
  useEffect(() => {
    if (hostSnapshot.status !== "ready" || resolvedDataDir === undefined) return;
    setSavedDataDir(resolvedDataDir);
    setDraftDataDir((current) => !hostLoaded || current === savedDataDir ? resolvedDataDir : current);
    setHostLoaded(true);
    setSavedSidebarTitle(resolvedSidebarTitle);
    setDraftSidebarTitle((current) => !hostLoaded || current === savedSidebarTitle ? resolvedSidebarTitle : current);
  }, [hostLoaded, hostSnapshot.status, resolvedDataDir, resolvedSidebarTitle, savedDataDir, savedSidebarTitle]);

  const rootDirty = draftRoot !== savedRoot;
  const dataDirDirty = draftDataDir !== savedDataDir;
  const sidebarTitleDirty = draftSidebarTitle !== savedSidebarTitle;
  const dirty = rootDirty || dataDirDirty || sidebarTitleDirty;
  const loaded = rootLoaded && hostLoaded;
  const title = t("settings.title" as WorkbenchKey);

  const onPick = async () => {
    const path = await pickDirectory();
    if (path === null) return;
    setDraftRoot(path);
    setSaved(false);
    setFailed(false);
  };

  const onSave = async () => {
    if (!dirty || saving) return;
    if (draftRoot === "" || draftDataDir.trim() === "" || draftSidebarTitle.trim() === "") return;
    setSaving(true);
    setFailed(false);
    setSaved(false);
    try {
      if (rootDirty) {
        await setWorkspaceRoot(draftRoot);
        setSavedRoot(draftRoot);
      }
      if (dataDirDirty) {
        const nextDataDir = draftDataDir.trim();
        await hostSettings.set("dataDir", nextDataDir);
        if (hostSettings.getSnapshot().value?.dataDir !== nextDataDir) {
          throw new Error("dataDir settings write was rejected");
        }
        setSavedDataDir(nextDataDir);
        setDraftDataDir(nextDataDir);
      }
      if (sidebarTitleDirty) {
        const nextSidebarTitle = draftSidebarTitle.trim();
        await hostSettings.set("sidebarTitle", nextSidebarTitle);
        setSavedSidebarTitle(nextSidebarTitle);
        setDraftSidebarTitle(nextSidebarTitle);
      }
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li data-plugin="dsh-workbench" data-surface="settings-card" className={open ? "card open" : "card"}>
      <button
        type="button"
        className="header"
        aria-expanded={open}
        aria-label={`${t((open ? "settings.collapse" : "settings.expand") as WorkbenchKey)}: ${title}`}
        onClick={() => { setOpen(!open); }}
      >
        <span className="headText">
          <span className="name">{title}</span>
          <span className="description">{t("settings.description" as WorkbenchKey)}</span>
        </span>
        {dirty && <span className="pending">{t("settings.save" as WorkbenchKey)}</span>}
        <IconChevronDownOutline14 className={open ? "chevron open" : "chevron"} />
      </button>
      {open && (
        <div className="body">
          <label className="field">
            <span className="fieldLabel">{t("settings.workspaceRoot" as WorkbenchKey)}</span>
            <span className="fieldHint">{t("settings.workspaceRootHint" as WorkbenchKey)}</span>
            <span className="pathRow">
              <span className={draftRoot === "" ? "path empty" : "path"}>
                {draftRoot === "" ? t("settings.workspaceRootEmpty" as WorkbenchKey) : draftRoot}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => { void onPick(); }}>
                {t("settings.pick" as WorkbenchKey)}
              </Button>
            </span>
          </label>
          <label className="field" htmlFor="dsh-workbench-data-dir">
            <span className="fieldLabel">{t("settings.dataDir" as WorkbenchKey)}</span>
            <span className="fieldHint">{t("settings.dataDirHint" as WorkbenchKey)}</span>
            <Input
              id="dsh-workbench-data-dir"
              className="pathInput"
              value={draftDataDir}
              disabled={!hostLoaded || saving || !hostSnapshot.writable}
              onChange={(event) => {
                setDraftDataDir(event.target.value);
                setSaved(false);
                setFailed(false);
              }}
            />
          </label>
          <label className="field" htmlFor="dsh-workbench-sidebar-title">
            <span className="fieldLabel">{t("settings.sidebarTitle" as WorkbenchKey)}</span>
            <span className="fieldHint">{t("settings.sidebarTitleHint" as WorkbenchKey)}</span>
            <Input
              id="dsh-workbench-sidebar-title"
              value={draftSidebarTitle}
              disabled={!hostLoaded || saving || !hostSnapshot.writable}
              onChange={(event) => {
                setDraftSidebarTitle(event.target.value);
                setSaved(false);
                setFailed(false);
              }}
            />
          </label>
          <div className="footer">
            {failed && <p className="failed" role="status">{t("settings.saveFailed" as WorkbenchKey)}</p>}
            {saved && !dirty && <p className="ok" role="status">{t("settings.saved" as WorkbenchKey)}</p>}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!dirty || saving || !loaded}
              onClick={() => {
                setDraftRoot(savedRoot);
                setDraftDataDir(savedDataDir);
                setDraftSidebarTitle(savedSidebarTitle);
                setFailed(false);
                setSaved(false);
              }}
            >
              {t("settings.discard" as WorkbenchKey)}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={!dirty || saving || draftRoot === "" || draftDataDir.trim() === "" || draftSidebarTitle.trim() === "" || !loaded}
              onClick={() => { void onSave(); }}
            >
              {t((saving ? "settings.saving" : "settings.save") as WorkbenchKey)}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
