import type { Context } from "@deepseek-ai/cordis";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";

import { Config, validateConfig, type Config as WorkbenchConfig } from "./config.ts";
import { WORKBENCH_SETTINGS_NAMESPACE } from "./settingsContract.ts";

export const WORKBENCH_SETTINGS_NS = settingsNamespace(WORKBENCH_SETTINGS_NAMESPACE);

export function installWorkbenchSettings(
  ctx: Context,
  entry: WorkbenchConfig,
  onChange: (config: WorkbenchConfig) => void,
): void {
  let source = () => entry;
  installSettingsSection(ctx, WORKBENCH_SETTINGS_NS, Config, entry, {
    validate: validateConfig,
    setSource: (current) => {
      source = current;
    },
    onChange: () => {
      onChange(source());
    },
  });
}
