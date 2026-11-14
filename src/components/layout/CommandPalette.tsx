"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NoteLink } from "@/components/NoteLink";
import type { SearchResult } from "@/lib/notes";
import { cn } from "@/lib/utils";
import { noteTreeCache } from "@/features/notes/note-tree-cache";
import { folderQualifier, parseSearchQuery } from "@/features/notes/search-query";
import { useNoteSearch } from "@/features/notes/use-note-search";
import { IconBot, IconFile, IconFolder, IconGear, IconGraph, IconHome, IconPlus } from "@/components/icons";

const OPEN_EVENT = "chibako:open-palette";

/** Opens the command palette from anywhere, such as the rail search icon. */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

// The `folder:` value still being typed at the end of the query.
const FOLDER_PARTIAL = /(?:^|\s)folder:(?:"([^"]*)|(\S*))$/i;

interface Item {
  key: string;
  label: string;
  sub?: string;
  run: () => void;
  kind: "note" | "action" | "create" | "folder";
  note?: SearchResult;
}

function Snippet({ text }: { text: string }) {
  return text.split(/(<mark>|<\/mark>)/).map((part, i, parts) =>
    part === "<mark>" || part === "</mark>" ? null : parts[i - 1] === "<mark>" ? <mark key={i}>{part}</mark> : part
  );
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [folders, setFolders] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { results: notes, busy } = useNoteSearch(open ? q : "");
  const parsed = useMemo(() => parseSearchQuery(q), [q]);

  const [shownNotes, setShownNotes] = useState(notes);
  if (shownNotes !== notes) {
    setShownNotes(notes);
    setIdx(0);
  }

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setIdx(0);
  }, []);

  const go = useCallback((path: string) => {
    close();
    router.push(path);
  }, [close, router]);

  const actions = useMemo(() => [
    { id: "new", label: "New note", hint: "⌘N", run: () => go("/app/note/new") },
    { id: "home", label: "Go to Home", run: () => go("/app") },
    { id: "graph", label: "Open graph view", run: () => go("/app/graph") },
    { id: "settings", label: "Open settings", run: () => go("/app/settings") },
    { id: "agent", label: "Agent access guide", run: () => go("/app/agent") },
  ], [go]);

  const createTitled = useCallback(async (title: string) => {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: `# ${title}\n` }),
    });
    if (res.ok) {
      const { note } = await res.json();
      go(`/app/note/${note.id}`);
    }
  }, [go]);

  // global shortcuts and the open event
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
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [go]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    let live = true;
    // The shared tree cache usually answers without a request.
    void noteTreeCache(async () => fetch("/api/notes").then((r) => r.json())).read().then((data) => {
      if (live) setFolders(data.folders);
    });
    return () => { live = false; clearTimeout(t); };
  }, [open]);

  const folderPartial = q.match(FOLDER_PARTIAL);
  const folderNeedle = folderPartial ? (folderPartial[1] ?? folderPartial[2] ?? "").toLowerCase() : null;
  const suggestions = useMemo(
    () => folderNeedle === null ? [] : folders.filter((f) => f.toLowerCase().includes(folderNeedle)).slice(0, 8),
    [folders, folderNeedle]
  );

  const searching = Boolean(q.trim());
  const flat: Item[] = useMemo(() => {
    const items: Item[] = suggestions.map((folder) => ({
      key: `folder:${folder}`,
      label: folder,
      kind: "folder",
      run: () => {
        setQ(q.replace(FOLDER_PARTIAL, (m) => `${/^\s/.test(m) ? " " : ""}${folderQualifier(folder)} `));
        setIdx(0);
        inputRef.current?.focus();
      },
    }));
    for (const n of notes) {
      items.push({ key: n.id, label: n.title, sub: n.folder || undefined, run: () => go(`/app/note/${n.id}`), kind: "note", note: n });
    }
    const needle = q.trim().toLowerCase();
    for (const a of actions) {
      if (!needle || a.label.toLowerCase().includes(needle)) items.push({ key: a.id, label: a.label, sub: a.hint, run: a.run, kind: "action" });
    }
    // Qualifier queries are searches, not titles.
    const plain = !parsed.folder && !parsed.titleOnly && parsed.text;
    if (plain && !notes.some((n) => n.title.toLowerCase() === needle)) {
      items.push({ key: "__create", label: `Create "${q.trim()}"`, run: () => void createTitled(q.trim()), kind: "create" });
    }
    return items;
  }, [suggestions, notes, actions, q, parsed, go, createTitled]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (open) document.getElementById(`command-${flat[idx]?.key}`)?.scrollIntoView({ block: "nearest" });
  }, [open, idx, flat]);

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

  function itemRow(item: Item, i: number) {
    const className = cn(
      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition",
      i === idx && "bg-muted"
    );
    const icon = item.kind === "note" ? <IconFile size={14} />
      : item.kind === "folder" ? <IconFolder size={14} />
      : item.key === "graph" ? <IconGraph size={14} />
      : item.key === "settings" ? <IconGear size={14} />
      : item.key === "agent" ? <IconBot size={14} />
      : item.key === "home" ? <IconHome size={14} />
      : <IconPlus size={14} />;
    const shared = {
      id: `command-${item.key}`,
      tabIndex: -1,
      role: "option" as const,
      "aria-selected": i === idx,
      onMouseEnter: () => setIdx(i),
    };
    // Note rows are links so the arrow-key highlight can warm the note's route.
    if (item.kind === "note") {
      return (
        <NoteLink
          key={item.key}
          {...shared}
          className={cn(className, "flex-col items-stretch gap-0.5")}
          noteId={item.key}
          prefetch={i === idx}
          onClick={(event) => {
            event.preventDefault();
            item.run();
          }}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            {icon}
            <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
            {item.sub && (
              <span className="max-w-[45%] shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={item.sub}>
                {item.sub}
              </span>
            )}
          </span>
          {item.note?.snippet && (
            <span className="line-clamp-2 pl-6 text-xs leading-snug wrap-anywhere text-muted-foreground">
              <Snippet text={item.note.snippet} />
            </span>
          )}
        </NoteLink>
      );
    }
    return (
      <button key={item.key} {...shared} className={className} onClick={() => item.run()}>
        {icon}
        <span className="flex-1 truncate font-medium">{item.label}</span>
        {item.sub && <span className="text-xs text-muted-foreground">{item.sub}</span>}
      </button>
    );
  }

  const noMatches = searching && !busy && !notes.length && !suggestions.length && parsed.text;
  return (
    <Dialog open={open} onOpenChange={value => value ? setOpen(true) : close()}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Input
          ref={inputRef}
          placeholder="Search notes or type a command…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded={open}
          aria-controls="command-results"
          aria-activedescendant={flat[idx] ? `command-${flat[idx].key}` : undefined}
          aria-autocomplete="list"
          aria-label="Command palette"
        />
        <div className="max-h-96 overflow-y-auto p-1.5" role="listbox" id="command-results" aria-busy={busy}>
          {!searching && (
            <p className="px-3 pb-2 pt-1 text-xs text-muted-foreground">
              Search titles and note content. Tip: <code>note:</code> matches titles only, <code>folder:Name</code> limits to a folder.
            </p>
          )}
          {noMatches && (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              {parsed.folder ? `No notes in ${parsed.folder} match “${parsed.text}”.` : `No notes match “${parsed.text}”.`}
            </p>
          )}
          {flat.map((item, i) => itemRow(item, i))}
        </div>
        <p className="border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
          ↑↓ navigate · ↵ open · esc close
        </p>
      </DialogContent>
    </Dialog>
  );
}
