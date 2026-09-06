"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Note, NoteKind, NoteSummary } from "@/lib/notes";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { relTime } from "@/components/Sidebar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IconTip } from "@/components/IconTip";
import { IconCheck, IconEye, IconFile, IconLink, IconMoon, IconPencil, IconPin, IconPlus, IconSun, IconTrash, IconX } from "@/components/icons";
import { useTheme } from "@/components/ThemeProvider";

type ViewMode = "edit" | "split" | "preview";
type SaveState = "saved" | "saving" | "unsaved" | "error";

interface LinkInfo {
  outlinks: Array<{ target: string; target_id: string | null; resolved: boolean }>;
  backlinks: Array<{ id: string; title: string; folder: string; snippet: string }>;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function NoteClient({ initial, allNotes: initialAll }: { initial: Note | null; allNotes: NoteSummary[] }) {
  const router = useRouter();
  const { theme, toggle } = useTheme();

  const [note, setNote] = useState<Note | null>(initial);
  const [allNotes, setAllNotes] = useState<NoteSummary[]>(initialAll);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [folder, setFolder] = useState(initial?.folder ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [kind, setKind] = useState<NoteKind>(initial?.kind ?? "note");
  const [pinned, setPinned] = useState(initial?.is_pinned === 1);
  // Server renders "split"; stored preference / mobile default applies after
  // mount so server HTML and first client render always match (no hydration
  // mismatch).
  const [view, setView] = useState<ViewMode>("split");
  const [modKey, setModKey] = useState("");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("chibako_view");
      if (stored === "edit" || stored === "split" || stored === "preview") {
        setView(stored);
      } else if (window.innerWidth < 768) {
        setView("edit");
      }
    } catch {
      // private mode — keep default
    }
    setModKey(/mac/i.test(navigator.platform ?? "") ? "⌘" : "Ctrl+");
  }, []);
  const [saveState, setSaveState] = useState<SaveState>(initial ? "saved" : "unsaved");
  const [links, setLinks] = useState<LinkInfo | null>(null);
  const [mentions, setMentions] = useState<Array<{ id: string; title: string; folder: string; snippet: string }>>([]);
  const [showLinks, setShowLinks] = useState(true);
  const [createModal, setCreateModal] = useState<string | null>(null);
  const [createFolder, setCreateFolder] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editWrapRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const debounced = useDebounced({ title, folder, content, kind }, 700);

  // ---- [[wikilink autocomplete ----
  const [suggest, setSuggest] = useState<{ prefix: string; top: number; left: number } | null>(null);
  const [suggestIdx, setSuggestIdx] = useState(0);

  const suggestions = useMemo(() => {
    if (!suggest) return [];
    const p = suggest.prefix.toLowerCase();
    const pool = allNotes.filter((n) => n.id !== note?.id && !n.deleted_at);
    const starts: NoteSummary[] = [];
    const contains: NoteSummary[] = [];
    for (const n of pool) {
      const t = n.title.toLowerCase();
      if (t.startsWith(p)) starts.push(n);
      else if (t.includes(p)) contains.push(n);
    }
    const sortByTitle = (a: NoteSummary, b: NoteSummary) => a.title.localeCompare(b.title);
    return [...starts.sort(sortByTitle), ...contains.sort(sortByTitle)].slice(0, 8);
  }, [suggest, allNotes, note?.id]);

  /** Caret coordinates relative to the edit wrapper, via a hidden mirror div. */
  const measureCaret = useCallback((ta: HTMLTextAreaElement, text: string, cursor: number) => {
    const wrap = editWrapRef.current;
    if (!wrap) return null;
    let mirror = mirrorRef.current;
    if (!mirror) {
      mirror = document.createElement("div");
      mirrorRef.current = mirror;
      mirror.setAttribute("aria-hidden", "true");
      mirror.style.cssText =
        "position:absolute;visibility:hidden;pointer-events:none;white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;";
      wrap.appendChild(mirror);
    }
    const cs = window.getComputedStyle(ta);
    mirror.style.font = cs.font;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.width = `${ta.clientWidth}px`;
    mirror.style.left = `${ta.offsetLeft}px`;
    mirror.style.top = `${ta.offsetTop}px`;
    const before = text.slice(0, cursor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
    mirror.innerHTML = `${before}<span id="chibako-caret">\u200b</span>`;
    const marker = mirror.querySelector("#chibako-caret") as HTMLElement | null;
    if (!marker) return null;
    return {
      top: mirror.offsetTop + marker.offsetTop - ta.scrollTop + parseFloat(cs.lineHeight || "26"),
      left: mirror.offsetLeft + marker.offsetLeft - ta.scrollLeft,
    };
  }, []);

  const updateSuggest = useCallback((ta: HTMLTextAreaElement, text: string) => {
    const cursor = ta.selectionStart ?? 0;
    const m = text.slice(0, cursor).match(/\[\[([^\[\]\n]*)$/);
    if (!m) {
      setSuggest(null);
      return;
    }
    const pos = measureCaret(ta, text, cursor);
    if (!pos) {
      setSuggest(null);
      return;
    }
    const wrap = editWrapRef.current;
    const maxLeft = Math.max(0, (wrap?.clientWidth ?? 300) - 280);
    setSuggest({ prefix: m[1], top: pos.top, left: Math.min(Math.max(0, pos.left), maxLeft) });
    setSuggestIdx(0);
  }, [measureCaret]);

  function insertSuggestion(target: string) {
    const ta = textareaRef.current;
    if (!ta || !suggest) return;
    const cursor = ta.selectionStart ?? content.length;
    const start = cursor - (suggest.prefix.length + 2);
    const next = `${content.slice(0, start)}[[${target}]]${content.slice(cursor)}`;
    setContent(next);
    dirty.current = true;
    setSaveState("unsaved");
    setSuggest(null);
    const end = start + target.length + 4;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(end, end);
    });
  }

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const n of allNotes) if (n.folder) set.add(n.folder);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allNotes]);

  const wordCount = useMemo(() => {
    const w = content.trim().split(/\s+/).filter(Boolean);
    return content.trim() ? w.length : 0;
  }, [content]);

  function setViewAndRemember(m: ViewMode) {
    setView(m);
    try {
      localStorage.setItem("chibako_view", m);
    } catch {
      // private mode — ignore
    }
  }
  const duplicateTitle = useMemo(() => {
    const t = title.trim().toLowerCase();
    if (!t) return false;
    return allNotes.some((n) => n.id !== note?.id && !n.deleted_at && n.title.toLowerCase() === t);
  }, [title, allNotes, note?.id]);

  const titleById = useCallback(() => {
    const m = new Map<string, string>();
    for (const n of allNotes) m.set(n.title.toLowerCase(), n.id);
    return m;
  }, [allNotes]);

  async function persist() {    setSaveState("saving");
    try {
      if (note) {
        const res = await fetch(`/api/notes/${note.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, folder, content, kind, is_pinned: pinned ? 1 : 0 }),
        });
        if (!res.ok) throw new Error("save failed");
        const { note: updated } = await res.json();
        setNote(updated);
        setPinned(updated.is_pinned === 1);
        setSaveState("saved");
        dirty.current = false;
        if (allNotes.some((n) => n.id !== updated.id && n.title.toLowerCase() === updated.title.toLowerCase())) {
          toast.warning("Duplicate title", {
            description: "Another note has the same title — [[links]] resolve to the first match.",
          });
        }
        refreshLinks();
        refreshAllNotes();
      } else {
        const res = await fetch(`/api/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, folder, content, kind }),
        });
        if (!res.ok) throw new Error("create failed");
        const { note: created } = await res.json();
        setNote(created);
        setPinned(created.is_pinned === 1);
        dirty.current = false;
        setSaveState("saved");
        refreshAllNotes();
        router.replace(`/app/note/${created.id}`);
      }
    } catch {
      setSaveState("error");
    }
  }

  // Flush pending edits when leaving the note (route change / unmount) and
  // warn on full-page unload, so fast navigation never drops keystrokes.
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    return () => {
      if (dirty.current) persistRef.current();
    };
  }, []);
  useEffect(() => {
    function onUnload(e: BeforeUnloadEvent) {
      if (dirty.current) e.preventDefault();
    }
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  async function refreshAllNotes() {
    const res = await fetch("/api/notes");
    if (res.ok) {
      const data = await res.json();
      setAllNotes(data.notes);
    }
  }

  async function refreshLinks() {
    if (!note) return;
    const res = await fetch(`/api/notes/${note.id}/links`);
    if (res.ok) {
      const data = await res.json();
      setLinks(data);
    }
    const mres = await fetch(`/api/notes/${note.id}/mentions`);
    if (mres.ok) {
      const mdata = await mres.json();
      setMentions(mdata.mentions ?? []);
    }
  }

  async function linkMentionFrom(sourceId: string) {
    if (!note) return;
    const res = await fetch(`/api/notes/${note.id}/mentions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId }),
    });
    if (res.ok) {
      toast.success("Linked", { description: `[[${note.title}]] added.` });
      refreshLinks();
      refreshAllNotes();
    } else {
      toast.error("Could not link that mention.");
    }
  }

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => refreshLinks(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => persist(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  function handleChangeTitle(v: string) {
    setTitle(v);
    dirty.current = true;
    setSaveState("unsaved");
  }
  function handleChangeFolder(v: string) {
    setFolder(v);
    dirty.current = true;
    setSaveState("unsaved");
  }
  function handleChangeKind(k: NoteKind) {
    setKind(k);
    dirty.current = true;
    setSaveState("unsaved");
  }
  function togglePinned() {
    setPinned((p) => !p);
    dirty.current = true;
    setSaveState("unsaved");
  }
  function handleChangeContent(v: string) {
    setContent(v);
    dirty.current = true;
    setSaveState("unsaved");
  }

  function handleEditorKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod) {
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (!e.shiftKey && k === "b") return run(() => insertAtCursor("**", "**", "bold"));
      if (!e.shiftKey && k === "i") return run(() => insertAtCursor("*", "*", "italic"));
      if (!e.shiftKey && k === "j") return run(() => insertAtCursor("`", "`", "code"));
      if (!e.shiftKey && k === "1") return run(() => setViewAndRemember("edit"));
      if (!e.shiftKey && k === "2") return run(() => setViewAndRemember("split"));
      if (!e.shiftKey && k === "3") return run(() => setViewAndRemember("preview"));
      if (!e.shiftKey && k === "/") return run(() => setShowShortcuts(true));
      if (e.shiftKey && k === "x") return run(() => insertAtCursor("~~", "~~", "struck"));
      if (e.shiftKey && k === "j") return run(() => insertAtCursor("```\n", "\n```", "code"));
      if (e.shiftKey && k === "l") return run(() => insertAtCursor("[", "](https://)", "text"));
      if (e.shiftKey && k === "k") return run(() => insertAtCursor("[[", "]]", "Note title"));
      if (e.shiftKey && k === "t") return run(() => insertAtCursor("- [ ] ", "", "task"));
      if (e.shiftKey && k === "b") return run(() => insertAtCursor("- ", "", "item"));
      return; // let Cmd+S / Cmd+N bubble to the parent handler
    }
    if (suggest && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertSuggestion(suggestions[suggestIdx]?.title ?? suggestions[0].title);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }
    handleTab(e);
  }

  function navigateTo(target: string) {
    const id = titleById().get(target.toLowerCase());
    if (id) {
      router.push(`/app/note/${id}`);
    } else {
      setCreateModal(target);
      setCreateFolder(note?.folder ?? "");
    }
  }

  async function createMissing() {
    if (!createModal) return;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: createModal, folder: createFolder, content: `# ${createModal}\n` }),
    });
    if (res.ok) {
      const { note: created } = await res.json();
      setCreateModal(null);
      router.push(`/app/note/${created.id}`);
    }
  }

  async function handleDelete() {
    if (!note) return;
    const res = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not move note to Trash.");
      return;
    }
    const trashedId = note.id;
    const trashedTitle = note.title;
    window.dispatchEvent(new Event("chibako:notes-changed"));
    const home = allNotes.find((n) => n.kind === "index");
    router.push(home && home.id !== note.id ? `/app/note/${home.id}` : "/app");
    router.refresh();
    toast("Moved to Trash", {
      description: `"${trashedTitle}" will be purged after 30 days.`,
      action: {
        label: "Undo",
        onClick: async () => {
          const r = await fetch(`/api/notes/${trashedId}/restore`, { method: "POST" });
          if (r.ok) {
            window.dispatchEvent(new Event("chibako:notes-changed"));
            router.push(`/app/note/${trashedId}`);
            toast.success("Note restored.");
          } else {
            toast.error("Could not restore note.");
          }
        },
      },
    });
  }

  async function newNote() {
    router.push("/app/note/new");
  }

  function insertAtCursor(before: string, after: string, placeholder: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const selected = content.slice(s, e) || placeholder;
    const next = content.slice(0, s) + before + selected + after + content.slice(e);
    setContent(next);
    dirty.current = true;
    setSaveState("unsaved");
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + selected.length);
    });
  }

  const toolbar = [
    { label: "B", title: "Bold", kbd: "B", run: () => insertAtCursor("**", "**", "bold") },
    { label: "I", title: "Italic", kbd: "I", run: () => insertAtCursor("*", "*", "italic") },
    { label: "S", title: "Strikethrough", kbd: "⇧X", run: () => insertAtCursor("~~", "~~", "struck") },
    { label: "H", title: "Heading", kbd: null, run: () => insertAtCursor("## ", "", "Heading") },
    { label: "[]", title: "Checklist", kbd: "⇧T", run: () => insertAtCursor("- [ ] ", "", "task") },
    { label: "·", title: "Bullet list", kbd: "⇧B", run: () => insertAtCursor("- ", "", "item") },
    { label: ">", title: "Quote", kbd: null, run: () => insertAtCursor("> ", "", "quote") },
    { label: "`", title: "Inline code", kbd: "J", run: () => insertAtCursor("`", "`", "code") },
    { label: "```", title: "Code block", kbd: "⇧J", run: () => insertAtCursor("```\n", "\n```", "code") },
    { label: "link", title: "Link", kbd: "⇧L", run: () => insertAtCursor("[", "](https://)", "text") },
    { label: "⟪⟫", title: "Wikilink", kbd: "⇧K", run: () => insertAtCursor("[[", "]]", "Note title") },
  ];

  function handleTab(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart;
      const next = content.slice(0, s) + "  " + content.slice(ta.selectionEnd);
      setContent(next);
      dirty.current = true;
      setSaveState("unsaved");
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2;
      });
    }
  }

  function handleKeys(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      dirty.current = true;
      persist();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault();
      newNote();
    }
  }

  const showEdit = view === "edit" || view === "split";
  const showPreview = view === "preview" || view === "split";

  return (
    <div className="flex h-full" onKeyDown={handleKeys}>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex items-center gap-2 border-b border-border px-6 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <input
              className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
              value={title}
              placeholder="Untitled"
              onChange={(e) => handleChangeTitle(e.target.value)}
              aria-label="Note title"
            />
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Folder</span>
              <input
                className="w-40 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground outline-none transition hover:border-border focus:border-primary/50"
                value={folder}
                placeholder="folder"
                list="chibako-folders"
                onChange={(e) => handleChangeFolder(e.target.value)}
                aria-label="Folder"
              />
              <datalist id="chibako-folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <select
                className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground outline-none hover:border-border"
                value={kind}
                onChange={(e) => handleChangeKind(e.target.value as NoteKind)}
                aria-label="Kind"
              >
                <option value="note">note</option>
                <option value="wiki">wiki</option>
                <option value="index">index</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`mr-1 text-xs ${saveState === "saved" ? "text-muted-foreground" : saveState === "error" ? "text-red-500" : "text-muted-foreground"}`}>
              {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Unsaved"}
            </span>
            {note && (
              <span className="mr-1 hidden text-xs text-muted-foreground lg:inline" title="Word count">
                {wordCount} word{wordCount === 1 ? "" : "s"} · edited {relTime(note.updated_at)}
              </span>
            )}
            {note && (
              <IconTip label={pinned ? "Unpin from sidebar" : "Pin to sidebar"} onClick={togglePinned} active={pinned}>
                <IconPin size={15} className={pinned ? "text-primary" : ""} />
              </IconTip>
            )}
            {note && (
              <IconTip label="Toggle connections panel" onClick={() => setShowLinks((v) => !v)}>
                <IconLink size={15} />
              </IconTip>
            )}
            <IconTip label="Toggle theme" onClick={toggle}>
              {theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
            </IconTip>
            {note && (
              <IconTip label="Move to Trash" onClick={handleDelete} className="btn btn-danger">
                <IconTrash size={15} />
              </IconTip>
            )}
            <button className="btn btn-primary" onClick={newNote}>
              <IconPlus size={15} /> New
            </button>
          </div>
        </div>

        {/* view toggle + toolbar */}
        {duplicateTitle && (
          <p className="mx-6 mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            Another note already uses this title — [[links]] to “{title.trim()}” resolve to the first match.
          </p>
        )}
        <div className="flex items-center justify-between gap-2 px-6 py-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
            {(["edit", "split", "preview"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewAndRemember(m)}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${
                  view === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-muted-foreground"
                }`}
              >
                {m === "edit" ? <IconPencil size={12} /> : m === "split" ? <IconFile size={12} /> : <IconEye size={12} />}
                {m}
              </button>
            ))}
          </div>
          {showEdit && (
            <div className="flex items-center gap-0.5">
              {toolbar.map((t) => (
                <button
                  key={t.label}
                  className="btn !px-2 !py-1 text-xs"
                  title={t.kbd ? `${t.title} (${modKey}${t.kbd})` : t.title}
                  onClick={t.run}
                >
                  {t.label}
                </button>
              ))}
              <button className="btn !px-2 !py-1 text-xs" title={`Keyboard shortcuts (${modKey}/)`} onClick={() => setShowShortcuts(true)}>
                ?
              </button>
            </div>
          )}
        </div>

        {/* body */}
        <div className="flex min-h-0 flex-1">
          {showEdit && (
            <div
              ref={editWrapRef}
              onScroll={() => setSuggest(null)}
              className={`${showPreview ? "w-1/2 border-r border-border" : "w-full"} relative overflow-y-auto px-6 py-2`}
            >
              <textarea
                ref={textareaRef}
                className="editor min-h-full"
                value={content}
                placeholder={"Start writing…\n\nLink notes with [[Another Note]]."}
                onChange={(e) => {
                  handleChangeContent(e.target.value);
                  updateSuggest(e.target, e.target.value);
                }}
                onClick={(e) => updateSuggest(e.currentTarget, content)}
                onKeyUp={(e) => {
                  if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
                    updateSuggest(e.currentTarget, content);
                  }
                }}
                onKeyDown={handleEditorKey}
                aria-label="Note content"
                aria-expanded={Boolean(suggest)}
                aria-autocomplete="list"
                spellCheck={false}
              />
              {suggest && suggestions.length > 0 && (
                <div
                  role="listbox"
                  aria-label="Link suggestions"
                  className="absolute z-40 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl fade-in"
                  style={{ top: suggest.top, left: suggest.left }}
                >
                  {suggestions.map((s, i) => (
                    <button
                      key={s.id}
                      role="option"
                      aria-selected={i === suggestIdx}
                      className={`block w-full rounded-lg px-3 py-1.5 text-left transition ${
                        i === suggestIdx ? "bg-muted" : ""
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertSuggestion(s.title);
                      }}
                      onMouseEnter={() => setSuggestIdx(i)}
                    >
                      <span className="block truncate text-sm font-medium">{s.title}</span>
                      {s.folder && (
                        <span className="block truncate text-[11px] text-muted-foreground">{s.folder}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {showPreview && (
            <div className={`${showEdit ? "w-1/2" : "w-full"} overflow-y-auto px-8 py-4`}>
              {content.trim() ? (
                <MarkdownPreview content={content} onNavigate={navigateTo} />
              ) : (
                <p className="text-sm text-muted-foreground">Preview is empty.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* right links panel */}
      {note && showLinks && (
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-sidebar md:flex">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Connections</h3>
            <button className="btn !px-1.5 !py-1" onClick={() => setShowLinks(false)}>
              <IconX size={13} />
            </button>
          </div>
          <div className="flex-1 space-y-4 px-3 pb-6">
            <div>
              <h4 className="px-1 text-xs font-medium text-muted-foreground">Backlinks ({links?.backlinks.length ?? 0})</h4>
              {links?.backlinks.length ? (
                <ul className="mt-1 space-y-0.5">
                  {links.backlinks.map((b) => (
                    <li key={b.id}>
                      <button
                        className="w-full rounded-md px-2 py-1.5 text-left transition hover:bg-muted"
                        onClick={() => router.push(`/app/note/${b.id}`)}
                      >
                        <span className="block text-[13px] font-medium text-primary">{b.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{b.snippet}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 px-2 text-xs text-muted-foreground">Nothing links here yet. Add <code>[[{note.title}]]</code> elsewhere.</p>
              )}
            </div>
            <div>
              <h4 className="px-1 text-xs font-medium text-muted-foreground">Linked to ({links?.outlinks.length ?? 0})</h4>              {links?.outlinks.length ? (
                <ul className="mt-1 space-y-0.5">
                  {links.outlinks.map((o) => (
                    <li key={o.target}>
                      <button
                        className={`w-full rounded-md px-2 py-1.5 text-left text-[13px] transition hover:bg-muted ${
                          o.resolved ? "text-primary" : "text-muted-foreground italic"
                        }`}
                        onClick={() => navigateTo(o.target)}
                      >
                        {o.target}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 px-2 text-xs text-muted-foreground">No outgoing links.</p>
              )}
            </div>
            {mentions.length > 0 && (
              <div>
                <h4 className="px-1 text-xs font-medium text-muted-foreground">Mentioned in ({mentions.length})</h4>
                <ul className="mt-1 space-y-0.5">
                  {mentions.map((m) => (
                    <li key={m.id} className="rounded-md px-2 py-1.5 transition hover:bg-muted">
                      <button
                        className="block w-full text-left"
                        onClick={() => router.push(`/app/note/${m.id}`)}
                        title="Open note"
                      >
                        <span className="block text-[13px] font-medium">{m.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{m.snippet}</span>
                      </button>
                      <button
                        className="mt-0.5 text-[11px] font-medium text-primary hover:underline"
                        onClick={() => linkMentionFrom(m.id)}
                      >
                        Link first mention →
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* create missing note dialog */}
      <Dialog open={createModal !== null} onOpenChange={(o) => !o && setCreateModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create “{createModal}”?</DialogTitle>
            <DialogDescription>This note doesn’t exist yet. Create it now?</DialogDescription>
          </DialogHeader>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="chibako-new-folder">
              Folder
            </label>
            <input
              id="chibako-new-folder"
              className="input"
              value={createFolder}
              onChange={(e) => setCreateFolder(e.target.value)}
              placeholder="folder"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateModal(null)}>
              Cancel
            </Button>
            <Button onClick={createMissing}>
              <IconCheck size={14} data-icon="inline-start" /> Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* keyboard shortcuts help */}
      <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Undo and redo are the editor’s built-in history.</DialogDescription>
          </DialogHeader>
          <ul className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-[13px]">
            {[
              ["B", "Bold"], ["I", "Italic"], ["⇧X", "Strikethrough"],
              ["J", "Inline code"], ["⇧J", "Code block"],
              ["⇧T", "Checklist"], ["⇧B", "Bullet list"],
              ["⇧L", "Link"], ["⇧K", "Wikilink"],
              ["1 / 2 / 3", "Edit / split / preview"],
              ["S", "Save now"], ["N", "New note"], ["K", "Command palette"],
              ["/", "This help"], ["Z / ⇧Z", "Undo / redo"],
            ].map(([keys, label]) => (
              <li key={label} className="contents">
                <span className="flex gap-1">
                  {keys.split(" / ").map((k) => (
                    <span key={k} className="kbd">{modKey}{k}</span>
                  ))}
                </span>
                <span className="text-muted-foreground">{label}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}