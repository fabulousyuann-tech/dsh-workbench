import { useEffect, useState } from "react";

import {
  browserWorkbenchStorage,
  loadWorkbenchUiState,
  saveWorkbenchUiState,
  type SidebarTab,
} from "./persistence.ts";

type Listener = () => void;

const listeners = new Set<Listener>();
const libraryListeners = new Set<Listener>();
const initialUi = loadWorkbenchUiState(browserWorkbenchStorage());
let selectedId = initialUi.selectedId;
let sidebarTab: SidebarTab = initialUi.sidebarTab;
let libraryEpoch = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function emitLibrary(): void {
  for (const listener of libraryListeners) listener();
}

export function bumpLibrary(): void {
  libraryEpoch += 1;
  emitLibrary();
}

export function getLibraryEpoch(): number {
  return libraryEpoch;
}

export function subscribeLibrary(listener: Listener): () => void {
  libraryListeners.add(listener);
  return () => {
    libraryListeners.delete(listener);
  };
}

export function useLibraryEpoch(): number {
  const [epoch, setEpoch] = useState(getLibraryEpoch);
  useEffect(() => subscribeLibrary(() => {
    setEpoch(getLibraryEpoch());
  }), []);
  return epoch;
}

export function getSidebarTab(): SidebarTab {
  return sidebarTab;
}

export function setSidebarTab(tab: SidebarTab): void {
  if (sidebarTab === tab) return;
  sidebarTab = tab;
  const state = loadWorkbenchUiState(browserWorkbenchStorage());
  saveWorkbenchUiState(browserWorkbenchStorage(), { ...state, sidebarTab });
  emit();
}

export function useSidebarTab(): SidebarTab {
  const [tab, setTab] = useState(getSidebarTab);
  useEffect(() => {
    const listener = (): void => {
      setTab(getSidebarTab());
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return tab;
}

export function getSelectedId(): string | null {
  return selectedId;
}

export function setSelectedId(id: string | null): void {
  if (selectedId === id) return;
  selectedId = id;
  const state = loadWorkbenchUiState(browserWorkbenchStorage());
  saveWorkbenchUiState(browserWorkbenchStorage(), { ...state, selectedId });
  emit();
}

export function subscribeSelectedId(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelectedId(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState(getSelectedId);
  useEffect(() => subscribeSelectedId(() => {
    setId(getSelectedId());
  }), []);
  return [id, setSelectedId];
}
