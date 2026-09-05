import { describe, expect, it } from "vitest";
import type {
  SessionId,
  SessionListState,
  WorkspaceId,
  WorkspaceView,
} from "../src/client/dshCompatibility.ts";

import {
  deriveActiveSessions,
  deriveBasicSessionPartition,
  deriveUnmanagedSessions,
  deriveWorkbenchSessions,
  inferLegacyRootAliases,
  isPathInside,
} from "../src/client/sidebar/sessionOwnership.ts";

const sid = (value: string) => value as SessionId;
const wid = (value: string) => value as WorkspaceId;

function sessions(): SessionListState {
  const rows = [
    { id: sid("plain"), displayTitle: "普通会话", cwd: "/Users/me/HARNESS", blank: false, running: false, updatedAt: 50 },
    { id: sid("root"), displayTitle: "工作台会话", cwd: "/work", blank: false, running: false, updatedAt: 40 },
    { id: sid("customer"), displayTitle: "客户会话", cwd: "/work/acme", blank: false, running: false, updatedAt: 30 },
    { id: sid("project"), displayTitle: "项目会话", cwd: "/work/acme/site", blank: false, running: true, updatedAt: 20 },
    { id: sid("blank"), displayTitle: "空白", cwd: "/Users/me/HARNESS", blank: true, running: false, updatedAt: 10 },
  ] as const;
  return {
    ids: rows.map((row) => row.id),
    byId: Object.fromEntries(rows.map((row) => [row.id, row])),
    current: sid("plain"),
    phase: "ready",
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as SessionListState;
}

function workspace(id: string, path: string, sessionIds: string[]): WorkspaceView {
  return {
    workspaceId: wid(id),
    path,
    title: path.split("/").at(-1) ?? path,
    sessionIds: sessionIds.map(sid),
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
  };
}

describe("会话归属", () => {
  it("使用目录边界而不是字符串前缀", () => {
    expect(isPathInside("/work/acme", "/work")).toBe(true);
    expect(isPathInside("/workbench", "/work")).toBe(false);
  });

  it("普通会话扁平显示，工作台根目录内会话全部排除", () => {
    const workspaces = [
      workspace("outside", "/Users/me/HARNESS", ["plain", "blank"]),
      workspace("root", "/work", ["root"]),
      workspace("customer", "/work/acme", ["customer"]),
      workspace("project", "/work/acme/site", ["project"]),
    ];
    expect(deriveUnmanagedSessions(sessions(), workspaces, [], ["/work"]).map((row) => row.id))
      .toEqual([sid("plain")]);
  });

  it("基础会话项目按普通 DSH Workspace 分组且不与最近会话重复", () => {
    const workspaces = [
      workspace("outside", "/Users/me/HARNESS", ["plain", "blank"]),
      workspace("root", "/work", ["root"]),
    ];
    const result = deriveBasicSessionPartition(sessions(), workspaces, [], ["/work"]);
    expect(result.loose).toEqual([]);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.title).toBe("HARNESS");
    expect(result.projects[0]?.sessions.map((row) => row.id)).toEqual([sid("plain")]);
  });

  it("没有 Workspace 记账的会话保留在未归类兜底区", () => {
    const result = deriveBasicSessionPartition(sessions(), [], [], ["/work"]);
    expect(result.loose.map((row) => row.id)).toEqual([sid("plain")]);
    expect(result.projects).toEqual([]);
  });

  it("工作台会话按最长目录匹配归入客户或项目，其余留在工作台根", () => {
    const workspaces = [
      workspace("root", "/work", ["root"]),
      workspace("customer", "/work/acme", ["customer"]),
      workspace("project", "/work/acme/site", ["project"]),
    ];
    const result = deriveWorkbenchSessions(sessions(), workspaces, [], "/work", [], [
      { id: "customer-1", path: "/work/acme", kind: "customer" },
      { id: "project-1", path: "/work/acme/site", kind: "project" },
    ]);
    expect(result.root.map((row) => row.id)).toEqual([sid("root")]);
    expect(result.byTargetId["customer-1"]?.map((row) => row.id)).toEqual([sid("customer")]);
    expect(result.byTargetId["project-1"]?.map((row) => row.id)).toEqual([sid("project")]);
  });

  it("工作台目录移动后，旧 cwd 会按历史根路径归回当前客户或项目", () => {
    const movedSessions = sessions();
    movedSessions.ids = [sid("legacy"), ...movedSessions.ids];
    movedSessions.byId[sid("legacy")] = {
      id: sid("legacy"), displayTitle: "学习周报格式并生成文档",
      cwd: "/Users/me/Documents/HARNESS WORK REPORT/周报",
      blank: false, running: false, updatedAt: 60,
    } as SessionListState["byId"][SessionId];
    const spaces = [{
      id: "report", rootPath: "/Users/me/Documents/HARNESS WORKDESK/HARNESS WORK REPORT",
    }];
    const aliases = inferLegacyRootAliases(
      spaces,
      Object.values(movedSessions.byId).map((session) => session.cwd),
    );
    expect(aliases.report).toEqual(["/Users/me/Documents/HARNESS WORK REPORT"]);
    const result = deriveWorkbenchSessions(
      movedSessions, [], [], spaces[0]!.rootPath, aliases.report ?? [],
      [{ id: "weekly", path: `${spaces[0]!.rootPath}/周报`, kind: "project" }],
    );
    expect(result.byTargetId.weekly?.map((session) => session.id)).toEqual([sid("legacy")]);
    expect(deriveUnmanagedSessions(movedSessions, [], [], [spaces[0]!.rootPath, ...(aliases.report ?? [])])
      .map((session) => session.id)).not.toContain(sid("legacy"));
  });

  it("归档会话不会出现在任一入口", () => {
    const workspaces = [workspace("outside", "/Users/me/HARNESS", ["plain"])];
    expect(deriveUnmanagedSessions(sessions(), workspaces, [sid("plain")], ["/work"]))
      .toEqual([]);
  });

  it("全局进行中视图按等待处理、运行中、刚完成排序并标注所属区域", () => {
    const state = sessions();
    state.byId[sid("plain")] = {
      ...state.byId[sid("plain")]!,
      pendingInteraction: "question",
    };
    state.byId[sid("customer")] = {
      ...state.byId[sid("customer")]!,
      completed: true,
    };
    const workspaces = [
      workspace("outside", "/Users/me/HARNESS", ["plain"]),
      workspace("customer", "/work/acme", ["customer"]),
      workspace("project", "/work/acme/site", ["project"]),
    ];
    const result = deriveActiveSessions(state, workspaces, [], [
      { id: "client-work", name: "客户工作台", rootPath: "/work" },
    ], {});
    expect(result.map((row) => [row.id, row.activity])).toEqual([
      [sid("plain"), "pending"],
      [sid("project"), "running"],
      [sid("customer"), "completed"],
    ]);
    expect(result.map((row) => row.ownerLabel)).toEqual([
      "HARNESS",
      "客户工作台 / site",
      "客户工作台 / acme",
    ]);
    expect(result.map((row) => row.spaceId)).toEqual([undefined, "client-work", "client-work"]);
  });

  it("进行中视图兼容工作台迁移前的历史根路径并排除归档会话", () => {
    const state = sessions();
    state.byId[sid("project")] = {
      ...state.byId[sid("project")]!,
      cwd: "/legacy/acme/site",
    };
    const result = deriveActiveSessions(state, [], [sid("customer")], [
      { id: "client-work", name: "客户工作台", rootPath: "/work" },
    ], { "client-work": ["/legacy"] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: sid("project"),
      activity: "running",
      ownerLabel: "客户工作台 / acme / site",
      spaceId: "client-work",
    });
  });
});
