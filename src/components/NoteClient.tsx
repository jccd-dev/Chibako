"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Note, NoteKind, NoteSummary, UpdateNoteInput } from "@/lib/notes";
import type { Bookmark } from "@/lib/bookmarks";
import { parseFrontmatter, serializeFrontmatter, type PropValue } from "@/lib/markdown";
import { PROPERTY_TYPES, type PropertyDef, type PropertyType } from "@/lib/property-types";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
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
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { IconTip } from "@/components/IconTip";
import { IconBookmark, IconCheck, IconChevron, IconHome, IconPin, IconPlus, IconTrash, IconX } from "@/components/icons";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { IconDotsVertical } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type ViewMode = "write" | "edit" | "split" | "preview";
type SaveState = "saved" | "saving" | "unsaved" | "error";

/** Select sentinel for the "create a new bookmark group" option. */
const NEW_GROUP_VALUE = "__new__";

// Kind colors match the graph view so a note reads as the same entity in both.
const KIND_COLOR: Record<NoteKind, string> = {
  note: "var(--primary)",
  wiki: "var(--graph-wiki)",
  index: "var(--graph-index)",
};

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

/**
 * Uncontrolled property value input. Commits on blur/Enter (Enter blurs).
 * Being uncontrolled means a trailing separator comma stays visible while the
 * user is typing — a controlled input bound to the parsed value would swallow
 * it on every keystroke. `defaultValue` comes from the note's current value;
 * remounting (keyed by note id) keeps it fresh across notes.
 */
function PropTextEditor({ initial, onCommit, placeholder, type, ariaLabel }: {
  initial: string;
  onCommit: (raw: string) => void;
  placeholder?: string;
  type: "text" | "number" | "date";
  ariaLabel: string;
}) {
  return (
    <input
      type={type}
      defaultValue={initial}
      className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      placeholder={placeholder}
      aria-label={ariaLabel}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.currentTarget.value = initial;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function NoteClient({ initial, allNotes: initialAll }: { initial: Note | null; allNotes: NoteSummary[] }) {
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(initial);
  const [allNotes, setAllNotes] = useState<NoteSummary[]>(initialAll);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [folder, setFolder] = useState(initial?.folder ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [kind, setKind] = useState<NoteKind>(initial?.kind ?? "note");
  const [pinned, setPinned] = useState(initial?.is_pinned === 1);
  const [bookmark, setBookmark] = useState<Bookmark | null>(null);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [bmGroups, setBmGroups] = useState<string[]>([]);
  const [bmGroup, setBmGroup] = useState("");
  const [bmNewGroup, setBmNewGroup] = useState("");
  const [bmBusy, setBmBusy] = useState(false);
  // Single-scroll panes: the typed-properties block collapses under this toggle.
  const [showProps, setShowProps] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("chibako_props") === "hide") setShowProps(false);
    } catch {
      // private mode — keep default
    }
  }, []);
  function setPropsAndRemember(next: boolean) {
    setShowProps(next);
    try {
      localStorage.setItem("chibako_props", next ? "show" : "hide");
    } catch {
      // private mode — ignore
    }
  }
  // Server renders "split"; stored preference / mobile default applies after
  // mount so server HTML and first client render always match (no hydration
  // mismatch).
  const [view, setView] = useState<ViewMode>("split");
  const [modKey, setModKey] = useState("");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("chibako_view");
      const wide = window.innerWidth >= 1024;
      if (stored === "write" || stored === "edit" || stored === "preview") setView(stored);
      else if (stored === "split") setView(wide ? "split" : "edit");
      else if (!wide) setView("edit"); // split needs room for two panes
      else setView("write");
    } catch {
      // private mode — keep default
    }
    setModKey(/mac/i.test(navigator.platform ?? "") ? "⌘" : "Ctrl+");
  }, []);
  const [saveState, setSaveState] = useState<SaveState>(initial ? "saved" : "unsaved");
  const [links, setLinks] = useState<LinkInfo | null>(null);
  const [mentions, setMentions] = useState<Array<{ id: string; title: string; folder: string; snippet: string }>>([]);
  const [showLinks, setShowLinks] = useState(false);
  const [wideLinks, setWideLinks] = useState(true);
  // TopBar owns the dedicated connections toggle in the theme icon group;
  // these events bridge the button and this panel's state across components.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("chibako:links-open", { detail: showLinks }));
  }, [showLinks]);
  useEffect(() => {
    const toggle = () => setShowLinks((v) => !v);
    window.addEventListener("chibako:toggle-links", toggle);
    return () => window.removeEventListener("chibako:toggle-links", toggle);
  }, []);
  const [createModal, setCreateModal] = useState<string | null>(null);
  const [createFolder, setCreateFolder] = useState("");
  const [addingProp, setAddingProp] = useState(false);
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropType, setNewPropType] = useState<PropertyType>("string");
  const [newPropOptions, setNewPropOptions] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editWrapRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const pending = useRef<UpdateNoteInput>({});
  const saving = useRef<Promise<void> | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;
  const documentVersion = useRef(0);
  const [editorKey, setEditorKey] = useState(0);
  const snapshot = useMemo(() => ({ title, folder, content, kind, pinned }), [title, folder, content, kind, pinned]);
  const debounced = useDebounced(snapshot, 700);

  useEffect(() => { void refreshAllNotes(); }, []);

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
    replaceSelection(start, cursor, `[[${target}]]`);
    setSuggest(null);
  }

  const homeNote = useMemo(() => allNotes.find((n) => n.kind === "index" && !n.deleted_at), [allNotes]);
  const crumbs = useMemo(() => folder.split("/").filter(Boolean), [folder]);
  const indexNoteFor = useCallback(
    (path: string) => allNotes.find((n) => !n.deleted_at && n.kind === "index" && n.folder === path),
    [allNotes]
  );
  function goHome() {
    router.push(homeNote && homeNote.id !== note?.id ? `/app/note/${homeNote.id}` : "/app");
  }

  // ---- properties (YAML frontmatter, typed via the vault dictionary) ----
  const [propDefs, setPropDefs] = useState<PropertyDef[]>([]);
  const loadPropDefs = useCallback(() => {
    fetch("/api/properties").then((r) => r.json()).then((d) => setPropDefs(d.properties ?? [])).catch(() => {});
  }, []);
  useEffect(() => { loadPropDefs(); }, [loadPropDefs]);
  const defFor = useCallback((key: string) => propDefs.find((d) => d.name === key), [propDefs]);

  const fm = useMemo(() => parseFrontmatter(content), [content]);
  const propKeys = useMemo(() => {
    const present = new Set(Object.keys(fm.props));
    // dictionary order first, then any ad-hoc keys in insertion order
    const keys = propDefs.filter((d) => present.has(d.name)).map((d) => d.name);
    for (const k of present) if (!keys.includes(k)) keys.push(k);
    return keys;
  }, [fm, propDefs]);

  /** Type for a property: dictionary wins; otherwise inferred from the value shape. */
  function propType(key: string): PropertyType {
    const def = defFor(key);
    if (def) return def.type;
    const value = fm.props[key];
    if (Array.isArray(value)) return "tags";
    if (typeof value === "boolean") return "checkbox";
    if (typeof value === "number") return "number";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
    return "string";
  }

  function writeProps(mutate: (props: Record<string, PropValue>) => void) {
    const { props, body } = parseFrontmatter(content);
    const next = { ...props };
    mutate(next);
    handleChangeContent(serializeFrontmatter(next) + body);
  }

  function setPropText(key: string, raw: string) {
    const type = propType(key);
    let value: PropValue = raw;
    if (type === "list" || type === "tags") value = raw.split(",").map((s) => s.trim()).filter(Boolean);
    else if (type === "number") value = raw.trim() === "" ? "" : Number(raw);
    writeProps((props) => { props[key] = value; });
  }

  function setPropCheck(key: string, checked: boolean) {
    writeProps((props) => { props[key] = checked; });
  }

  function removeProp(key: string) {
    writeProps((props) => { delete props[key]; });
  }

  function cancelAddProp() {
    setAddingProp(false);
    setNewPropKey("");
    setNewPropType("string");
    setNewPropOptions("");
  }

  function handleNewPropKey(v: string) {
    setNewPropKey(v);
    const d = defFor(v);
    if (d) {
      setNewPropType(d.type);
      setNewPropOptions((d.options ?? []).join(", "));
    }
  }

  function addProp() {
    const clean = newPropKey.trim();
    if (!clean) return;
    if (fm.props[clean] !== undefined) {
      toast.error("This note already has that property.");
      return;
    }
    const type = newPropType;
    const options = newPropOptions.split(",").map((s) => s.trim()).filter(Boolean);
    if (type === "select" && options.length === 0) {
      toast.error("Select properties need allowed values (comma-separated).");
      return;
    }
    const initial: PropValue = type === "checkbox" ? false : type === "list" || type === "tags" ? [] : "";
    writeProps((props) => { props[clean] = initial; });
    // Auto-register the type vault-wide so the next note gets the same editor.
    fetch("/api/properties/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: clean, type, options: type === "select" ? options : undefined }),
    }).then((r) => { if (r.ok) loadPropDefs(); }).catch(() => {});
    cancelAddProp();
  }

  const wordCount = useMemo(() => {
    const w = fm.body.trim().split(/\s+/).filter(Boolean);
    return fm.body.trim() ? w.length : 0;
  }, [fm.body]);

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

  async function persist(): Promise<void> {
    if (saving.current) {
      await saving.current;
      if (dirty.current) return persistRef.current();
      return;
    }
    if (!dirty.current) return;
    const patch = pending.current;
    pending.current = {};
    const version = documentVersion.current;
    const current = noteRef.current;
    setSaveState("saving");
    const job = (async () => {
      try {
        const res = await fetch(current ? `/api/notes/${current.id}` : "/api/notes", {
          method: current ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(current ? patch : { title, folder, content, kind }),
          keepalive: true,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        if (version !== documentVersion.current) return;
        const updated: Note = data.note;
        noteRef.current = updated;
        setNote(updated);
        dirty.current = Object.keys(pending.current).length > 0;
        setSaveState(dirty.current ? "unsaved" : "saved");
        window.dispatchEvent(new Event("chibako:notes-changed"));
        void refreshAllNotes();
        void refreshLinks();
        if (!current) router.replace(`/app/note/${updated.id}`);
      } catch (error) {
        if (version === documentVersion.current) {
          pending.current = { ...patch, ...pending.current };
          dirty.current = true;
          setSaveState("error");
          toast.error(error instanceof Error ? error.message : "Save failed");
        }
        throw error;
      }
    })();
    saving.current = job;
    try { await job; } finally { if (saving.current === job) saving.current = null; }
  }

  // Flush pending edits when leaving the note (route change / unmount) and
  // warn on full-page unload, so fast navigation never drops keystrokes.
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    return () => {
      if (dirty.current) void persistRef.current().catch(() => {});
    };
  }, []);
  useEffect(() => {
    function onUnload(e: BeforeUnloadEvent) {
      if (dirty.current) e.preventDefault();
    }
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  useEffect(() => {
    if ((initial?.id ?? null) === (noteRef.current?.id ?? null)) return;
    if (dirty.current) void persistRef.current().catch(() => {});
    documentVersion.current++;
    pending.current = {};
    dirty.current = false;
    noteRef.current = initial;
    setNote(initial); setTitle(initial?.title ?? ""); setFolder(initial?.folder ?? "");
    setContent(initial?.content ?? ""); setKind(initial?.kind ?? "note"); setPinned(initial?.is_pinned === 1);
    setSaveState(initial ? "saved" : "unsaved"); setLinks(null); setMentions([]); setSuggest(null);
    setEditorKey(key => key + 1);
  }, [initial]);

  useEffect(() => {
    const before = (event: Event) => {
      if (event instanceof CustomEvent) event.detail.push(persistRef.current());
    };
    const organized = async () => {
      const id = noteRef.current?.id;
      if (!id) return;
      try {
        const response = await fetch(`/api/notes/${id}`);
        if (!response.ok || noteRef.current?.id !== id) return;
        const { note: updated } = await response.json();
        if (pending.current.title === undefined) setTitle(updated.title);
        if (pending.current.folder === undefined) setFolder(updated.folder);
        if (pending.current.content === undefined && !saving.current) setContent(updated.content);
        setNote(updated);
        void refreshAllNotes();
        void refreshLinks();
      } catch { toast.error("Could not refresh the organized note."); }
    };
    window.addEventListener("chibako:before-organize", before);
    window.addEventListener("chibako:organized", organized);
    return () => {
      window.removeEventListener("chibako:before-organize", before);
      window.removeEventListener("chibako:organized", organized);
    };
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

  // ---- bookmarks ----
  useEffect(() => {
    const id = note?.id;
    if (!id) {
      setBookmark(null);
      return;
    }
    let cancelled = false;
    fetch("/api/bookmarks")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list = (d.bookmarks ?? []) as Bookmark[];
        setBmGroups([...new Set(list.map((b) => b.group_name).filter(Boolean))]);
        setBookmark(list.find((x) => x.note_id === id) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [note?.id]);

  function openBookmarkDialog() {
    if (!note) return;
    setBmGroup(bookmark?.group_name ?? "");
    setBmNewGroup("");
    setBookmarkOpen(true);
  }

  async function submitBookmark(e: React.FormEvent) {
    e.preventDefault();
    if (!note || bmBusy) return;
    setBmBusy(true);
    try {
      const group = bmGroup === NEW_GROUP_VALUE ? bmNewGroup.trim() : bmGroup;
      const res = await fetch("/api/bookmarks", {
        method: bookmark ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          bookmark
            ? { id: bookmark.id, label: "", group_name: group }
            : { note_id: note.id, label: "", group_name: group }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save bookmark.");
      setBookmark(data.bookmark ?? bookmark);
      if (group) setBmGroups((prev) => (prev.includes(group) ? prev : [...prev, group]));
      setBookmarkOpen(false);
      toast(bookmark ? "Bookmark updated." : "Bookmarked");
      window.dispatchEvent(new Event("chibako:notes-changed"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save bookmark.");
    } finally {
      setBmBusy(false);
    }
  }

  async function removeBookmark() {
    if (!bookmark) return;
    const res = await fetch(`/api/bookmarks?id=${encodeURIComponent(bookmark.id)}`, { method: "DELETE" });
    if (res.ok) {
      setBookmark(null);
      setBookmarkOpen(false);
      toast("Bookmark removed.");
      window.dispatchEvent(new Event("chibako:notes-changed"));
    } else {
      toast.error("Could not remove bookmark.");
    }
  }

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => { void persist().catch(() => {}); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  function markDirty(patch: UpdateNoteInput) {
    pending.current = { ...pending.current, ...patch };
    dirty.current = true;
    setSaveState("unsaved");
  }

  function handleChangeTitle(v: string) {
    setTitle(v);
    markDirty({ title: v });
  }
  function handleChangeKind(k: NoteKind) {
    setKind(k);
    markDirty({ kind: k });
  }
  function togglePinned() {
    setPinned(!pinned);
    markDirty({ is_pinned: pinned ? 0 : 1 });
  }
  function handleChangeContent(v: string) {
    setContent(v);
    markDirty({ content: v });
  }

  /** WYSIWYG editor edits only the body; frontmatter is preserved as-is. */
  function handleWriteBody(md: string) {
    const { props } = parseFrontmatter(content);
    handleChangeContent(serializeFrontmatter(props) + md);
  }

  function handleEditorKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod) {
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (k === "z" || (k === "y" && !e.shiftKey)) return run(() => {
        document.execCommand(k === "y" || e.shiftKey ? "redo" : "undo");
        handleChangeContent(e.currentTarget.value);
        setSuggest(null);
      });
      if (!e.shiftKey && k === "b") return run(() => insertAtCursor("**", "**", "bold"));
      if (!e.shiftKey && k === "i") return run(() => insertAtCursor("*", "*", "italic"));
      if (!e.shiftKey && k === "j") return run(() => insertAtCursor("`", "`", "code"));
      if (!e.shiftKey && k === "1") return run(() => setViewAndRemember("write"));
      if (!e.shiftKey && k === "2") return run(() => setViewAndRemember("edit"));
      if (!e.shiftKey && k === "3") return run(() => setViewAndRemember("split"));
      if (!e.shiftKey && k === "4") return run(() => setViewAndRemember("preview"));
      if (!e.shiftKey && k === "/") return run(() => window.dispatchEvent(new Event("chibako:open-shortcuts")));
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

  // insertText preserves the browser undo stack for toolbar and autocomplete edits.
  function replaceSelection(start: number, end: number, text: string, selectStart = start + text.length, selectEnd = selectStart) {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, end);
    if (!document.execCommand("insertText", false, text)) {
      toast.error("This browser could not insert text. You can type Markdown directly.");
      return;
    }
    handleChangeContent(ta.value);
    ta.setSelectionRange(selectStart, selectEnd);
  }

  function insertAtCursor(before: string, after: string, placeholder: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    const selected = content.slice(start, end) || placeholder;
    replaceSelection(start, end, before + selected + after, start + before.length, start + before.length + selected.length);
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
    // Keep Shift+Tab available to leave the editor with the keyboard.
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      replaceSelection(e.currentTarget.selectionStart, e.currentTarget.selectionEnd, "  ");
    }
  }

  function handleKeys(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void persist().catch(() => {});
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      newNote();
    }
  }

  const showWrite = view === "write";
  const showEdit = view === "edit" || view === "split";
  const showPreview = view === "preview" || view === "split";

  useEffect(() => {
    const media = matchMedia("(min-width: 1024px)");
    const update = () => {
      setWideLinks(media.matches);
      setShowLinks(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Single-scroll source pane: the textarea grows with the content instead of
  // showing its own scrollbar.
  useEffect(() => {
    if (!showEdit) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [content, view, showEdit, showProps, editorKey, note?.id]);

  /** Collapsible "Properties" row shown above both editors. */
  function propsToggleJSX() {
    return (
      <button
        type="button"
        onClick={() => setPropsAndRemember(!showProps)}
        aria-expanded={showProps}
        aria-label={showProps ? "Hide properties" : "Show properties"}
        className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <IconChevron size={12} className={cn("transition-transform", showProps && "rotate-90")} />
        Properties{propKeys.length > 0 && ` (${propKeys.length})`}
      </button>
    );
  }

  function titleInputJSX() {
    return (
      <div className="flex items-center gap-3 pb-3 pt-5">
        <input
          className="min-w-0 flex-1 bg-transparent font-heading text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
          value={title}
          placeholder="Untitled"
          onChange={(e) => handleChangeTitle(e.target.value)}
          aria-label="Note title"
        />
      </div>
    );
  }

  /** Shared typed-properties editor shown above both the source and rich editors. */
  function renderPropertyEditor() {
    return (propKeys.length > 0 || addingProp) ? (
      <div key={`${note?.id ?? "new"}-props`} className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2" data-testid="properties">
        {propKeys.map((key) => {
          const type = propType(key);
          const def = defFor(key);
          const value = fm.props[key];
          const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
          return (
            <div key={key} className="flex items-center gap-2 border-b border-border/60 py-1 last:border-0">
              <label className="w-24 shrink-0 truncate text-xs font-medium text-muted-foreground" title={`${key} · ${type}`}>{key}</label>
              {type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(e) => setPropCheck(key, e.target.checked)}
                  aria-label={`Property ${key}`}
                  className="size-4 cursor-pointer accent-[var(--primary)]"
                />
              ) : type === "select" && def?.options?.length ? (
                <Select
                  items={{ "": "—", ...Object.fromEntries(def.options.map((o) => [o, o])) }}
                  value={text}
                  onValueChange={(v) => { if (v !== null) setPropText(key, v); }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`Property ${key}`}
                    className="h-6! w-auto! min-w-32 gap-1.5 rounded-md border-transparent bg-transparent px-2! py-0! text-[13px] shadow-none! hover:bg-accent"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">—</SelectItem>
                    {def.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <PropTextEditor
                  initial={text}
                  type={type === "number" ? "number" : type === "date" ? "date" : "text"}
                  placeholder={type === "list" || type === "tags" ? "comma, separated" : "—"}
                  ariaLabel={`Property ${key}`}
                  onCommit={(raw) => setPropText(key, raw)}
                />
              )}
              <span className="w-14 shrink-0 text-right text-[10px] uppercase tracking-wide text-muted-foreground/70">{type}</span>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition hover:text-destructive hover:opacity-100"
                onClick={() => removeProp(key)}
                aria-label={`Remove property ${key}`}
              >
                <IconX size={12} />
              </button>
            </div>
          );
        })}
        {addingProp ? (
          <div className="flex flex-wrap items-center gap-2 py-1">
            <input
              autoFocus
              className="w-24 shrink-0 rounded border border-border bg-transparent px-1.5 py-0.5 text-xs outline-none"
              value={newPropKey}
              placeholder="name"
              aria-label="New property name"
              list="chibako-prop-suggestions"
              onChange={(e) => handleNewPropKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addProp(); }
                if (e.key === "Escape") cancelAddProp();
              }}
            />
            <datalist id="chibako-prop-suggestions">
              {propDefs.map((d) => <option key={d.name} value={d.name} />)}
            </datalist>
            <Select
              items={Object.fromEntries(PROPERTY_TYPES.map((t) => [t, t]))}
              value={newPropType}
              onValueChange={(v) => { if (v !== null) setNewPropType(v as PropertyType); }}
            >
              <SelectTrigger
                size="sm"
                aria-label="New property type"
                className="h-6! w-32! gap-1.5 rounded-md border-transparent bg-transparent px-2! py-0! text-xs shadow-none! hover:bg-accent"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {newPropType === "select" && (
              <input
                className="min-w-0 flex-1 rounded border border-border bg-transparent px-1.5 py-0.5 text-xs outline-none"
                value={newPropOptions}
                placeholder="allowed values, comma separated"
                aria-label="Allowed values"
                onChange={(e) => setNewPropOptions(e.target.value)}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={addProp}
            >
              Add
            </Button>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground transition hover:text-foreground"
              onClick={cancelAddProp}
              aria-label="Cancel adding property"
            >
              <IconX size={13} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="mt-1 flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            onClick={() => setAddingProp(true)}
          >
            <IconPlus size={12} /> Add property
          </button>
        )}
      </div>
    ) : (
      <button
        type="button"
        className="mb-3 flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        onClick={() => setAddingProp(true)}
      >
        <IconPlus size={12} /> Add property
      </button>
    );
  }

  function connectionsPanel() {
    if (!note) return null;
    return <>
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-xs font-semibold text-muted-foreground">Connections</h3>
        <Button variant="ghost" size="icon-sm" aria-label="Close connections" onClick={() => setShowLinks(false)}><IconX size={13} /></Button>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-3 pb-6">
        <div>
          <h4 className="px-1 text-xs font-medium text-muted-foreground">Backlinks ({links?.backlinks.length ?? 0})</h4>
          {links?.backlinks.length ? <ul className="mt-1 flex flex-col gap-0.5">
            {links.backlinks.map((b) => <li key={b.id}><button className="w-full rounded-md px-2 py-1.5 text-left transition hover:bg-muted" onClick={() => router.push(`/app/note/${b.id}`)}><span className="block text-[13px] font-medium text-primary">{b.title}</span><span className="block truncate text-xs text-muted-foreground">{b.snippet}</span></button></li>)}
          </ul> : <p className="mt-1 px-2 text-xs text-muted-foreground">Nothing links here yet. Add <code>[[{note.title}]]</code> elsewhere.</p>}
        </div>
        <div>
          <h4 className="px-1 text-xs font-medium text-muted-foreground">Linked to ({links?.outlinks.length ?? 0})</h4>
          {links?.outlinks.length ? <ul className="mt-1 flex flex-col gap-0.5">
            {links.outlinks.map((o) => <li key={o.target}><button className={cn("w-full rounded-md px-2 py-1.5 text-left text-[13px] transition hover:bg-muted", o.resolved ? "text-primary" : "text-muted-foreground italic")} onClick={() => navigateTo(o.target)}>{o.target}</button></li>)}
          </ul> : <p className="mt-1 px-2 text-xs text-muted-foreground">No outgoing links.</p>}
        </div>
        {mentions.length > 0 && <div>
          <h4 className="px-1 text-xs font-medium text-muted-foreground">Mentioned in ({mentions.length})</h4>
          <ul className="mt-1 flex flex-col gap-0.5">{mentions.map((m) => <li key={m.id} className="rounded-md px-2 py-1.5 transition hover:bg-muted"><button className="block w-full text-left" onClick={() => router.push(`/app/note/${m.id}`)} title="Open note"><span className="block text-[13px] font-medium">{m.title}</span><span className="block truncate text-xs text-muted-foreground">{m.snippet}</span></button><button className="mt-0.5 text-[11px] font-medium text-primary hover:underline" onClick={() => linkMentionFrom(m.id)}>Link first mention</button></li>)}</ul>
        </div>}
      </div>
    </>;
  }

  return (
    <div className="flex h-full" onKeyDown={handleKeys}>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex flex-col gap-0.5 px-4 py-2">
          {/* context row: where am I · what is this · document actions */}
          <div className="flex items-center gap-2">
            <nav aria-label="Location" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs text-muted-foreground">
              <button
                type="button"
                onClick={goHome}
                title="Go to home index"
                className="flex shrink-0 items-center gap-1 rounded px-0.5 py-0.5 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <IconHome size={12} />
                Home
              </button>
              {crumbs.map((seg, i) => {
                const path = crumbs.slice(0, i + 1).join("/");
                const indexNote = indexNoteFor(path);
                return (
                  <span key={path} className="flex min-w-0 items-center gap-1">
                    <span aria-hidden className="shrink-0 select-none opacity-50">/</span>
                    {indexNote ? (
                      <button
                        type="button"
                        onClick={() => router.push(`/app/note/${indexNote.id}`)}
                        title={`Open "${indexNote.title}"`}
                        className="max-w-44 truncate rounded px-0.5 py-0.5 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {seg}
                      </button>
                    ) : (
                      <span className="max-w-44 truncate">{seg}</span>
                    )}
                  </span>
                );
              })}
            </nav>
            {/* Vertical-dot actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="shrink-0" aria-label="Note actions" />}>
                <IconDotsVertical size={16} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {/* View mode */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">View</DropdownMenuLabel>
                  {(["write", "edit", "split", "preview"] as const).map((v) => (
                    <DropdownMenuItem key={v} onClick={() => setViewAndRemember(v)}>
                      <span className={cn("flex w-full items-center justify-between", view === v && "font-medium")}>
                        {{ write: "Write", edit: "Markdown", split: "Split", preview: "Read" }[v]}
                        {view === v && <span className="text-primary">✓</span>}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {/* Kind */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Kind</DropdownMenuLabel>
                  {(["note", "wiki", "index"] as const).map((k) => (
                    <DropdownMenuItem key={k} onClick={() => handleChangeKind(k)}>
                      <span className={cn("flex w-full items-center gap-2", kind === k && "font-medium")}>
                        <span className="size-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[k] }} />
                        {k}
                        {kind === k && <span className="ml-auto text-primary">✓</span>}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                {note && <DropdownMenuSeparator />}
                {/* Bookmark */}
                {note && (
                  <DropdownMenuItem onClick={() => { if (bookmark) void removeBookmark(); else openBookmarkDialog(); }}>
                    <IconBookmark size={14} className={cn("mr-2", bookmark && "text-warning")} filled={!!bookmark} />
                    {bookmark ? "Remove bookmark" : "Bookmark"}
                  </DropdownMenuItem>
                )}
                {/* Pin */}
                {note && (
                  <DropdownMenuItem onClick={togglePinned}>
                    <IconPin size={14} className={cn("mr-2", pinned && "text-primary")} />
                    {pinned ? "Unpin" : "Pin to sidebar"}
                  </DropdownMenuItem>
                )}
                {note && <DropdownMenuSeparator />}
                {/* Delete */}
                {note && (
                  <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                    <IconTrash size={14} className="mr-2" />
                    Move to Trash
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* duplicate title warning */}
        {duplicateTitle && (
          <p className="mx-6 mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            Another note already uses this title — [[links]] to &ldquo;{title.trim()}&rdquo; resolve to the first match.
          </p>
        )}

        {/* body */}
        <div className={cn("flex min-h-0 flex-1", showEdit && showPreview && "flex-col md:flex-row")}>
          {showWrite && (
            <div className="w-full overflow-y-auto px-6 py-2">
              <div className="mx-auto w-full max-w-[88ch]">
                {titleInputJSX()}
                {propsToggleJSX()}
                {showProps && renderPropertyEditor()}
                <RichTextEditor
                  key={`${note?.id ?? "new"}:${editorKey}`}
                  initialMarkdown={fm.body}
                  noteId={note?.id ?? "new"}
                  selfTitle={title}
                  allNotes={allNotes}
                  onBodyChange={handleWriteBody}
                  onNavigate={navigateTo}
                  onViewShortcut={setViewAndRemember}
                />
              </div>
            </div>
          )}
          {showEdit && (
            <div
              ref={editWrapRef}
              onScroll={() => setSuggest(null)}
              className={cn("relative overflow-y-auto px-6 py-2", showPreview ? "h-1/2 w-full border-b border-border md:h-auto md:w-1/2 md:border-b-0 md:border-r" : "w-full")}
            >
              <div className="mx-auto w-full max-w-[88ch]">
                {titleInputJSX()}
                {propsToggleJSX()}
                {showProps && renderPropertyEditor()}
                <textarea
                key={editorKey}
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
              </div>
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
                      className={cn(
                        "block w-full rounded-lg px-3 py-1.5 text-left transition",
                        i === suggestIdx && "bg-muted"
                      )}
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
            <div className={cn("overflow-y-auto px-6 py-4", showEdit ? "h-1/2 w-full md:h-auto md:w-1/2" : "w-full")}>
              <div className="mx-auto w-full max-w-[88ch]">
                {!showEdit && titleInputJSX()}
                {propKeys.length > 0 && (
                <div className="mb-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-[13px]">
                  {propKeys.map((key) => {
                    const value = fm.props[key];
                    const text = typeof value === "boolean"
                      ? (value ? "✓" : "—")
                      : Array.isArray(value) ? value.join(", ") : String(value ?? "");
                    return (
                      <div key={key} className="contents">
                        <span className="font-medium text-muted-foreground">{key}</span>
                        <span className="truncate">{text || "—"}</span>
                      </div>
                    );
                  })}
                </div>
              )}
                {fm.body.trim() ? (
                  <MarkdownPreview content={fm.body} onNavigate={navigateTo} />
                ) : (
                  <p className="text-sm text-muted-foreground">Preview is empty.</p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-muted-foreground">
          <span>{view === "edit" ? "Markdown" : view === "preview" ? "Read" : view[0].toUpperCase() + view.slice(1)}</span>
          <span role="status" aria-live="polite" className={saveState === "error" ? "text-destructive" : undefined}>
            {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Unsaved"}
          </span>
          {saveState === "error" && <button type="button" className="font-medium text-destructive hover:underline" onClick={() => void persist().catch(() => {})}>Retry</button>}
          {note && <span className="ml-auto">{wordCount} word{wordCount === 1 ? "" : "s"}</span>}
          {note && <span className="hidden sm:inline">Edited {relTime(note.updated_at)}</span>}
        </div>
      </div>

      {/* right links panel */}
      {note && showLinks && wideLinks && <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-border bg-background">{connectionsPanel()}</aside>}
      {note && !wideLinks && <Sheet open={showLinks} onOpenChange={setShowLinks}><SheetContent side="right" className="w-72 bg-background p-0" showCloseButton={false}><SheetTitle className="sr-only">Connections</SheetTitle>{connectionsPanel()}</SheetContent></Sheet>}

      {/* create missing note dialog */}
      <Dialog open={createModal !== null} onOpenChange={(o) => !o && setCreateModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create “{createModal}”?</DialogTitle>
            <DialogDescription>This note doesn’t exist yet. Create it now?</DialogDescription>
          </DialogHeader>
          <div>
            <Field>
              <FieldLabel htmlFor="chibako-new-folder">Folder</FieldLabel>
              <Input
                id="chibako-new-folder"
                value={createFolder}
                onChange={(e) => setCreateFolder(e.target.value)}
                placeholder="folder"
              />
            </Field>
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
      {/* bookmark dialog */}
      <Dialog open={bookmarkOpen} onOpenChange={setBookmarkOpen}>
        <DialogContent>
          <form onSubmit={submitBookmark} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{bookmark ? "Edit bookmark" : "Bookmark note"}</DialogTitle>
              <DialogDescription>
                {bookmark ? "Choose a group to organize this bookmark." : "Pick a group — or leave it in the default Bookmarks list."}
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="chibako-bm-group">Group</FieldLabel>
              <Select
                items={{ "": "No group", ...Object.fromEntries(bmGroups.map((g) => [g, g])), [NEW_GROUP_VALUE]: "New group…" }}
                value={bmGroup}
                onValueChange={(v) => { if (v !== null) setBmGroup(v); }}
              >
                <SelectTrigger size="sm" aria-label="Bookmark group" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No group</SelectItem>
                  {bmGroups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  <SelectSeparator />
                  <SelectItem value={NEW_GROUP_VALUE}>New group…</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {bmGroup === NEW_GROUP_VALUE && (
              <Field>
                <FieldLabel htmlFor="chibako-bm-newgroup">New group name</FieldLabel>
                <Input
                  id="chibako-bm-newgroup"
                  value={bmNewGroup}
                  onChange={(e) => setBmNewGroup(e.target.value)}
                  placeholder="e.g. Projects"
                  maxLength={60}
                  autoFocus
                />
              </Field>
            )}
            <DialogFooter className="flex items-center justify-between">
              {bookmark ? (
                <Button type="button" variant="outline" onClick={removeBookmark}>Remove bookmark</Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="outline" type="button" onClick={() => setBookmarkOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={bmBusy}>{bookmark ? "Save" : "Bookmark"}</Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* keyboard shortcuts live in the TopBar (⌘/ or the keyboard icon) */}
    </div>
  );
}
