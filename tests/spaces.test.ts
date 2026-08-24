import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";

import {
  OverlayFormatError, canonicalizeSpacePath, loadOverlay, overlayPath, overlayProjectKey,
  restoreOverlayBackup, saveOverlay,
} from "../src/overlay.ts";
import { WorkbenchSpaceService } from "../src/spaces.ts";
import { WorkbenchService } from "../src/service.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wb-spaces-"));
  const dataDir = join(root, "data");
  const first = join(root, "first"); const second = join(root, "second");
  await mkdir(first); await mkdir(second); await mkdir(dataDir);
  return { root, dataDir, first, second, spaces: new WorkbenchSpaceService(dataDir, first) };
}

describe("Space v2 migration", () => {
  it("customer-scoped overlay keys escape separator characters", () => {
    expect(overlayProjectKey("space", "a::b", "c")).not.toBe(overlayProjectKey("space", "a", "b::c"));
  });

  it("v1 先备份再无损迁移，重复加载不再生成备份", async () => {
    const { dataDir, first, second } = await fixture();
    const projectPath = join(first, "客户", "项目");
    await writeFile(overlayPath(dataDir), JSON.stringify({
      schemaVersion: 1, workspaceRoot: first, rules: "always test", recentWorkspaces: [second, "/missing"],
      hiddenWorkspaces: [projectPath], members: [{ uid: "u1", name: "User" }],
      projects: { demo: { stage: "execution", archived: true } },
    }));
    const migrated = await loadOverlay(dataDir, first);
    expect(migrated.schemaVersion).toBe(2);
    const canonicalFirst = await canonicalizeSpacePath(first); const canonicalSecond = await canonicalizeSpacePath(second);
    expect(Object.values(migrated.spaces).map((space) => space.rootPath)).toEqual([canonicalFirst, canonicalSecond]);
    expect(migrated.spaces[migrated.defaultSpaceId]!.rules).toBe("always test");
    expect(migrated.spaces[migrated.defaultSpaceId]!.hiddenWorkspacePaths).toEqual([join(canonicalFirst, "客户", "项目")]);
    expect(migrated.projects[overlayProjectKey(migrated.defaultSpaceId, "demo")]).toEqual({ stage: "execution", archived: true });
    expect(migrated.members).toEqual([{ uid: "u1", name: "User" }]);
    const backups = (await readdir(dataDir)).filter((name) => name.includes(".backup.json"));
    expect(backups).toHaveLength(1);
    await loadOverlay(dataDir, first);
    expect((await readdir(dataDir)).filter((name) => name.includes(".backup.json"))).toHaveLength(1);
    await restoreOverlayBackup(dataDir, migrated.migration!.backupPath!);
    expect(JSON.parse(await readFile(overlayPath(dataDir), "utf8"))).toMatchObject({ schemaVersion: 1, workspaceRoot: first });
    expect((await loadOverlay(dataDir, first)).schemaVersion).toBe(2);
  });

  it("损坏 overlay 报可操作错误且不覆盖原文件", async () => {
    const { dataDir, first } = await fixture(); const invalid = "{ not-json";
    await writeFile(overlayPath(dataDir), invalid);
    await expect(loadOverlay(dataDir, first)).rejects.toBeInstanceOf(OverlayFormatError);
    expect(await readFile(overlayPath(dataDir), "utf8")).toBe(invalid);
    expect((await readdir(dataDir)).filter((name) => name.includes("backup"))).toHaveLength(0);
  });
});

describe("WorkbenchSpaceService", () => {
  it("按 explicit → selected → default 解析，路径重复时复用 Space", async () => {
    const { root, first, second, spaces } = await fixture();
    const initial = await spaces.list(); const defaultId = initial.defaultSpaceId;
    const created = await spaces.create({ rootPath: second, name: "Second" });
    expect((await spaces.create({ rootPath: second })).id).toBe(created.id);
    expect(await spaces.resolve(defaultId, created.id)).toMatchObject({ spaceId: defaultId, source: "explicit" });
    expect(await spaces.resolve(undefined, created.id)).toMatchObject({ spaceId: created.id, source: "selected" });
    await spaces.setSelected(defaultId);
    expect(await spaces.resolve()).toMatchObject({ spaceId: defaultId, source: "default" });
    const link = join(root, "second-link"); await symlink(second, link);
    expect(await canonicalizeSpacePath(link)).toBe(await canonicalizeSpacePath(second));
    expect((await spaces.create({ rootPath: link })).id).toBe(created.id);
  });

  it("支持更新、置顶、排序、默认、策略与移除；移除不删除目录", async () => {
    const { first, second, spaces } = await fixture();
    const initial = await spaces.list(); const firstId = initial.defaultSpaceId;
    const created = await spaces.create({ rootPath: second, color: "violet", icon: "code" });
    const updated = await spaces.update({ spaceId: created.id, name: "研发", pinned: true, rules: "test" });
    expect(updated).toMatchObject({ name: "研发", pinned: true, rules: "test" });
    await spaces.reorder([created.id, firstId]);
    await spaces.setDefault(created.id);
    const policy = await spaces.updatePolicy({ spaceId: created.id,
      model: { provider: "openai", model: "gpt", reasoningEffort: "high" },
      agentPreset: "coder", permissionPreset: "read-only", auxiliary: { mode: "disabled" } });
    expect(policy.policy).toMatchObject({ agentPreset: "coder", permissionPreset: "read-only", auxiliary: { mode: "disabled" } });
    const removed = await spaces.remove(created.id);
    expect(removed.defaultSpaceId).toBe(firstId);
    expect((await stat(second)).isDirectory()).toBe(true);
    const restored = await spaces.create({ rootPath: second, name: "研发恢复" });
    expect(restored).toMatchObject({ rootPath: await canonicalizeSpacePath(second), name: "研发恢复" });
    await spaces.remove(firstId);
    expect((await stat(first)).isDirectory()).toBe(true);
    await expect(spaces.remove(restored.id)).rejects.toThrow("last Space");
  });

  it("缺失路径有显式状态并可 relocate 或 keep", async () => {
    const { root, second, spaces } = await fixture();
    const missing = join(root, "gone"); const created = await spaces.create({ rootPath: missing });
    expect((await spaces.list()).spaces.find((space) => space.id === created.id)?.pathStatus).toBe("missing");
    await expect(spaces.resolve(created.id, undefined, true)).rejects.toMatchObject({ code: "space-path-missing" });
    const relocated = await spaces.update({ spaceId: created.id, rootPath: second });
    expect(relocated.rootPath).toBe(await canonicalizeSpacePath(second));
    expect((await spaces.list()).spaces.find((space) => space.id === created.id)?.pathStatus).toBe("available");
  });

  it("可用工作台也能重新关联到已移动目录，并拒绝占用其他工作台路径", async () => {
    const { root, dataDir, first, second, spaces } = await fixture();
    const listed = await spaces.list();
    const moved = join(root, "moved");
    await mkdir(moved);
    const store = await spaces.store();
    store.spaces[listed.defaultSpaceId]!.hiddenWorkspacePaths = [join(store.spaces[listed.defaultSpaceId]!.rootPath, "客户", "已删除项目")];
    await saveOverlay(dataDir, store);
    const updated = await spaces.update({ spaceId: listed.defaultSpaceId, rootPath: moved });
    const canonicalMoved = await canonicalizeSpacePath(moved);
    expect(updated.rootPath).toBe(canonicalMoved);
    expect(updated.rootPathHistory).toContain(await canonicalizeSpacePath(first));
    expect(updated.hiddenWorkspacePaths).toEqual([join(canonicalMoved, "客户", "已删除项目")]);
    expect((await spaces.list()).spaces.find((space) => space.id === updated.id)?.pathStatus).toBe("available");
    const another = await spaces.create({ rootPath: second });
    await expect(spaces.update({ spaceId: another.id, rootPath: moved })).rejects.toThrow("already used");
    expect((await stat(first)).isDirectory()).toBe(true);
  });
});

describe("Space scoped project resolution", () => {
  it("同一 Space 的同名项目按客户隔离，拒绝猜测归属", async () => {
    const { dataDir, first } = await fixture();
    for (const customer of ["customer-a", "customer-b"]) {
      await mkdir(join(first, customer, "same-project"), { recursive: true });
      await writeFile(join(first, customer, "same-project", "project.md"), "---\ntitle: Same\n---\n");
    }
    const ctx = new Context(); const service = new WorkbenchService(ctx, { workspaceRoot: first, dataDir });
    const signal = new AbortController().signal;
    try {
      await expect(service.getProject({ id: "same-project" }, signal)).rejects.toThrow(/ambiguous.*customerId/i);
      await service.updateProject({ id: "same-project", customerId: "customer-a", title: "Only A" }, signal);
      expect((await service.getProject({ id: "same-project", customerId: "customer-a" }, signal)).title).toBe("Only A");
      expect((await service.getProject({ id: "same-project", customerId: "customer-b" }, signal)).title).toBe("Same");
    } finally { service.stopWatch(); }
  });

  it("同名项目跨 Space 时拒绝无 spaceId 操作，显式寻址可用", async () => {
    const { dataDir, first, second } = await fixture();
    for (const root of [first, second]) {
      await mkdir(join(root, "customer", "same-project"), { recursive: true });
      await writeFile(join(root, "customer", "same-project", "project.md"), "---\ntitle: Same\n---\n");
    }
    const ctx = new Context(); const service = new WorkbenchService(ctx, { workspaceRoot: first, dataDir });
    try {
      const created = await service.createSpace({ rootPath: second }, new AbortController().signal);
      const listed = await service.listSpaces({}, new AbortController().signal);
      const canonicalFirst = await canonicalizeSpacePath(first);
      const firstId = listed.spaces.find((space) => space.rootPath === canonicalFirst)!.id;
      await expect(service.getProject({ id: "same-project" }, new AbortController().signal)).rejects.toThrow(/ambiguous.*spaceId/i);
      expect((await service.getProject({ id: "same-project", spaceId: firstId }, new AbortController().signal)).folderPath).toContain(first);
      expect((await service.getProject({ id: "same-project", spaceId: created.id }, new AbortController().signal)).folderPath).toContain(second);
    } finally { service.stopWatch(); }
  });
});
