"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  IconBot,
  IconGear,
  IconGraph,
  IconKeyboard,
  IconMoon,
  IconSun,
} from "@/components/icons";
import { useTheme } from "@/components/ThemeProvider";
import { IconTip } from "@/components/IconTip";
import { NoteTabs } from "@/components/NoteTabs";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  IconCalendarMonth,
  IconDotsVertical,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconListDetails,
} from "@tabler/icons-react";

export function TopBar({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
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
    const onLinksState = (e: Event) =>
      setLinksOpen(Boolean((e as CustomEvent).detail));
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
    <header className="flex h-11 min-w-0 items-center border-b border-border px-2 sm:px-3">
      <div className="flex h-full min-w-0 flex-1 items-center gap-1">
        <IconTip
          label={sidebarOpen ? "Hide left sidebar" : "Show left sidebar"}
          onClick={onToggleSidebar}
          expanded={sidebarOpen}
        >
          {sidebarOpen ? (
            <IconLayoutSidebarLeftCollapse size={16} />
          ) : (
            <IconLayoutSidebarLeftExpand size={16} />
          )}
        </IconTip>
        <NoteTabs />
      </div>

      <div className="flex h-full shrink-0 items-center gap-1">
        <div className="hidden items-center gap-1 md:flex">
          <IconTip label="Toggle theme" onClick={toggle}>
            <IconSun size={15} className="dark:hidden" />
            <IconMoon size={15} className="hidden dark:block" />
          </IconTip>
          <IconTip
            label="Keyboard shortcuts (⌘/)"
            onClick={() => setShortcutsOpen(true)}
          >
            <IconKeyboard size={15} />
          </IconTip>
          {onNotePage && (
            <IconTip
              label={linksOpen ? "Hide note details" : "Show note details"}
              onClick={() =>
                window.dispatchEvent(new Event("chibako:toggle-links"))
              }
              active={linksOpen}
            >
              <IconListDetails size={15} />
            </IconTip>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="rounded-md bg-muted/60 hover:bg-muted md:hidden"
                aria-label="More workspace actions"
              />
            }
          >
            <IconDotsVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => router.push("/app/calendar")}>
              <IconCalendarMonth />
              Calendar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/app/graph")}>
              <IconGraph />
              Graph
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggle}>
              <IconSun className="dark:hidden" />
              <IconMoon className="hidden dark:block" />
              Toggle theme
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/app/settings")}>
              <IconGear />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/app/agent")}>
              <IconBot />
              Agent access
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
              <IconKeyboard />
              Keyboard shortcuts
            </DropdownMenuItem>
            {onNotePage && (
              <DropdownMenuItem
                onClick={() =>
                  window.dispatchEvent(new Event("chibako:toggle-links"))
                }
              >
                <IconListDetails />
                Note details
                {linksOpen && <span className="ml-auto text-primary">✓</span>}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </header>
  );
}
