"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconBot, IconGraph, IconGear, IconMenu, IconMoon, IconPlus, IconSearch, IconSun } from "@/components/icons";
import { useTheme } from "@/components/ThemeProvider";
import { IconTip } from "@/components/IconTip";
import type { SearchResult } from "@/lib/notes";

export function TopBar() {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!q.trim()) {
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
        if (res.ok) {
          const data = await res.json();
          setResults(data.results);
          setActive(0);
          setOpen(true);
        }
      } catch {
        // aborted (superseded) — ignore
      } finally {
        if (abort.current === ctrl) setBusy(false);
      }
    }, 200);
    return () => clearTimeout(timer.current);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
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
    <header className="flex items-center gap-2 border-b border-border px-4 py-2">
      <button
        className="btn !px-2 md:hidden"
        onClick={() => window.dispatchEvent(new Event("chibako:toggle-sidebar"))}
        title="Open notebooks"
        aria-label="Open notebooks"
      >
        <IconMenu size={15} />
      </button>
      <div ref={boxRef} className="relative w-full max-w-md">
        <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className="input !rounded-full !py-1.5 pl-8 pr-7 text-sm"
          placeholder="Search all notes…  (⌘K)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q.trim() && setOpen(true)}
          onKeyDown={onSearchKey}
          aria-label="Search all notes"
          aria-expanded={open}
          role="combobox"
          aria-autocomplete="list"
        />
        {busy && <span className="absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border border-muted-foreground border-t-transparent" />}
        {open && (
          <div className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-96 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl fade-in">
            {results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">No results for “{q}”.</p>
            ) : (
              results.map((r, i) => (
                <button
                  key={r.id}
                  role="option"
                  aria-selected={i === active}
                  className={`block w-full rounded-lg px-3 py-2 text-left transition hover:bg-muted ${
                    i === active ? "bg-muted" : ""
                  }`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(`/app/note/${r.id}`)}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {r.title}
                    {r.folder && <span className="text-[11px] font-normal text-muted-foreground">{r.folder}</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground" dangerouslySetInnerHTML={{ __html: r.snippet }} />
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
        <button className="btn" onClick={newNote} title="New note">
          <IconPlus size={15} /> <span className="hidden sm:inline">New</span>
        </button>
        <IconTip label="Graph view" onClick={() => router.push("/app/graph")}>
          <IconGraph size={15} />
        </IconTip>
        <IconTip label="Toggle theme" onClick={toggle}>
          {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
        </IconTip>
        <IconTip label="Settings" onClick={() => router.push("/app/settings")}>
          <IconGear size={15} />
        </IconTip>
        <IconTip label="Agent access" onClick={() => router.push("/app/agent")}>
          <IconBot size={15} />
        </IconTip>
      </div>
    </header>
  );
}