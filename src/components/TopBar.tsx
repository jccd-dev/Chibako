"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconBot, IconGear, IconGraph, IconKeyboard, IconMenu, IconMoon, IconPlus, IconSearch, IconSun } from "@/components/icons";
import { useTheme } from "@/components/ThemeProvider";
import { IconTip } from "@/components/IconTip";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupText } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/lib/notes";

export function TopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const router = useRouter();
  const { toggle } = useTheme();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    abort.current?.abort();
    setError("");
    if (!q.trim()) {
      setBusy(false);
      setResults([]);
      setOpen(false);
      return;
    }
    setBusy(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error("Search failed");
        if (res.ok) {
          const data = await res.json();
          setResults(data.results);
          setActive(0);
          setOpen(true);
        }
      } catch {
        if (!ctrl.signal.aborted) setError("Search failed. Try again.");
      } finally {
        if (abort.current === ctrl) setBusy(false);
      }
    }, 200);
    return () => { clearTimeout(timer.current); abort.current?.abort(); };
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    const onOpenShortcuts = () => setShortcutsOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("chibako:open-shortcuts", onOpenShortcuts);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("chibako:open-shortcuts", onOpenShortcuts);
    };
  }, []);

  function go(path: string) {
    setOpen(false);
    setQ("");
    router.push(path);
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) go(`/app/note/${r.id}`);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function newNote() {
    go("/app/note/new");
  }

  return (
    <header className="flex items-center gap-1 border-b border-border px-2 sm:gap-2 sm:px-4 py-2">
      <Button variant="ghost" size="icon" onClick={onToggleSidebar} aria-label="Toggle sidebar" aria-expanded={sidebarOpen}>
        <IconMenu />
      </Button>
      <div ref={boxRef} className="relative min-w-0 flex-1 max-w-md">
        <InputGroup>
          <InputGroupInput placeholder="Search notes…" value={q} onChange={e => setQ(e.target.value)}
            onFocus={() => q.trim() && setOpen(true)} onKeyDown={onSearchKey} aria-label="Search all notes"
            role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls="search-results"
            aria-activedescendant={open && results[active] ? `search-${results[active].id}` : undefined} />
          <InputGroupAddon><IconSearch /></InputGroupAddon>
          {busy && <InputGroupAddon align="inline-end"><InputGroupText role="status">Searching…</InputGroupText></InputGroupAddon>}
        </InputGroup>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {open && (
          <div id="search-results" role="listbox" className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-96 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-xl fade-in">
            {results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">No results for “{q}”.</p>
            ) : (
              results.map((r, i) => (
                <button
                  key={r.id}
                  id={`search-${r.id}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  className={cn("block w-full rounded-md px-3 py-2 text-left hover:bg-accent", i === active && "bg-accent")}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(`/app/note/${r.id}`)}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {r.title}
                    {r.folder && <span className="text-[11px] font-normal text-muted-foreground">{r.folder}</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{r.snippet.split(/(<mark>|<\/mark>)/).map((part, index, parts) => part === "<mark>" || part === "</mark>" ? null : parts[index - 1] === "<mark>" ? <mark key={index}>{part}</mark> : part)}</span>
                </button>
              ))
            )}
            {results.length > 0 && (
              <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
                {results.length} result{results.length === 1 ? "" : "s"} · ↑↓ navigate · ↵ open · esc close
              </p>
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" onClick={newNote} aria-label="New note"><IconPlus data-icon="inline-start" /><span className="hidden sm:inline">New</span></Button>
        <IconTip label="Graph view" onClick={() => router.push("/app/graph")}>
          <IconGraph size={15} />
        </IconTip>
        <IconTip label="Toggle theme" onClick={toggle}>
          <IconSun size={15} className="dark:hidden" />
          <IconMoon size={15} className="hidden dark:block" />
        </IconTip>
        <IconTip label="Settings" onClick={() => router.push("/app/settings")}>
          <IconGear size={15} />
        </IconTip>
        <IconTip label="Agent access" onClick={() => router.push("/app/agent")}>
          <IconBot size={15} />
        </IconTip>
        <IconTip label="Keyboard shortcuts (⌘/)" onClick={() => setShortcutsOpen(true)}>
          <IconKeyboard size={15} />
        </IconTip>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </header>
  );
}