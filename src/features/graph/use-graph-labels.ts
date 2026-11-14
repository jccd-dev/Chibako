"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "chibako.graph.labels";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Whether index labels show when nothing is hovered. Persisted like the layout pattern. */
export function useGraphLabels() {
  const labels = useSyncExternalStore(subscribe, read, () => true);
  const setLabels = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Storage can be blocked; the choice then only lasts until reload.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [labels, setLabels] as const;
}
