import { useEffect, useState } from "react";
import { Button, IconChevronDownOutline14 } from "@deepseek-ai/dsh-client-ui-primitives";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";

import type { WorkbenchViewFace } from "./face.ts";
import type { WorkbenchKey } from "./locales.ts";
import "./WorkbenchSettingsCard.css";

export type WorkbenchSettingsCardProps =
  & PropsRuntime<"settings.plugin.item">
  & PropsLocale<"dsh.workbench">
  & InjectFace<
    Pick<WorkbenchViewFace, "ready" | "getSettings" | "setWorkspaceRoot" | "pickDirectory">
  >;

export function WorkbenchSettingsCard({
  t,
  ready,
  getSettings,
  setWorkspaceRoot,
  pickDirectory,
}: WorkbenchSettingsCardProps) {
  const [open, setOpen] = useState(false);
  const [savedRoot, setSavedRoot] = useState("");
  const [draftRoot, setDraftRoot] = useState("");
  const [loaded, setLoaded] = useState(false);
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
      setLoaded(true);
    }, () => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, getSettings]);

  const dirty = draftRoot !== savedRoot;
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
    if (draftRoot === "") return;
    setSaving(true);
    setFailed(false);
    setSaved(false);
    try {
      await setWorkspaceRoot(draftRoot);
      setSavedRoot(draftRoot);
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
              disabled={!dirty || saving || draftRoot === "" || !loaded}
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
