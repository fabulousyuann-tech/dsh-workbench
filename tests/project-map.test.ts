import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import type {
  CompatibleHistoryEntry,
  SessionId,
  SessionListState,
  WorkspaceId,
  WorkspaceView,
} from "../src/client/dshCompatibility.ts";

import {
  decodeProjectMapLayout,
  deriveProjectGraphSessions,
  layoutProjectSessions,
  projectTurns,
} from "../src/client/projectMap/model.ts";

const sid = (value: string) => value as SessionId;
const wid = (value: string) => value as WorkspaceId;

function sessionState(): SessionListState {
  return {
    ids: [sid("root"), sid("child"), sid("archived"), sid("outside"), sid("subagent")],
    byId: {
      root: { id: sid("root"), displayTitle: "Root", cwd: "/new/root/customer/project", running: false, blank: false, updatedAt: 5 },
      child: { id: sid("child"), displayTitle: "Child", cwd: "/old/root/customer/project", parentId: sid("root"), running: false, blank: false, updatedAt: 4 },
      archived: { id: sid("archived"), displayTitle: "Archived", cwd: "/new/root/customer/project", running: false, blank: false, updatedAt: 3 },
      outside: { id: sid("outside"), displayTitle: "Outside", cwd: "/new/root/customer/other", running: false, blank: false, updatedAt: 2 },
      subagent: { id: sid("subagent"), displayTitle: "Subagent", cwd: "/new/root/customer/project", origin: "subagent", running: false, blank: false, updatedAt: 1 },
    },
    current: sid("root"),
    phase: "ready",
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as SessionListState;
}

describe("project conversation map", () => {
  it("only includes live DSH sessions owned by the selected project, including user forks", () => {
    const workspace = {
      workspaceId: wid("project-workspace"),
      title: "project",
      path: "/new/root/customer/project",
      sessionIds: [sid("root"), sid("archived")],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as WorkspaceView;
    const sessions = deriveProjectGraphSessions(
      sessionState(),
      [workspace],
      [sid("archived")],
      "/new/root",
      ["/old/root"],
      "/new/root/customer/project",
    );

    expect(sessions.map((session) => session.id)).toEqual([sid("root"), sid("child")]);
    expect(sessions[1]?.parentId).toBe(sid("root"));
  });

  it("keeps saved node coordinates while laying out new lineage nodes", () => {
    const sessions = deriveProjectGraphSessions(
      sessionState(),
      [],
      [],
      "/new/root",
      ["/old/root"],
      "/new/root/customer/project",
    );
    const layout = layoutProjectSessions(sessions, { root: { x: 19, y: 23 } });
    expect(layout.root).toEqual({ x: 19, y: 23 });
    expect(layout.child?.x).toBeGreaterThan(layout.root!.x);
  });

  it("projects human turns and counts tools without storing their payloads", () => {
    const events = [
      {
        event: { type: "turn/start", seq: 0, time: 1, data: { turn: 0 } },
      },
      {
        event: {
          type: "user/message",
          seq: 1,
          time: 2,
          data: {
            id: "u",
            role: "user",
            source: { kind: "user" },
            content: [{ type: "text", text: "Plan the release" }],
          },
        },
      },
      {
        event: {
          type: "tool/call",
          seq: 2,
          time: 3,
          data: { turn: 0, step: 0, callId: "c", name: "secret-tool", arguments: "{\"secret\":true}" },
        },
      },
      {
        event: {
          type: "assistant/message",
          seq: 3,
          time: 4,
          data: {
            turn: 0,
            step: 0,
            message: {
              id: "a",
              role: "assistant",
              source: { kind: "model", provider: "p", model: "m" },
              content: [{ type: "text", text: "Release planned" }],
            },
          },
        },
      },
      {
        event: { type: "turn/end", seq: 4, time: 5, data: { turn: 0, reason: { kind: "completed" } } },
      },
    ] as unknown as CompatibleHistoryEntry[];

    expect(projectTurns(events)).toEqual([{
      turn: 0,
      prompt: "Plan the release",
      response: "Release planned",
      toolCount: 1,
      userSeq: 1,
      endSeq: 4,
      endedAt: 5,
      status: "completed",
    }]);
    expect(JSON.stringify(projectTurns(events))).not.toContain("secret-tool");
    expect(JSON.stringify(projectTurns(events))).not.toContain("secret");
  });

  it("sanitizes persisted layout and caps unsafe values", () => {
    const positions = Object.fromEntries(Array.from({ length: 520 }, (_, index) => [`s${index}`, { x: index, y: index }]));
    const decoded = decodeProjectMapLayout({ viewport: { x: 3, y: 4, zoom: 99 }, positions });
    expect(decoded.viewport).toEqual({ x: 3, y: 4, zoom: 1.6 });
    expect(Object.keys(decoded.positions)).toHaveLength(500);
  });

  it("uses the native DSH fork and archive APIs instead of duplicating session data", async () => {
    const source = await readFile(new URL("../src/client/index.tsx", import.meta.url), "utf8");
    expect(source).toContain("sessions.fork({ sessionId, atSeq, increaseTitle: true })");
    expect(source).toContain("ctx.workspaces.archiveSession(sessionId)");
    const modelSource = await readFile(new URL("../src/client/projectMap/model.ts", import.meta.url), "utf8");
    expect(modelSource).not.toContain("tool.arguments");
    expect(modelSource).not.toContain("tool/result");
  });
});
