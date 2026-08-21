import type { Context } from "@deepseek-ai/cordis";

import { Config } from "./config.ts";
import { WorkbenchService } from "./service.ts";
import { registerWorkbenchSettingsNamespace } from "./settingsHost.ts";
import { registerWorkbenchTools } from "./tools.ts";

export const name = "dsh-workbench";
export { Config };
export type { Config as ConfigType } from "./config.ts";

export function apply(ctx: Context, config: Config): void {
  const service = new WorkbenchService(ctx, config);
  ctx.inject(["settings"], (settingsCtx) => {
    registerWorkbenchSettingsNamespace(settingsCtx.settings);
  });
  ctx.inject(["tools"], (toolsCtx) => {
    registerWorkbenchTools(toolsCtx, service);
  });
}
