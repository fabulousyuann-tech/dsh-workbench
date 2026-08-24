import { describe, expect, it } from "vitest";
import { modelRouteAvailable, resolveAuxiliaryCapability, resolveSessionPolicy } from "../src/policy.ts";
import { auxiliaryCapabilities } from "../src/auxiliary.ts";
import type { Context } from "@deepseek-ai/cordis";

describe("Space session policy", () => {
  const space = { model: { provider: "p", model: "space" }, agentPreset: "space-agent", permissionPreset: "read-only", auxiliary: { mode: "inherit" as const } };
  it("优先级为 explicit > Space > DSH global", () => {
    expect(resolveSessionPolicy(space, { model: { provider: "p", model: "explicit" }, agentPreset: null })).toMatchObject({
      model: { model: "explicit" }, permissionPreset: "read-only",
      source: { model: "explicit", agentPreset: "explicit", permissionPreset: "space" },
    });
    expect(resolveSessionPolicy({ auxiliary: { mode: "inherit" } }).source).toEqual({ model: "global", agentPreset: "global", permissionPreset: "global" });
  });
  it("模型、Agent 与权限可独立继承或清空", () => {
    const resolved = resolveSessionPolicy(space, { model: null, permissionPreset: "danger-full-access" });
    expect(resolved.model).toBeUndefined(); expect(resolved.agentPreset).toBe("space-agent"); expect(resolved.permissionPreset).toBe("danger-full-access");
  });
  it("辅助插件缺失时优雅降级，禁用策略优先", () => {
    expect(resolveAuxiliaryCapability({ mode: "inherit" }, false)).toMatchObject({ available: false, reason: "auxiliary-plugin-not-installed" });
    expect(resolveAuxiliaryCapability({ mode: "disabled" }, true)).toMatchObject({ available: false, reason: "disabled-by-space" });
    expect(resolveAuxiliaryCapability({ mode: "override", visionRouteId: "vision" }, true).available).toBe(true);
  });
  it("route 缺失时阻止新会话而不静默换模型", () => {
    const groups = [{ id: "provider", models: [{ id: "available" }] }];
    expect(modelRouteAvailable(groups, { provider: "provider", model: "available" })).toBe(true);
    expect(modelRouteAvailable(groups, { provider: "provider", model: "missing" })).toBe(false);
    expect(modelRouteAvailable(groups, { provider: "removed", model: "available" })).toBe(false);
  });
  it("辅助 Cordis 服务存在/不存在都返回稳定 JSON 契约", async () => {
    const absent = { get: () => undefined } as unknown as Context;
    expect(await auxiliaryCapabilities(absent)).toMatchObject({ installed: false, routes: { vision: [], imageGeneration: [] } });
    const present = { get: () => ({ version: "1", listRoutes: async () => ({ vision: [{ id: "v", label: "Vision" }] }) }) } as unknown as Context;
    expect(await auxiliaryCapabilities(present)).toMatchObject({ installed: true, version: "1", routes: { vision: [{ id: "v" }], imageGeneration: [] } });
  });
});
