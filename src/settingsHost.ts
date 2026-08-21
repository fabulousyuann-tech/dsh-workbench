import Schema from "@deepseek-ai/schemastery";
import { settingsNamespace, type SettingsProvider } from "@deepseek-ai/dsh-settings";

import { WORKBENCH_SETTINGS_NAMESPACE } from "./settingsContract.ts";

export const WORKBENCH_SETTINGS_DISCOVERY_SCHEMA = Schema.object({});

export function registerWorkbenchSettingsNamespace(
  settings: Pick<SettingsProvider, "register">,
): void {
  settings.register(
    settingsNamespace(WORKBENCH_SETTINGS_NAMESPACE),
    WORKBENCH_SETTINGS_DISCOVERY_SCHEMA,
  );
}
