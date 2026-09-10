"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { NoteSummary, SearchResult } from "@/lib/notes";
import { cn } from "@/lib/utils";
import { IconBot, IconFile, IconGear, IconGraph, IconHome, IconPlus } from "@/components/icons";

interface Action {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [notes, setNotes] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setIdx(0);
    setNotes([]);
  }, []);

  const go = useCallback((path: string) => {
    close();
    router.push(path);
  }, [close, router]);

  const actions: Action[] = useMemo(() => [
    { id: "new", label: "New note", hint: "⌘N", run: () => go("/app/note/new") },
    { id: "home", label: "Go to Home", run: () => go("/app") },
    { id: "graph", label: "Open graph view", run: () => go("/app/graph") },
    { id: "settings", label: "Open settings", run: () => go("/app/settings") },
    { id: "agent", label: "Agent access guide", run: () => go("/app/agent") },
  ], [go]);

  async function createTitled(title: string) {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: `# ${title}\n` }),
    });
    if (res.ok) {
      const { note } = await res.json();
      go(`/app/note/${note.id}`);
    }
  }

  // global shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        go("/app/note/new");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open ]);

  // search notes as you type
  useEffect(() => {
    if (!open || !q.trim()) {
      setNotes([]);
      setIdx(0);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setNotes((data.results as SearchResult[]).slice(0, 7));
        setIdx(0);
      }
    }, 180);
    return () => clearTimeout(timer.current);
  }, [q, open]);

  const shownActions = useMemo(() => {
    if (!q.trim()) return actions;
    const needle = q.toLowerCase();
    return actions.filter((a) => a.label.toLowerCase().includes(needle));
  }, [actions, q]);

  const flat: Array<{ key: string; label: string; sub?: string; run: () => void; kind: "note" | "action" | "create" }> = useMemo(() => {
    const items: typeof flat = shownActions.map((a) => ({ key: a.id, label: a.label, sub: a.hint, run: a.run, kind: "action" as const }));
    for (const n of notes) {
      items.push({
        key: n.id,
        label: n.title,
        sub: (n as NoteSummary).folder || undefined,
        run: () => go(`/app/note/${n.id}`),
        kind: "note",
      });
    }
    if (q.trim() && !notes.some((n) => n.title.toLowerCase() === q.trim().toLowerCase())) {
      items.push({ key: "__create", label: `Create "${q.trim()}"`, run: () => createTitled(q.trim()), kind: "create" });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownActions, notes, q, go]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[idx]?.run();
    } else if (e.key === "Escape") {
      close();
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => value ? setOpen(true) : close()}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Input
          ref={inputRef}
          placeholder="Type a command or search notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded={open}
          aria-controls="command-results"
          aria-activedescendant={flat[idx] ? `command-${flat[idx].key}` : undefined}
          aria-autocomplete="list"
          aria-label="Command palette"
        />
        <div className="max-h-80 overflow-y-auto p-1.5" role="listbox" id="command-results">
          {flat.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">No matches. Press ↵ to create “{q}”.</p>
          )}
          {flat.map((item, i) => (
            <button
              key={item.key}
              id={`command-${item.key}`}
              tabIndex={-1}
              role="option"
              aria-selected={i === idx}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition",
                i === idx && "bg-muted"
              )}
              onMouseEnter={() => setIdx(i)}
              onClick={() => item.run()}
            >
              {item.kind === "note" ? (
                <IconFile size={14} />
              ) : item.kind === "create" ? (
                <IconPlus size={14} />
              ) : item.key === "graph" ? (
                <IconGraph size={14} />
              ) : item.key === "settings" ? (
                <IconGear size={14} />
              ) : item.key === "agent" ? (
                <IconBot size={14} />
              ) : item.key === "home" ? (
                <IconHome size={14} />
              ) : (
                <IconPlus size={14} />
              )}
              <span className="flex-1 truncate font-medium">{item.label}</span>
              {item.sub && <span className="text-xs text-muted-foreground">{item.sub}</span>}
            </button>
          ))}
        </div>
        <p className="border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
          ↑↓ navigate · ↵ run · esc close
        </p>
      </DialogContent>
    </Dialog>
  );
}
