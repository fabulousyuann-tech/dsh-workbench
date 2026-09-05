import type { Context } from "@deepseek-ai/cordis";
import type { SettingsSectionHooks } from "@deepseek-ai/dsh-settings";

import { Config, validateConfig, type Config as WorkbenchConfig } from "./config.ts";
import { WORKBENCH_SETTINGS_NAMESPACE } from "./settingsContract.ts";

export const WORKBENCH_SETTINGS_NS = WORKBENCH_SETTINGS_NAMESPACE;

export function installWorkbenchSettings(
  ctx: Context,
  entry: WorkbenchConfig,
  onChange: (config: WorkbenchConfig) => void,
): void {
  let source = () => entry;
  const hooks: SettingsSectionHooks<WorkbenchConfig> = {
    validate: validateConfig,
    setSource: (current) => {
      source = current;
    },
    onChange: () => {
      onChange(source());
    },
  };

  ctx.inject(["settings"], (settingsCtx) => {
    const provider = settingsCtx.settings;
    if (typeof provider.installSection === "function") {
      // 0.1.2: the former helper moved onto SettingsProvider.
      provider.installSection(settingsCtx, WORKBENCH_SETTINGS_NS, Config, entry, hooks);
      return;
    }

    // 0.1.1-rc.2 compatibility: reproduce the helper with the stable owner
    // scope surface instead of importing an export removed in 0.1.2.
    const scope = provider.register(WORKBENCH_SETTINGS_NS, Config, {
      base: entry,
      validate: validateConfig,
    });
    source = () => scope.get();
    onChange(source());
    return scope.watch(() => {
      onChange(source());
    });
  });
}
