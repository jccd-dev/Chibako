"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { IconBot, IconGear, IconGraph, IconKeyboard, IconLink, IconMenu, IconMoon, IconSun } from "@/components/icons";
import { useTheme } from "@/components/ThemeProvider";
import { IconTip } from "@/components/IconTip";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconDotsVertical } from "@tabler/icons-react";

export function TopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toggle } = useTheme();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const onNotePage = pathname?.startsWith("/app/note") ?? false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    const onOpenShortcuts = () => setShortcutsOpen(true);
    const onLinksState = (e: Event) => setLinksOpen(Boolean((e as CustomEvent).detail));
    window.addEventListener("keydown", onKey);
    window.addEventListener("chibako:open-shortcuts", onOpenShortcuts);
    window.addEventListener("chibako:links-open", onLinksState);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("chibako:open-shortcuts", onOpenShortcuts);
      window.removeEventListener("chibako:links-open", onLinksState);
    };
  }, []);


  return (
    <header className="flex h-11 items-center justify-between border-b border-border px-2 sm:px-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          aria-expanded={sidebarOpen}
        >
          <IconMenu />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <div className="hidden items-center gap-1 md:flex">
          {onNotePage && (
            <IconTip
              label={linksOpen ? "Hide connections" : "Show connections"}
              onClick={() => window.dispatchEvent(new Event("chibako:toggle-links"))}
              active={linksOpen}
            >
              <IconLink size={15} />
            </IconTip>
          )}
          <IconTip label="Toggle theme" onClick={toggle}>
            <IconSun size={15} className="dark:hidden" />
            <IconMoon size={15} className="hidden dark:block" />
          </IconTip>
          <IconTip label="Keyboard shortcuts (⌘/)" onClick={() => setShortcutsOpen(true)}>
            <IconKeyboard size={15} />
          </IconTip>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="More workspace actions" />}><IconDotsVertical /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {onNotePage && (
              <DropdownMenuItem onClick={() => window.dispatchEvent(new Event("chibako:toggle-links"))}>
                <IconLink />Connections{linksOpen && <span className="ml-auto text-primary">✓</span>}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => router.push("/app/graph")}><IconGraph />Graph</DropdownMenuItem>
            <DropdownMenuItem onClick={toggle}><IconSun className="dark:hidden" /><IconMoon className="hidden dark:block" />Toggle theme</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/app/settings")}><IconGear />Settings</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/app/agent")}><IconBot />Agent access</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShortcutsOpen(true)}><IconKeyboard />Keyboard shortcuts</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </header>
  );
}
