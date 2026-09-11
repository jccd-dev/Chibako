"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { IconDotsVertical, IconFolderPlus } from "@tabler/icons-react";
import type { NoteSummary, SearchResult } from "@/lib/notes";
import type { Bookmark } from "@/lib/bookmarks";
import { cn } from "@/lib/utils";
import { IconBookmark, IconBot, IconChevron, IconFile, IconFolder, IconGear, IconGraph, IconHome, IconPlus, IconSearch, IconTrash, IconX } from "@/components/icons";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuGroup, ContextMenuItem } from "@/components/ui/context-menu";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";

type Item = { type: "note" | "folder"; id: string; name: string; parent: string };
type Action = { mode: "create" | "rename" | "move"; item: Item };
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
const nameOf = (path: string) => path.split("/").at(-1)!;
const join = (parent: string, name: string) => parent ? `${parent}/${name}` : name;

export function Sidebar({ collapsed, mobile, mobileOpen, onMobileOpenChange, onExpand }: {
  collapsed: boolean; mobile: boolean; mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void; onExpand: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [trash, setTrash] = useState<NoteSummary[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkDialog, setBookmarkDialog] = useState<{ noteId: string; group: string } | null>(null);
  const [bmNewGroup, setBmNewGroup] = useState("");
  const [dragBookmarkId, setDragBookmarkId] = useState<string | null>(null);
  const [dropBookmarkId, setDropBookmarkId] = useState<string | null>(null);
  const [closed, setClosed] = useState(new Set<string>());

  // Search state
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchActive, setSearchActive] = useState(0);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchAbort = useRef<AbortController | null>(null);

  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<Item | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<NoteSummary | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<Item | null>(null);
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, trashed, marks] = await Promise.all([fetch("/api/notes"), fetch("/api/trash"), fetch("/api/bookmarks")]);
      if (!res.ok || !trashed.ok) throw new Error();
      const data = await res.json();
      setNotes(data.notes);
      setFolders(data.folders);
      setTrash((await trashed.json()).notes);
      if (marks.ok) setBookmarks((await marks.json()).bookmarks);
    } catch { toast.error("Could not load notes. Try again."); }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("chibako:notes-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("chibako:notes-changed", refresh);
    };
  }, [load, pathname]);

  useEffect(() => { onMobileOpenChange(false); }, [pathname, onMobileOpenChange]);

  // Live search effect
  useEffect(() => {
    searchAbort.current?.abort();
    if (!searchQuery.trim()) {
      setSearchBusy(false);
      setSearchResults([]);
      setSearchActive(0);
      return;
    }
    setSearchBusy(true);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      searchAbort.current?.abort();
      const ctrl = new AbortController();
      searchAbort.current = ctrl;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`, { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results);
          setSearchActive(0);
        }
      } catch {
        // aborted or error
      } finally {
        if (searchAbort.current === ctrl) setSearchBusy(false);
      }
    }, 180);
    return () => {
      clearTimeout(searchTimer.current);
      searchAbort.current?.abort();
    };
  }, [searchQuery]);

  // Focus search input when search mode is activated
  useEffect(() => {
    if (searchMode && (!collapsed || mobileOpen)) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [searchMode, collapsed, mobileOpen]);

  // Auto-scroll selected search result item into view
  useEffect(() => {
    if (searchMode && searchResults.length > 0) {
      const el = document.getElementById(`search-result-${searchActive}`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [searchActive, searchMode, searchResults.length]);

  function activateSearch() {
    setSearchMode(true);
    if (collapsed) {
      onExpand();
    }
    if (mobile && !mobileOpen) {
      onMobileOpenChange(true);
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (searchResults.length === 0 && e.key !== "Escape") return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchActive((prev) => (searchResults.length ? (prev + 1) % searchResults.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchActive((prev) => (searchResults.length ? (prev - 1 + searchResults.length) % searchResults.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = searchResults[searchActive];
      if (selected) {
        router.push(`/app/note/${selected.id}`);
        if (mobile) onMobileOpenChange(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (searchQuery) {
        setSearchQuery("");
      } else {
        setSearchMode(false);
      }
    }
  }

  function start(mode: Action["mode"], item: Item) {
    setAction({ mode, item }); setName(mode === "create" ? "" : item.name);
    setParent(item.parent); setError("");
  }
  function create(type: Item["type"], parent = "") { start("create", { type, parent, id: "", name: "" }); }
  async function request(url: string, method: string, body?: object) {
    const saves: Promise<void>[] = [];
    window.dispatchEvent(new CustomEvent("chibako:before-organize", { detail: saves }));
    await Promise.all(saves);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not save changes.");
    window.dispatchEvent(new Event("chibako:notes-changed"));
    window.dispatchEvent(new Event("chibako:organized"));
    return data;
  }
  async function move(item: Item, destination: string) {
    if (item.parent === destination) return;
    if (item.type === "folder") await request("/api/folders", "PATCH", { from: item.id, to: join(destination, item.name) });
    else await request(`/api/notes/${item.id}`, "PATCH", { folder: destination });
    setClosed(prev => new Set([...prev].filter(path => path !== destination)));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!action || busy) return;
    const { mode, item } = action;
    if (mode !== "move" && (!name.trim() || /[\/\\\x00-\x1f]/.test(name) || name === "." || name === "..")) {
      setError("Enter a name without slashes or control characters."); return;
    }
    setBusy(true); setError("");
    try {
      if (mode === "move") await move(item, parent);
      else if (item.type === "folder") {
        await request("/api/folders", mode === "create" ? "POST" : "PATCH",
          mode === "create" ? { path: join(parent, name.trim()) } : { from: item.id, to: join(item.parent, name.trim()) });
      } else {
        const data = await request(mode === "create" ? "/api/notes" : `/api/notes/${item.id}`,
          mode === "create" ? "POST" : "PATCH", mode === "create" ? { title: name.trim(), folder: parent } : { title: name.trim() });
        if (mode === "create") router.push(`/app/note/${data.note.id}`);
      }
      setAction(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save changes."); }
    finally { setBusy(false); }
  }
  function validDrop(path: string) {
    return dragging && !busy && dragging.parent !== path &&
      (dragging.type !== "folder" || (path !== dragging.id && !path.startsWith(`${dragging.id}/`)));
  }
  function dropProps(path: string) {
    return {
      onDragOver(e: DragEvent) {
        if (!validDrop(path)) return;
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setDropTarget(path);
      },
      onDragLeave(e: DragEvent) {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
      },
      async onDrop(e: DragEvent) {
        e.preventDefault(); e.stopPropagation(); setDropTarget(null);
        if (!validDrop(path) || !dragging) return;
        setBusy(true);
        try { await move(dragging, path); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not move item."); }
        finally { setBusy(false); setDragging(null); }
      },
    };
  }
  function dragProps(item: Item) {
    return {
      draggable: !busy,
      onDragStart(e: DragEvent) { e.stopPropagation(); e.dataTransfer.setData("text/plain", item.id); e.dataTransfer.effectAllowed = "move"; setDragging(item); },
      onDragEnd() { setDragging(null); setDropTarget(null); },
    };
  }
  function actions(item: Item) {
    const mark = item.type === "note" ? bookmarkByNote.get(item.id) : undefined;
    return <ContextMenuGroup>
      {item.type === "folder" && <><ContextMenuItem disabled={busy} onClick={() => create("note", item.id)}>New file</ContextMenuItem><ContextMenuItem disabled={busy} onClick={() => create("folder", item.id)}>New folder</ContextMenuItem></>}
      {item.type === "note" && <ContextMenuItem disabled={busy} onClick={() => openBookmarkDialog(item.id)}>{mark ? "Edit bookmark" : "Bookmark"}</ContextMenuItem>}
      <ContextMenuItem disabled={busy} onClick={() => start("rename", item)}>Rename</ContextMenuItem>
      <ContextMenuItem disabled={busy} onClick={() => start("move", item)}>Move to…</ContextMenuItem>
      {item.type === "folder"
        ? <ContextMenuItem disabled={busy} variant="destructive" onClick={() => setDeleteFolderTarget(item)}>Delete folder</ContextMenuItem>
        : <ContextMenuItem disabled={busy} variant="destructive" onClick={() => setDeleteNoteTarget(item)}>Delete</ContextMenuItem>}
    </ContextMenuGroup>;
  }
  function menu(item: Item) {
    return <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="sidebar-row-action" aria-label={`Actions for ${item.name}`} disabled={busy} />}><IconDotsVertical /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">{actions(item)}</DropdownMenuContent>
    </DropdownMenu>;
  }

  // ---- bookmarks ----
  const bookmarkByNote = useMemo(() => new Map(bookmarks.map(b => [b.note_id, b])), [bookmarks]);
  const titleByNoteId = useMemo(() => new Map(notes.map(n => [n.id, n.title])), [notes]);
  const orderedBookmarks = useMemo(() =>
    [...bookmarks].sort((a, b) => a.group_name.localeCompare(b.group_name) || a.sort - b.sort), [bookmarks]);
  const bookmarkGroupNames = useMemo(() =>
    [...new Set(bookmarks.map((b) => b.group_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [bookmarks]);
  const flatBookmarks = orderedBookmarks.filter(b => !b.group_name);
  const bookmarkGroups = useMemo(() => {
    const map = new Map<string, Bookmark[]>();
    for (const b of orderedBookmarks) {
      if (!b.group_name) continue;
      const list = map.get(b.group_name) ?? [];
      list.push(b);
      map.set(b.group_name, list);
    }
    return [...map.entries()];
  }, [orderedBookmarks]);

  async function reloadBookmarks() {
    const res = await fetch("/api/bookmarks");
    if (res.ok) setBookmarks((await res.json()).bookmarks);
  }
  function openBookmarkDialog(noteId: string) {
    const existing = bookmarkByNote.get(noteId);
    setBookmarkDialog({ noteId, group: existing?.group_name ?? "" });
    setBmNewGroup("");
  }
  async function submitBookmark(e: React.FormEvent) {
    e.preventDefault();
    if (!bookmarkDialog) return;
    const existing = bookmarkByNote.get(bookmarkDialog.noteId);
    const group = bookmarkDialog.group === "__new__" ? bmNewGroup.trim() : bookmarkDialog.group;
    const res = await fetch("/api/bookmarks", {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(existing
        ? { id: existing.id, label: "", group_name: group }
        : { note_id: bookmarkDialog.noteId, label: "", group_name: group }),
    });
    if (res.ok) { setBookmarkDialog(null); void reloadBookmarks(); }
    else toast.error("Could not save bookmark.");
  }
  async function removeBookmark(id: string) {
    const res = await fetch(`/api/bookmarks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) void reloadBookmarks(); else toast.error("Could not remove bookmark.");
  }
  function bookmarkDragProps(b: Bookmark) {
    return {
      draggable: true,
      onDragStart(e: DragEvent) { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; setDragBookmarkId(b.id); },
      onDragEnd() { setDragBookmarkId(null); setDropBookmarkId(null); },
    };
  }
  function bookmarkDropProps(b: Bookmark) {
    return {
      onDragOver(e: DragEvent) {
        if (!dragBookmarkId || dragBookmarkId === b.id) return;
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setDropBookmarkId(b.id);
      },
      onDragLeave(e: DragEvent) {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropBookmarkId(null);
      },
      async onDrop(e: DragEvent) {
        e.preventDefault(); e.stopPropagation();
        const from = dragBookmarkId;
        setDropBookmarkId(null); setDragBookmarkId(null);
        if (!from || from === b.id) return;
        const ordered = orderedBookmarks.map(x => ({ id: x.id, group_name: x.group_name }));
        const fromIdx = ordered.findIndex(x => x.id === from);
        const targetIdx = ordered.findIndex(x => x.id === b.id);
        if (fromIdx === -1 || targetIdx === -1) return;
        const [moved] = ordered.splice(fromIdx, 1);
        const target = ordered.find(x => x.id === b.id)!;
        moved.group_name = target.group_name;
        ordered.splice(ordered.findIndex(x => x.id === b.id), 0, moved);
        try {
          const res = await fetch("/api/bookmarks", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: ordered }) });
          if (!res.ok) throw new Error();
          void reloadBookmarks();
        } catch { toast.error("Could not reorder bookmarks."); }
      },
    };
  }
  function bookmarkRow(b: Bookmark) {
    const title = titleByNoteId.get(b.note_id) ?? "(missing note)";
    const label = b.label || title;
    return <div key={b.id} className={cn("flex items-center rounded-md", dropBookmarkId === b.id && "bg-accent ring-1 ring-primary")} {...bookmarkDragProps(b)} {...bookmarkDropProps(b)}>
      <ContextMenu>
        <ContextMenuTrigger className="flex min-w-0 flex-1">
          <Link href={`/app/note/${b.note_id}`} title={title} className="tree-item min-w-0 flex-1" draggable={false}>
            <IconBookmark size={14} /><span className="truncate">{label}</span>
          </Link>
        </ContextMenuTrigger>
        <ContextMenuContent><ContextMenuGroup>
          <ContextMenuItem onClick={() => openBookmarkDialog(b.note_id)}>Edit bookmark</ContextMenuItem>
          <ContextMenuItem variant="destructive" onClick={() => removeBookmark(b.id)}>Remove bookmark</ContextMenuItem>
        </ContextMenuGroup></ContextMenuContent>
      </ContextMenu>
    </div>;
  }
  function noteRow(note: NoteSummary) {
    const item: Item = { type: "note", id: note.id, name: note.title, parent: note.folder };
    return <div key={note.id} className="group/sidebar-row flex items-center" {...dragProps(item)}>
      <ContextMenu>
        <ContextMenuTrigger className="flex min-w-0 flex-1">
          <Link href={`/app/note/${note.id}`} aria-current={pathname === `/app/note/${note.id}` ? "page" : undefined}
            title={note.title} className={cn("tree-item min-w-0 flex-1", pathname === `/app/note/${note.id}` && "active")} draggable={false}>
            <IconFile size={14} /><span className="truncate">{note.title}</span>
          </Link>
        </ContextMenuTrigger>
        <ContextMenuContent>{actions(item)}</ContextMenuContent>
      </ContextMenu>{menu(item)}
    </div>;
  }
  function folderRow(path: string): React.ReactNode {
    const item: Item = { type: "folder", id: path, name: nameOf(path), parent: parentOf(path) };
    const open = !closed.has(path);
    return <div key={path}>
      <div className={cn("group/sidebar-row flex items-center rounded-md", dropTarget === path && "bg-accent ring-1 ring-primary")} {...dropProps(path)} {...dragProps(item)}>
        <ContextMenu>
          <ContextMenuTrigger className="flex min-w-0 flex-1">
            <button className="tree-item min-w-0 flex-1" aria-expanded={open} onClick={() => setClosed(prev => {
              const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next;
            })}>
              <IconChevron size={12} className={cn(open && "rotate-90")} /><IconFolder size={14} /><span className="truncate">{item.name}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>{actions(item)}</ContextMenuContent>
        </ContextMenu>{menu(item)}
      </div>
      {open && <div className="ml-3 border-l border-border pl-1">{folders.filter(f => parentOf(f) === path).map(folderRow)}{notes.filter(n => n.folder === path).map(noteRow)}</div>}
    </div>;
  }



  const searchView = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-1 pt-2">
        <div className="relative flex items-center">
          <IconSearch size={13} className="pointer-events-none absolute left-2.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            aria-label="Search all notes"
            placeholder="Search notes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="h-8 border-transparent bg-muted/50 pl-8 pr-7 text-xs shadow-none focus-visible:border-border"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
              className="absolute right-2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <IconX size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" id="sidebar-search-results">
        {searchQuery.trim() === "" ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            <p>Search across titles and note content.</p>
            <p className="mt-1 text-[11px]">Use ↑↓ to navigate results, ↵ to open.</p>
          </div>
        ) : searchResults.length === 0 && !searchBusy ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No notes found for "{searchQuery}".
          </div>
        ) : (
          searchResults.map((r, i) => (
            <button
              key={r.id}
              id={`search-result-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === searchActive}
              className={cn(
                "block w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                i === searchActive && "bg-accent ring-1 ring-primary/40"
              )}
              onMouseEnter={() => setSearchActive(i)}
              onClick={() => {
                router.push(`/app/note/${r.id}`);
                if (mobile) onMobileOpenChange(false);
              }}
            >
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <IconFile size={13} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{r.title}</span>
                {r.folder && (
                  <span className="ml-auto shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                    {r.folder}
                  </span>
                )}
              </div>
              {r.snippet && (
                <div className="mt-0.5 line-clamp-2 pl-4 text-[11px] leading-tight text-muted-foreground">
                  {r.snippet.split(/(<mark>|<\/mark>)/).map((part, idx, parts) =>
                    part === "<mark>" || part === "</mark>"
                      ? null
                      : parts[idx - 1] === "<mark>"
                      ? <mark key={idx}>{part}</mark>
                      : part
                  )}
                </div>
              )}
            </button>
          ))
        )}
      </div>
      {searchResults.length > 0 && (
        <div className="border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">
          ↑↓ navigate · ↵ open · esc close
        </div>
      )}
    </div>
  );

  const fileTree = (
    <>
      <nav aria-label="Files and folders" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {bookmarks.length > 0 && (
          <details open className="mb-1">
            <summary className="tree-item"><IconBookmark size={14} />Bookmarks</summary>
            {flatBookmarks.map(bookmarkRow)}
            {bookmarkGroups.map(([group, items]) => (
              <div key={group} className="ml-3 border-l border-border pl-1">
                <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</div>
                {items.map(bookmarkRow)}
              </div>
            ))}
          </details>
        )}
        {notes.some(n => n.is_pinned) && <details><summary className="tree-item">Pinned</summary>{notes.filter(n => n.is_pinned).map(noteRow)}</details>}
        <details><summary className="tree-item">Recent</summary>{[...notes].sort((a,b) => b.updated_at - a.updated_at).slice(0,5).map(noteRow)}</details>
        <div {...dropProps("")} className={cn("tree-item my-1", dropTarget === "" && "bg-accent ring-1 ring-primary")}><IconFolder size={14} />Files</div>
        {folders.filter(f => !parentOf(f)).map(folderRow)}
        {notes.filter(n => !n.folder).map(noteRow)}
        {trash.length > 0 && <details className="mt-3"><summary className="tree-item"><IconTrash size={14} />Trash ({trash.length})</summary>
          {trash.map(n => <div key={n.id} className="flex items-center gap-1 px-2"><span className="min-w-0 flex-1 truncate text-xs">{n.title}</span>
            <Button variant="ghost" size="sm" onClick={async () => {
              try { await request(`/api/notes/${n.id}/restore`, "POST"); router.push(`/app/note/${n.id}`); }
              catch { toast.error("Could not restore file."); }
            }}>Restore</Button><Button variant="ghost" size="icon-sm" aria-label={`Delete ${n.title} forever`} onClick={() => setPurgeTarget(n)}><IconTrash /></Button>
          </div>)}
        </details>}
      </nav>
      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{notes.length} files</div>
    </>
  );

  const filePanel = (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 py-2.5">
        <Link href="/app" className="flex min-w-0 flex-1 items-center gap-2 font-heading text-sm font-semibold">
          <img src="/logo_main.png" alt="" className="h-5 w-5 shrink-0" />
          <span className="truncate">Chibako</span>
        </Link>
        <Button variant="ghost" size="icon" aria-label="New file" onClick={() => create("note")}><IconPlus /></Button>
        <Button variant="ghost" size="icon" aria-label="New folder" onClick={() => create("folder")}><IconFolderPlus /></Button>
      </div>
      {searchMode ? searchView : fileTree}
    </div>
  );

  const activityRail = (
    <nav aria-label="Workspace" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
      <Link
        href="/app"
        aria-label="Home"
        title="Home"
        className={cn(
          "grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          pathname === "/app" && !searchMode && "bg-accent text-foreground"
        )}
      >
        <IconHome size={16} />
      </Link>
      {/* Files icon: goes back to file list (expands panel if collapsed) */}
      <button
        type="button"
        aria-label="Files"
        title="Files"
        className={cn(
          "grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          !searchMode && !collapsed && "bg-accent text-foreground"
        )}
        onClick={() => {
          if (searchMode) { setSearchMode(false); setSearchQuery(""); }
          if (collapsed) onExpand();
        }}
      >
        <IconFile size={16} />
      </button>
      <button
        type="button"
        aria-label="Search notes"
        title="Search notes"
        className={cn(
          "grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          searchMode && (!collapsed || mobileOpen) && "bg-accent text-foreground"
        )}
        onClick={activateSearch}
      >
        <IconSearch size={16} />
      </button>
      <Link
        href="/app/graph"
        aria-label="Graph"
        title="Graph"
        className={cn(
          "grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          pathname === "/app/graph" && "bg-accent text-foreground"
        )}
      >
        <IconGraph size={16} />
      </Link>
      <Link
        href="/app/agent"
        aria-label="Agent access"
        title="Agent access"
        className={cn(
          "mt-auto grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          pathname === "/app/agent" && "bg-accent text-foreground"
        )}
      >
        <IconBot size={16} />
      </Link>
      <Link
        href="/app/settings"
        aria-label="Settings"
        title="Settings"
        className={cn(
          "grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          pathname === "/app/settings" && "bg-accent text-foreground"
        )}
      >
        <IconGear size={16} />
      </Link>
    </nav>
  );

  return <>
    {mobile ? (
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Files and folders</SheetTitle>
          <div className="flex h-full flex-col pt-8">
            {filePanel}
          </div>
        </SheetContent>
      </Sheet>
    ) : (
      <aside
        id="file-sidebar"
        aria-label="Sidebar"
        className={cn(
          "flex shrink-0 border-r border-border bg-sidebar transition-[width] duration-150 ease-out",
          collapsed ? "w-11" : "w-[17.75rem]"
        )}
      >
        {activityRail}
        {!collapsed && filePanel}
      </aside>
    )}

    <Dialog open={action !== null} onOpenChange={open => { if (!open && !busy) setAction(null); }}>
      <DialogContent><form onSubmit={submit} className="flex flex-col gap-4">
        <DialogHeader><DialogTitle>{action?.mode === "create" ? "New" : action?.mode === "rename" ? "Rename" : "Move"} {action?.item.type === "folder" ? "folder" : "file"}</DialogTitle></DialogHeader>
        <FieldGroup>
          {action?.mode !== "move" && <Field data-invalid={!!error}><FieldLabel htmlFor="item-name">Name</FieldLabel><Input id="item-name" autoFocus value={name} onChange={e => setName(e.target.value)} aria-invalid={!!error} maxLength={120} /></Field>}
          {action?.mode !== "rename" && <Field><FieldLabel htmlFor="item-parent">Folder</FieldLabel><Select items={{ "": "Files (root)", ...Object.fromEntries(folders.filter(f => action?.mode !== "move" || action.item.type !== "folder" || (f !== action.item.id && !f.startsWith(`${action.item.id}/`))).map(f => [f, f])) }} value={parent} onValueChange={value => { if (value !== null) setParent(value); }}>
            <SelectTrigger id="item-parent" size="sm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Files (root)</SelectItem>
              {folders.filter(f => action?.mode !== "move" || action.item.type !== "folder" || (f !== action.item.id && !f.startsWith(`${action.item.id}/`))).map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select></Field>}
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setAction(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : action?.mode === "move" ? "Move" : action?.mode === "rename" ? "Rename" : "Create"}</Button></DialogFooter>
      </form></DialogContent>
    </Dialog>

    <Dialog open={bookmarkDialog !== null} onOpenChange={open => { if (!open) setBookmarkDialog(null); }}>
      <DialogContent><form onSubmit={submitBookmark} className="flex flex-col gap-4">
        <DialogHeader><DialogTitle>Bookmark</DialogTitle></DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="bm-group">Group</FieldLabel>
            <Select
              items={{ "": "No group", ...Object.fromEntries(bookmarkGroupNames.map((g) => [g, g])), "__new__": "New group…" }}
              value={bookmarkDialog?.group ?? ""}
              onValueChange={(v) => { if (v !== null) setBookmarkDialog(d => d ? { ...d, group: v } : d); }}
            >
              <SelectTrigger size="sm" aria-label="Bookmark group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No group</SelectItem>
                {bookmarkGroupNames.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                <SelectSeparator />
                <SelectItem value="__new__">New group…</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {bookmarkDialog?.group === "__new__" && (
            <Field>
              <FieldLabel htmlFor="bm-newgroup">New group name</FieldLabel>
              <Input id="bm-newgroup" value={bmNewGroup} placeholder="e.g. Projects" maxLength={60}
                onChange={e => setBmNewGroup(e.target.value)} autoFocus />
            </Field>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setBookmarkDialog(null)}>Cancel</Button>
          <Button type="submit">Save bookmark</Button>
        </DialogFooter>
      </form></DialogContent>
    </Dialog>

    <ConfirmDialog open={purgeTarget !== null} onOpenChange={open => !open && setPurgeTarget(null)} title={`Delete "${purgeTarget?.title}" forever?`} description="This cannot be undone." confirmLabel="Delete forever" destructive onConfirm={async () => {
      if (!purgeTarget) return;
      try { await request(`/api/trash/${purgeTarget.id}`, "DELETE"); setPurgeTarget(null); } catch { toast.error("Could not delete file."); }
    }} />
    <ConfirmDialog open={deleteFolderTarget !== null} onOpenChange={open => !open && setDeleteFolderTarget(null)} title={`Delete folder "${deleteFolderTarget?.name}"?`} description={deleteFolderTarget ? `Files inside will move up to "${deleteFolderTarget.parent || "Files (root)"}" and keep their subfolders. The folder itself and its empty subfolders are removed.` : ""} confirmLabel="Delete folder" destructive onConfirm={async () => {
      if (!deleteFolderTarget) return;
      try { await request(`/api/folders?path=${encodeURIComponent(deleteFolderTarget.id)}`, "DELETE"); setDeleteFolderTarget(null); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete folder."); }
    }} />
    <ConfirmDialog open={deleteNoteTarget !== null} onOpenChange={open => !open && setDeleteNoteTarget(null)} title={`Delete "${deleteNoteTarget?.name}"?`} description="The file moves to Trash. You can restore it from there for 30 days." confirmLabel="Delete" destructive onConfirm={async () => {
      if (!deleteNoteTarget) return;
      try { await request(`/api/notes/${deleteNoteTarget.id}`, "DELETE"); if (pathname === `/app/note/${deleteNoteTarget.id}`) router.push("/app"); setDeleteNoteTarget(null); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete file."); }
    }} />
  </>;
}

export function relTime(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}
