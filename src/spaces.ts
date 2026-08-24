import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import {
  canonicalizeSpacePath, loadOverlay, makeSpace, newSpaceId, saveOverlay, withOverlayLock,
} from "./overlay.ts";
import type {
  CreateSpaceRequest, ListSpacesResult, OverlayStore, ResolveSpaceResult, SpaceMigrationStatus,
  SpaceStatus, UpdateSpacePolicyRequest, UpdateSpaceRequest, WorkbenchSpace,
} from "./types.ts";

export class SpaceResolutionError extends Error {
  constructor(message: string, readonly code: "space-not-found" | "space-ambiguous" | "space-path-missing") {
    super(message);
    this.name = "SpaceResolutionError";
  }
}

async function pathStatus(rootPath: string): Promise<SpaceStatus["pathStatus"]> {
  return stat(rootPath).then((item) => item.isDirectory() ? "available" : "missing", () => "missing");
}

function ordered(store: OverlayStore): WorkbenchSpace[] {
  return Object.values(store.spaces).sort((left, right) =>
    Number(right.pinned) - Number(left.pinned) || left.order - right.order || left.name.localeCompare(right.name));
}

function requireSpace(store: OverlayStore, spaceId: string): WorkbenchSpace {
  const space = store.spaces[spaceId];
  if (space === undefined) throw new SpaceResolutionError(`Space not found: ${spaceId}`, "space-not-found");
  return space;
}

function rebaseManagedPaths(paths: string[], oldRoot: string, newRoot: string): string[] {
  return paths.map((path) => {
    const relativePath = relative(oldRoot, path);
    if (relativePath === "") return newRoot;
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return path;
    return join(newRoot, relativePath);
  });
}

export class WorkbenchSpaceService {
  constructor(readonly dataDir: string, readonly fallbackRoot: string) {}

  async store(): Promise<OverlayStore> { return loadOverlay(this.dataDir, this.fallbackRoot); }

  async list(selectedSpaceId?: string): Promise<ListSpacesResult> {
    const store = await this.store();
    const selected = selectedSpaceId !== undefined && store.spaces[selectedSpaceId] !== undefined
      ? selectedSpaceId : store.selectedSpaceId ?? store.defaultSpaceId;
    return {
      spaces: await Promise.all(ordered(store).map(async (space) => ({ ...space, pathStatus: await pathStatus(space.rootPath) }))),
      defaultSpaceId: store.defaultSpaceId,
      selectedSpaceId: selected,
      migration: store.migration ?? { state: "not-needed" },
    };
  }

  async migrationStatus(): Promise<SpaceMigrationStatus> {
    return (await this.store()).migration ?? { state: "not-needed" };
  }

  async resolve(spaceId?: string, selectedSpaceId?: string, requireAvailable = false): Promise<ResolveSpaceResult> {
    const store = await this.store();
    const source = spaceId !== undefined ? "explicit" : selectedSpaceId !== undefined ? "selected" : "default";
    const resolvedId = spaceId ?? selectedSpaceId ?? store.selectedSpaceId ?? store.defaultSpaceId;
    const space = requireSpace(store, resolvedId);
    if (requireAvailable && await pathStatus(space.rootPath) === "missing") {
      throw new SpaceResolutionError(`Space path is missing: ${space.rootPath}`, "space-path-missing");
    }
    return { spaceId: space.id, rootPath: space.rootPath, source };
  }

  async create(request: CreateSpaceRequest): Promise<WorkbenchSpace> {
    const rootPath = await canonicalizeSpacePath(request.rootPath);
    return withOverlayLock(this.dataDir, async () => {
      const store = await this.store();
      const existing = Object.values(store.spaces).find((space) => space.rootPath === rootPath);
      if (existing !== undefined) return existing;
      const id = newSpaceId(); const now = new Date().toISOString();
      const space = makeSpace(rootPath, { id,
        ...(request.name === undefined ? {} : { name: request.name }),
        ...(request.color === undefined ? {} : { color: request.color }),
        ...(request.icon === undefined ? {} : { icon: request.icon }),
        ...(request.pinned === undefined ? {} : { pinned: request.pinned }),
        order: Object.keys(store.spaces).length,
        createdAt: now, updatedAt: now });
      store.spaces[id] = space;
      if (request.makeDefault === true) store.defaultSpaceId = id;
      store.selectedSpaceId = id;
      await saveOverlay(this.dataDir, store); return space;
    });
  }

  async update(request: UpdateSpaceRequest): Promise<WorkbenchSpace> {
    const rootPath = request.rootPath === undefined ? undefined : await canonicalizeSpacePath(request.rootPath);
    return withOverlayLock(this.dataDir, async () => {
      const store = await this.store(); const current = requireSpace(store, request.spaceId);
      if (rootPath !== undefined) {
        const duplicate = Object.values(store.spaces).find((space) => space.id !== current.id && space.rootPath === rootPath);
        if (duplicate !== undefined) throw new Error(`Space path is already used by ${duplicate.id}`);
      }
      const next: WorkbenchSpace = { ...current,
        ...(rootPath === undefined ? {} : {
          rootPath,
          rootPathHistory: [...new Set([...(current.rootPathHistory ?? []), current.rootPath])]
            .filter((path) => path !== rootPath),
          hiddenWorkspacePaths: rebaseManagedPaths(current.hiddenWorkspacePaths, current.rootPath, rootPath),
        }),
        ...(request.name === undefined ? {} : { name: request.name.trim() || current.name }),
        ...(request.color === undefined ? {} : { color: request.color }),
        ...(request.icon === undefined ? {} : { icon: request.icon }),
        ...(request.pinned === undefined ? {} : { pinned: request.pinned }),
        updatedAt: new Date().toISOString() };
      if (request.rules !== undefined) {
        if (request.rules.trim() === "") delete next.rules; else next.rules = request.rules.trim();
      }
      store.spaces[current.id] = next; await saveOverlay(this.dataDir, store); return next;
    });
  }

  async remove(spaceId: string): Promise<{ removedSpaceId: string; defaultSpaceId: string }> {
    return withOverlayLock(this.dataDir, async () => {
      const store = await this.store(); requireSpace(store, spaceId);
      if (Object.keys(store.spaces).length === 1) throw new Error("Cannot remove the last Space");
      delete store.spaces[spaceId];
      for (const key of Object.keys(store.projects)) if (key.startsWith(`${spaceId}::`)) delete store.projects[key];
      const remaining = ordered(store);
      if (store.defaultSpaceId === spaceId) store.defaultSpaceId = remaining[0]!.id;
      if (store.selectedSpaceId === spaceId) store.selectedSpaceId = store.defaultSpaceId;
      remaining.forEach((space, index) => { space.order = index; });
      await saveOverlay(this.dataDir, store);
      return { removedSpaceId: spaceId, defaultSpaceId: store.defaultSpaceId };
    });
  }

  async reorder(spaceIds: string[]): Promise<WorkbenchSpace[]> {
    return withOverlayLock(this.dataDir, async () => {
      const store = await this.store(); const actual = Object.keys(store.spaces);
      if (spaceIds.length !== actual.length || new Set(spaceIds).size !== actual.length || actual.some((id) => !spaceIds.includes(id))) {
        throw new Error("spaceIds must contain every Space exactly once");
      }
      spaceIds.forEach((id, index) => { store.spaces[id]!.order = index; store.spaces[id]!.updatedAt = new Date().toISOString(); });
      await saveOverlay(this.dataDir, store); return ordered(store);
    });
  }

  async setDefault(spaceId: string): Promise<WorkbenchSpace> {
    return withOverlayLock(this.dataDir, async () => {
      const store = await this.store(); const space = requireSpace(store, spaceId);
      store.defaultSpaceId = spaceId; await saveOverlay(this.dataDir, store); return space;
    });
  }

  async setSelected(spaceId: string): Promise<WorkbenchSpace> {
    return withOverlayLock(this.dataDir, async () => {
      const store = await this.store(); const space = requireSpace(store, spaceId);
      store.selectedSpaceId = spaceId; await saveOverlay(this.dataDir, store); return space;
    });
  }

  async updatePolicy(request: UpdateSpacePolicyRequest): Promise<WorkbenchSpace> {
    return withOverlayLock(this.dataDir, async () => {
      const store = await this.store(); const space = requireSpace(store, request.spaceId);
      const policy = { ...space.policy, ...(request.auxiliary === undefined ? {} : { auxiliary: request.auxiliary }) };
      if (request.model !== undefined) { if (request.model === null) delete policy.model; else policy.model = request.model; }
      if (request.agentPreset !== undefined) { if (request.agentPreset === null || request.agentPreset === "") delete policy.agentPreset; else policy.agentPreset = request.agentPreset; }
      if (request.permissionPreset !== undefined) { if (request.permissionPreset === null || request.permissionPreset === "") delete policy.permissionPreset; else policy.permissionPreset = request.permissionPreset; }
      const next = { ...space, policy, updatedAt: new Date().toISOString() };
      store.spaces[space.id] = next; await saveOverlay(this.dataDir, store); return next;
    });
  }
}
