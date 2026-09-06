"use client";

import { useCallback, useEffect, useState, type DragEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { IconDots, IconFolderPlus, IconLayoutSidebarLeftExpand } from "@tabler/icons-react";
import type { NoteSummary } from "@/lib/notes";
import { cn } from "@/lib/utils";
import { IconChevron, IconFile, IconFolder, IconHome, IconPlus, IconTrash } from "@/components/icons";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from "@/components/ui/dropdown-menu";

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
  const [closed, setClosed] = useState(new Set<string>());
  const [filter, setFilter] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<Item | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<NoteSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, trashed] = await Promise.all([fetch("/api/notes"), fetch("/api/trash")]);
      if (!res.ok || !trashed.ok) throw new Error();
      const data = await res.json();
      setNotes(data.notes);
      setFolders(data.folders);
      setTrash((await trashed.json()).notes);
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

  function start(mode: Action["mode"], item: Item) {
    setAction({ mode, item }); setName(mode === "create" ? "" : item.name);
    setParent(item.parent); setError("");
  }
  function create(type: Item["type"], parent = "") { start("create", { type, parent, id: "", name: "" }); }
  async function request(url: string, method: string, body?: object) {
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
      onDragLeave() { setDropTarget(null); },
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
  function menu(item: Item) {
    return <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.name}`} disabled={busy} />}><IconDots /></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuGroup>
        {item.type === "folder" && <><DropdownMenuItem onClick={() => create("note", item.id)}>New file</DropdownMenuItem><DropdownMenuItem onClick={() => create("folder", item.id)}>New folder</DropdownMenuItem></>}
        <DropdownMenuItem onClick={() => start("rename", item)}>Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={() => start("move", item)}>Move to…</DropdownMenuItem>
      </DropdownMenuGroup></DropdownMenuContent>
    </DropdownMenu>;
  }
  function noteRow(note: NoteSummary) {
    const item: Item = { type: "note", id: note.id, name: note.title, parent: note.folder };
    return <div key={note.id} className="flex items-center" {...dragProps(item)}>
      <Link href={`/app/note/${note.id}`} aria-current={pathname === `/app/note/${note.id}` ? "page" : undefined}
        title={note.title} className={cn("tree-item min-w-0 flex-1", pathname === `/app/note/${note.id}` && "active")} draggable={false}>
        <IconFile size={14} /><span className="truncate">{note.title}</span>
      </Link>{menu(item)}
    </div>;
  }
  function folderRow(path: string): React.ReactNode {
    const item: Item = { type: "folder", id: path, name: nameOf(path), parent: parentOf(path) };
    const open = !closed.has(path);
    return <div key={path}>
      <div className={cn("flex items-center rounded-md", dropTarget === path && "bg-accent ring-1 ring-primary")} {...dropProps(path)} {...dragProps(item)}>
        <button className="tree-item min-w-0 flex-1" aria-expanded={open} onClick={() => setClosed(prev => {
          const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next;
        })}>
          <IconChevron size={12} className={cn(open && "rotate-90")} /><IconFolder size={14} /><span className="truncate">{item.name}</span>
        </button>{menu(item)}
      </div>
      {open && <div className="ml-3 border-l border-border pl-1">{folders.filter(f => parentOf(f) === path).map(folderRow)}{notes.filter(n => n.folder === path).map(noteRow)}</div>}
    </div>;
  }
  const home = notes.find(n => n.kind === "index");
  const body = <>
    <div className="flex items-center gap-1 px-3 py-3">
      <Link href="/app" className="min-w-0 flex-1 font-heading text-sm font-semibold">Chibako</Link>
      <Button variant="ghost" size="icon" aria-label="New file" onClick={() => create("note")}><IconPlus /></Button>
      <Button variant="ghost" size="icon" aria-label="New folder" onClick={() => create("folder")}><IconFolderPlus /></Button>
    </div>
    <div className="px-3 pb-3"><Input aria-label="Filter files" placeholder="Filter files…" value={filter} onChange={e => setFilter(e.target.value)} /></div>
    <nav aria-label="Files and folders" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {home && <Link href={`/app/note/${home.id}`} className="tree-item"><IconHome size={14} />Home</Link>}
      {filter ? notes.filter(n => `${n.folder}/${n.title}`.toLowerCase().includes(filter.toLowerCase())).map(noteRow) : <>
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
      </>}
    </nav>
    <div className="px-4 py-2 text-xs text-muted-foreground">{notes.length} files</div>
  </>;
  return <>
    {mobile ? <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
      <SheetContent side="left" className="w-72 p-0"><SheetTitle className="sr-only">Files and folders</SheetTitle><div className="flex h-full flex-col pt-8">{body}</div></SheetContent>
    </Sheet> : <aside id="file-sidebar" aria-label="Sidebar" className={cn("flex shrink-0 flex-col border-r border-border bg-sidebar", collapsed ? "w-12 items-center gap-2 py-3" : "w-60")}>
      {collapsed ? <>
        <Button variant="ghost" size="icon" aria-label="Expand sidebar" onClick={onExpand}><IconLayoutSidebarLeftExpand /></Button>
        <Button variant="ghost" size="icon" aria-label="New file" onClick={() => create("note")}><IconPlus /></Button>
        <Button variant="ghost" size="icon" aria-label="New folder" onClick={() => create("folder")}><IconFolderPlus /></Button>
      </> : body}
    </aside>}
    <Dialog open={action !== null} onOpenChange={open => { if (!open && !busy) setAction(null); }}>
      <DialogContent><form onSubmit={submit} className="flex flex-col gap-4">
        <DialogHeader><DialogTitle>{action?.mode === "create" ? "New" : action?.mode === "rename" ? "Rename" : "Move"} {action?.item.type === "folder" ? "folder" : "file"}</DialogTitle></DialogHeader>
        <FieldGroup>
          {action?.mode !== "move" && <Field data-invalid={!!error}><FieldLabel htmlFor="item-name">Name</FieldLabel><Input id="item-name" autoFocus value={name} onChange={e => setName(e.target.value)} aria-invalid={!!error} maxLength={120} /></Field>}
          {action?.mode !== "rename" && <Field><FieldLabel htmlFor="item-parent">Folder</FieldLabel><select id="item-parent" className="input" value={parent} onChange={e => setParent(e.target.value)}>
            <option value="">Files (root)</option>{folders.filter(f => action?.mode !== "move" || action.item.type !== "folder" || (f !== action.item.id && !f.startsWith(`${action.item.id}/`))).map(f => <option key={f} value={f}>{f}</option>)}
          </select></Field>}
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setAction(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : action?.mode === "move" ? "Move" : action?.mode === "rename" ? "Rename" : "Create"}</Button></DialogFooter>
      </form></DialogContent>
    </Dialog>
    <ConfirmDialog open={purgeTarget !== null} onOpenChange={open => !open && setPurgeTarget(null)} title={`Delete "${purgeTarget?.title}" forever?`} description="This cannot be undone." confirmLabel="Delete forever" destructive onConfirm={async () => {
      if (!purgeTarget) return;
      try { await request(`/api/trash/${purgeTarget.id}`, "DELETE"); setPurgeTarget(null); } catch { toast.error("Could not delete file."); }
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
