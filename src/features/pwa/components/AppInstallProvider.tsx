"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useHydrated } from "@/lib/use-hydrated";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

interface AppInstallState {
  canInstall: boolean;
  isStandalone: boolean;
  isIOS: boolean;
  status: "idle" | "prompting" | "accepted" | "dismissed" | "installed";
  error: string | null;
  install: () => Promise<void>;
}

const AppInstallContext = createContext<AppInstallState | null>(null);

function subscribeStandalone(onChange: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const standaloneSnapshot = () => window.matchMedia("(display-mode: standalone)").matches
  || ("standalone" in navigator && navigator.standalone === true);
const serverStandaloneSnapshot = () => false;

export function AppInstallProvider({ children }: { children: ReactNode }) {
  const prompt = useRef<InstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [status, setStatus] = useState<AppInstallState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const isStandalone = useSyncExternalStore(subscribeStandalone, standaloneSnapshot, serverStandaloneSnapshot);
  const hydrated = useHydrated();
  const isIOS = hydrated && (/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      // Chromium exposes this event before Settings is opened; retain it across navigation.
      prompt.current = event as InstallPromptEvent;
      setCanInstall(true);
      setStatus("idle");
      setError(null);
    }
    function onInstalled() {
      prompt.current = null;
      setCanInstall(false);
      setStatus("installed");
      setError(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    const event = prompt.current;
    if (!event || isStandalone) return;
    prompt.current = null;
    setCanInstall(false);
    setStatus("prompting");
    setError(null);
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      setStatus((current) => current === "installed" ? current : outcome);
    } catch {
      setStatus((current) => current === "installed" ? current : "idle");
      setError("Could not open installation. Try your browser's Install app menu.");
    }
  }

  return <AppInstallContext.Provider value={{ canInstall, isStandalone, isIOS, status, error, install }}>
    {children}
  </AppInstallContext.Provider>;
}

export function useAppInstall(): AppInstallState {
  const value = useContext(AppInstallContext);
  if (!value) throw new Error("useAppInstall must be used inside AppInstallProvider");
  return value;
}
