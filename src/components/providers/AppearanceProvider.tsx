"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import {
  applyAppearancePreferences,
  DEFAULT_APPEARANCE,
  readAppearancePreferences,
  writeAppearancePreferences,
  type AppearancePreferences,
  type FontChoice,
} from "@/lib/appearance";

interface AppearanceContextValue {
  appearance: AppearancePreferences;
  setFont: (role: "interfaceFont" | "noteFont", font: FontChoice) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE);

  const hydrated = useHydrated();
  const [loaded, setLoaded] = useState(false);
  if (hydrated && !loaded) {
    setLoaded(true);
    try { setAppearance(readAppearancePreferences(localStorage)); } catch {}
  }
  useEffect(() => {
    if (loaded) applyAppearancePreferences(appearance, document.documentElement);
  }, [appearance, loaded]);

  const setFont = useCallback((role: "interfaceFont" | "noteFont", font: FontChoice) => {
    setAppearance((current) => {
      const next = { ...current, [role]: font };
      applyAppearancePreferences(next, document.documentElement);
      try {
        writeAppearancePreferences(next, localStorage);
      } catch {
        // Accessing localStorage itself can throw in restricted browser contexts.
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ appearance, setFont }), [appearance, setFont]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance must be used inside AppearanceProvider");
  return value;
}
