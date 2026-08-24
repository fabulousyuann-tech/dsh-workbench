import type { Context } from "@deepseek-ai/cordis";

import { Config } from "./config.ts";
import { WorkbenchService } from "./service.ts";
import { installWorkbenchSettings } from "./settingsHost.ts";
import { registerWorkbenchTools } from "./tools.ts";

export const name = "dsh-workbench";
export { Config };
export type { Config as ConfigType } from "./config.ts";

export async function apply(ctx: Context, config: Config): Promise<void> {
  const service = new WorkbenchService(ctx, config);
  installWorkbenchSettings(ctx, config, (next) => {
    service.updateConfig(next);
  });
  ctx.inject(["tools"], (toolsCtx) => {
    registerWorkbenchTools(toolsCtx, service);
  });
}
