import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  dsh?: { client?: { inject?: string[] } };
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
) as PackageManifest;
const clientSource = readFileSync(
  resolve(import.meta.dirname, "../src/client/index.tsx"),
  "utf8",
);

describe("DSH Desktop compatibility manifest", () => {
  it("does not force-load the runtime removed by DSH 0.1.2", () => {
    expect(manifest.dsh?.client?.inject).not.toContain("@deepseek-ai/dsh-client-runtime");
    expect(manifest.peerDependencies).not.toHaveProperty("@deepseek-ai/dsh-client-runtime");
  });

  it("keeps the shared client surfaces needed by both host generations", () => {
    expect(manifest.dsh?.client?.inject).toEqual(expect.arrayContaining([
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-ui-layout",
      "@deepseek-ai/dsh-client-ui-primitives",
      "@deepseek-ai/dsh-client-ui-slots",
      "@deepseek-ai/dsh-client-ui-workspace",
    ]));
  });

  it("declares every verified DSH package generation through 0.1.2-rc.1", () => {
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (!name.startsWith("@deepseek-ai/dsh-")) continue;
      expect(range, name).toContain("0.1.1-rc.2");
      expect(range, name).toContain("0.1.2-alpha.1");
      expect(range, name).toContain("0.1.2-alpha.2");
      expect(range, name).toContain("0.1.2-rc.1");
    }
  });

  it("compiles against one coherent 0.1.2-rc.1 DSH package cohort", () => {
    for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) {
      if (!name.startsWith("@deepseek-ai/dsh-")) continue;
      expect(version, name).toBe("0.1.2-rc.1");
    }
  });

  it("embeds the Workbench region when Desktop forces ui-sidebar on", () => {
    expect(clientSource).toContain("if (desktopUsesOfficialSidebar())");
    expect(clientSource).toContain('ctx.slots.inject("sidebar.workspaces"');
    expect(clientSource).toContain('name: "sidebar.workspaces"');
    expect(clientSource).toContain('"sidebar.settings": { kind: "single", scope: "root" }');
    expect(clientSource).toContain('"sidebar.footer.action": { kind: "list", scope: "root" }');
    expect(clientSource).toContain('"sidebar.settings.trailing": { kind: "list", scope: "root" }');
  });
});
