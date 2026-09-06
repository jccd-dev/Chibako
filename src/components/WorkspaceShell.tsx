"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("chibako_sidebar") === "collapsed"); } catch {}
    const media = matchMedia("(max-width: 767px)");
    const update = () => { setMobile(media.matches); setMobileOpen(false); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
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
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  </>;
}
