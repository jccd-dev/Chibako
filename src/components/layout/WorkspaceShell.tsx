"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { UpdateNotice } from "@/features/updates/components/UpdateNotice";
import { UpdatesProvider } from "@/features/updates/use-updates";

function subscribeMobile(onChange: () => void) {
  const media = matchMedia("(max-width: 767px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const mobileSnapshot = () => matchMedia("(max-width: 767px)").matches;
const serverMobileSnapshot = () => false;

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverMobileSnapshot);
  const [mobileOpen, setMobileOpen] = useState(false);
  const hydrated = useHydrated();
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  if (hydrated && !preferencesLoaded) {
    setPreferencesLoaded(true);
    try { setCollapsed(localStorage.getItem("chibako_sidebar") === "collapsed"); } catch {}
  }
  const pathname = usePathname();
  // Home gives its whole width to the dashboard: the desktop file panel never opens there.
  const onHome = pathname === "/app";
  const [previousLocation, setPreviousLocation] = useState({ pathname, mobile });
  if (previousLocation.pathname !== pathname || previousLocation.mobile !== mobile) {
    setPreviousLocation({ pathname, mobile });
    setMobileOpen(false);
  }
  const panelCollapsed = onHome || collapsed;
  function setPanelCollapsed(value: boolean) {
    try { localStorage.setItem("chibako_sidebar", value ? "collapsed" : "expanded"); } catch {}
    setCollapsed(value);
  }
  function toggleSidebar() {
    if (mobile) return setMobileOpen(open => !open);
    setPanelCollapsed(!collapsed);
  }
  return <UpdatesProvider>
    <Sidebar collapsed={panelCollapsed} mobile={mobile} mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} onExpand={() => setPanelCollapsed(false)} />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar sidebarOpen={mobile ? mobileOpen : !panelCollapsed} onToggleSidebar={mobile || !onHome ? toggleSidebar : undefined} />
      <UpdateNotice />
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  </UpdatesProvider>;
}
