"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

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
  const [previousLocation, setPreviousLocation] = useState({ pathname, mobile });
  if (previousLocation.pathname !== pathname || previousLocation.mobile !== mobile) {
    setPreviousLocation({ pathname, mobile });
    setMobileOpen(false);
  }
  function toggleSidebar() {
    if (mobile) return setMobileOpen(open => !open);
    setCollapsed(value => {
      try { localStorage.setItem("chibako_sidebar", value ? "expanded" : "collapsed"); } catch {}
      return !value;
    });
  }
  return <>
    <Sidebar collapsed={collapsed} mobile={mobile} mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} onExpand={toggleSidebar} />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar sidebarOpen={mobile ? mobileOpen : !collapsed} onToggleSidebar={toggleSidebar} />
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  </>;
}
