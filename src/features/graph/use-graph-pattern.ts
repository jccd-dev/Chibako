"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { GraphPattern } from "@/features/graph/galaxy-style";

const STORAGE_KEY = "chibako.graph.pattern";
const listeners = new Set<() => void>();

function read(): GraphPattern {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "radial" ? "radial" : "galaxy";
  } catch {
    return "galaxy";
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

/**
 * The persisted layout pattern. The server snapshot is always "galaxy", so the
 * stored choice applies after hydration without a markup mismatch.
 */
export function useGraphPattern() {
  const pattern = useSyncExternalStore(subscribe, read, () => "galaxy" as const);
  const setPattern = useCallback((next: GraphPattern) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the choice then only lasts until reload.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [pattern, setPattern] as const;
}
