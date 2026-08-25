import { useSyncExternalStore } from "react";

export interface ProjectMapTarget {
  spaceId: string;
  spaceName: string;
  rootPath: string;
  rootAliases: readonly string[];
  customerId: string;
  customerName: string;
  projectId: string;
  projectTitle: string;
  projectPath: string;
}

interface ProjectMapState {
  target?: ProjectMapTarget;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

const listeners = new Set<() => void>();
let state: ProjectMapState = { sidebarWidth: 320, sidebarCollapsed: false };

function publish(next: ProjectMapState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

export function openProjectMap(target: ProjectMapTarget): void {
  publish({ ...state, target });
}

export function closeProjectMap(): void {
  if (state.target === undefined) return;
  const { target: _target, ...rest } = state;
  publish(rest);
}

export function setProjectMapSidebarGeometry(width: number, collapsed: boolean): void {
  const normalizedWidth = Number.isFinite(width) ? Math.max(56, Math.round(width)) : 320;
  if (state.sidebarWidth === normalizedWidth && state.sidebarCollapsed === collapsed) return;
  publish({ ...state, sidebarWidth: normalizedWidth, sidebarCollapsed: collapsed });
}

export function projectMapSnapshot(): ProjectMapState {
  return state;
}

export function subscribeProjectMap(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useProjectMapState(): ProjectMapState {
  return useSyncExternalStore(subscribeProjectMap, projectMapSnapshot, projectMapSnapshot);
}

