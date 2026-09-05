import { describe, expect, it, vi } from "vitest";

import {
  agentPresetRemote,
  desktopUsesOfficialSidebar,
  loadSessionHistory,
  modelGroups,
  openWorkspacePath,
  pickWorkspaceDirectory,
  selectSessionModel,
  sessionCreator,
  startWorkspaceSession,
} from "../src/client/dshCompatibility.ts";

function context(modern: object | undefined, legacy: object, sessions: object = {}) {
  return {
    get: (name: string) => name === "uiWorkspace" ? modern : undefined,
    workspaces: legacy,
    sessions,
  };
}

describe("DSH client generation compatibility", () => {
  it("uses uiWorkspace navigation on DSH 0.1.2", async () => {
    const modern = {
      startSession: vi.fn(),
      pickDirectory: vi.fn(async () => "/modern"),
    };
    const legacy = { startSession: vi.fn(), pickDirectory: vi.fn() };
    const ctx = context(modern, legacy);

    startWorkspaceSession(ctx, "workspace-modern" as never);
    await expect(pickWorkspaceDirectory(ctx)).resolves.toBe("/modern");
    expect(modern.startSession).toHaveBeenCalledWith("workspace-modern");
    expect(legacy.startSession).not.toHaveBeenCalled();
  });

  it("falls back to rc.2 workspaces navigation per capability", async () => {
    const modern = { startSession: vi.fn() };
    const legacy = {
      pickDirectory: vi.fn(async () => "/legacy"),
      openPath: vi.fn(async () => undefined),
    };
    const ctx = context(modern, legacy);

    await expect(pickWorkspaceDirectory(ctx)).resolves.toBe("/legacy");
    await openWorkspacePath(ctx, "/legacy/file.txt");
    expect(legacy.openPath).toHaveBeenCalledWith("/legacy/file.txt");
  });

  it("uses the concrete sessions controller for creation", async () => {
    const create = vi.fn(async () => "session-new");
    const ctx = context(undefined, {}, { create });
    await expect(sessionCreator(ctx).create({ cwd: "/workspace" })).resolves.toBe("session-new");
    expect(create).toHaveBeenCalledWith({ cwd: "/workspace" });
  });

  it("discovers the optional modern agent-preset Remote", () => {
    const select = vi.fn();
    const ctx = {
      get: (name: string) => name === "remote.agentPresets" ? { select } : undefined,
      workspaces: {},
      sessions: {},
    };
    expect(agentPresetRemote(ctx)?.select).toBe(select);
  });

  it("uses the 0.1.2 session Remote for model catalog and selection", async () => {
    const modelCatalog = vi.fn(async () => ({
      ok: true,
      value: { groups: [{ id: "deepseek", models: [{ id: "chat" }] }] },
    }));
    const selectModel = vi.fn(async () => ({ ok: true, value: undefined }));
    async function* follow() { yield { type: "snapshot", records: [] }; }
    const remote = { modelCatalog, selectModel, follow };
    const ctx = {
      get: (name: string) => name === "remote.session" ? remote : undefined,
      workspaces: {},
      sessions: {},
    };

    await expect(modelGroups(ctx)).resolves.toEqual([
      { id: "deepseek", models: [{ id: "chat" }] },
    ]);
    await selectSessionModel(ctx, "session-alpha" as never, {
      provider: "deepseek",
      model: "chat",
    });
    expect(selectModel).toHaveBeenCalledWith({
      sessionId: "session-alpha",
      provider: "deepseek",
      model: "chat",
    });
  });

  it("normalizes the 0.1.2 opening follow snapshot into a bounded history page", async () => {
    const event = { type: "user/message", seq: 3, time: 4, data: { turn: 1 } };
    async function* follow() {
      yield {
        type: "snapshot",
        hasMore: true,
        records: [
          { type: "event", event },
          {
            type: "chunks",
            event: {
              type: "chunkrow/text-chunks",
              seq: 4,
              time: 10,
              data: { turn: 1, step: 0, index: 0, dt: [2], texts: ["hel", "lo"] },
            },
          },
          { type: "projection", value: {} },
        ],
      };
    }
    const remote = {
      modelCatalog: vi.fn(),
      selectModel: vi.fn(),
      follow,
    };
    const ctx = {
      get: (name: string) => name === "remote.session" ? remote : undefined,
      workspaces: {},
      sessions: {},
    };

    await expect(loadSessionHistory(ctx, "session-alpha" as never, 20)).resolves.toEqual({
      entries: [
        { event },
        {
          event: {
            type: "assistant/chunk",
            seq: 4,
            time: 10,
            data: {
              turn: 1,
              step: 0,
              chunk: { type: "text-delta", index: 0, text: "hel" },
            },
          },
        },
        {
          event: {
            type: "assistant/chunk",
            seq: 5,
            time: 12,
            data: {
              turn: 1,
              step: 0,
              chunk: { type: "text-delta", index: 0, text: "lo" },
            },
          },
        },
      ],
      hasMore: true,
    });
  });

  it("falls back to the rc.2 connection API for models and history", async () => {
    const ctx = {
      get: () => undefined,
      workspaces: {},
      sessions: {},
      connection: {
        api: {
          llm: {
            models: vi.fn(async () => ({
              result: { ok: true, value: { groups: [{ id: "legacy", models: [] }] } },
            })),
          },
          sessions: {
            create: vi.fn(),
            selectModel: vi.fn(),
            history: vi.fn(async () => ({
              result: { ok: true, value: { events: [], hasMore: false } },
            })),
          },
        },
      },
    };

    await expect(modelGroups(ctx)).resolves.toEqual([{ id: "legacy", models: [] }]);
    await expect(loadSessionHistory(ctx, "session-legacy" as never)).resolves.toEqual({
      entries: [],
      hasMore: false,
    });
  });

  it("uses the official Sidebar shell only in Desktop extended modes", () => {
    expect(desktopUsesOfficialSidebar("?dsh-desktop-mode=extended")).toBe(true);
    expect(desktopUsesOfficialSidebar("?dsh-desktop-mode=advanced")).toBe(true);
    expect(desktopUsesOfficialSidebar("?dsh-desktop-mode=compatibility")).toBe(false);
    expect(desktopUsesOfficialSidebar("")).toBe(false);
  });
});
