"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { NoteSummary } from "@/lib/notes";
import { IconChevron, IconFile, IconFolder, IconHome, IconPlus, IconTrash } from "@/components/icons";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface FolderNode {
  name: string;
  path: string;
  notes: NoteSummary[];
  children: FolderNode[];
}

function buildTree(notes: NoteSummary[]): FolderNode[] {
  const root = new Map<string, FolderNode>();
  for (const n of notes) {
    const parts = n.folder.split("/").filter(Boolean);
    let parent = null as FolderNode | null;
    let acc = "";
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      if (!root.has(acc)) {
        root.set(acc, { name: p, path: acc, notes: [], children: [] });
      }
      const node = root.get(acc)!;
      if (parent) parent.children.push(node);
      parent = node;
    }
    if (parent) parent.notes.push(n);
    else {
      // root-level note (keyed by id — titles are not unique)
      root.set(`\0${n.id}`, { name: n.title, path: "", notes: [n], children: [] });
    }
  }
  // dedupe children (parent might re-push same child across notes)
  for (const node of root.values()) {
    node.children = [...new Map(node.children.map((c) => [c.path, c])).values()];
  }
  return [...root.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [trash, setTrash] = useState<NoteSummary[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<NoteSummary | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/notes");
    if (res.ok) {
      const data = await res.json();
      setNotes(data.notes);
    }
    const tres = await fetch("/api/trash");
    if (tres.ok) {
      const tdata = await tres.json();
      setTrash(tdata.notes);
    }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const onNav = () => setTimeout(load, 800);
    window.addEventListener("chibako:notes-changed", onNav);
    const onMenu = () => setMobileOpen((o) => !o);
    window.addEventListener("chibako:toggle-sidebar", onMenu);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("chibako:notes-changed", onNav);
      window.removeEventListener("chibako:toggle-sidebar", onMenu);
    };
  }, [load]);

  // close the mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const tree = useMemo(() => buildTree(notes), [notes]);
  const home = notes.find((n) => n.kind === "index");
  const pinned = useMemo(() => notes.filter((n) => n.is_pinned), [notes]);
  const recents = useMemo(
    () => [...notes].sort((a, b) => b.updated_at - a.updated_at).slice(0, 7),
    [notes]
  );

  const matches = useMemo(() => {
    if (!filter.trim()) return null;
    const q = filter.toLowerCase();
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.folder.toLowerCase().includes(q));
  }, [filter, notes]);

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function newNote() {
    router.push("/app/note/new");
  }

  async function restoreTrashed(id: string) {
    const res = await fetch(`/api/notes/${id}/restore`, { method: "POST" });
    if (res.ok) {
      load();
      const { note } = await res.json();
      if (note?.id) router.push(`/app/note/${note.id}`);
    }
  }

  async function purgeTrashed() {
    if (!purgeTarget) return;
    const res = await fetch(`/api/trash/${purgeTarget.id}`, { method: "DELETE" });
    setPurgeTarget(null);
    if (res.ok) load();
  }

  const isActive = (id: string) => pathname === `/app/note/${id}`;

  const renderBody = () => (
    <>
      <div className="flex items-center gap-2 px-3 pb-1 pt-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/14 text-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        </div>
        <span className="flex-1 text-sm font-semibold tracking-tight">Chibako</span>
        <button className="btn !px-1.5 !py-1" onClick={newNote} title="New note (Cmd/Ctrl+N)">
          <IconPlus size={15} />
        </button>
      </div>

      <div className="px-3 py-2">
        <input className="input !py-1.5 text-sm" placeholder="Filter titles…" aria-label="Filter note titles" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {home && (
          <Link href={`/app/note/${home.id}`} className={`tree-item mb-1 ${isActive(home.id) ? "active" : ""}`}>
            <IconHome size={14} />
            <span>{home.title}</span>
          </Link>
        )}

        {matches ? (
          <div className="mt-1">
            <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {matches.length} match{matches.length === 1 ? "" : "es"} (titles)
            </p>
            {matches.map((n) => (
              <NoteRow key={n.id} note={n} isActive={isActive(n.id)} />
            ))}
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="mt-1">
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Pinned
                </p>
                {pinned.map((n) => (
                  <NoteRow key={n.id} note={n} isActive={isActive(n.id)} />
                ))}
              </div>
            )}
            {recents.length > 0 && (
              <div className="mt-1">
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Recent
                </p>
                {recents.map((n) => (
                  <NoteRow key={n.id} note={n} isActive={isActive(n.id)} sub={relTime(n.updated_at)} />
                ))}
              </div>
            )}
            {/* root-level notes */}
            {tree
              .filter((n) => n.path === "")
              .map((n) =>
                n.notes.map((note) => (
                  <NoteRow key={note.id} note={note} isActive={isActive(note.id)} />
                ))
              )}
            {tree
              .filter((n) => n.path !== "")
              .sort((a, b) => a.path.localeCompare(b.path))
              .map((node) => {
                const open = !collapsed.has(node.path);
                const all = [node, ...flatten(node.children)];
                const count = all.reduce((acc, x) => acc + x.notes.length, 0);
                return (
                  <div key={node.path}>
                    <button className="tree-item w-full" onClick={() => toggleFolder(node.path)}>
                      <IconChevron size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
                      <IconFolder size={13} />
                      <span className="flex-1 truncate text-left">{node.name}</span>
                      <span className="text-[10px] text-muted-foreground">{count}</span>
                    </button>
                    {open && (
                      <div className="ml-3 border-l border-border pl-1">
                        {node.notes.map((note) => (
                          <NoteRow key={note.id} note={note} isActive={isActive(note.id)} />
                        ))}
                        {node.children.map((c) => <RecursiveFolder key={c.path} node={c} collapsed={collapsed} toggleFolder={toggleFolder} isActive={isActive} />)}
                      </div>
                    )}
                  </div>
                );
              })}
          </>
        )}
        {trash.length > 0 && !matches && (
          <div className="mt-2">
            <button className="tree-item w-full" onClick={() => toggleFolder("__trash")}>
              <IconChevron size={12} className={`transition-transform ${collapsed.has("__trash") ? "" : "rotate-90"}`} />
              <IconTrash size={13} />
              <span className="flex-1 truncate text-left">Trash</span>
              <span className="text-[10px] text-muted-foreground">{trash.length}</span>
            </button>
            {!collapsed.has("__trash") && (
              <div className="ml-3 border-l border-border pl-1">
                {trash.map((n) => (
                  <div key={n.id} className="tree-item group">
                    <IconFile size={13} />
                    <span className="flex-1 truncate">{n.title}</span>
                    <button
                      className="hidden rounded px-1 text-[11px] text-primary hover:underline group-hover:inline"
                      onClick={() => restoreTrashed(n.id)}
                      title="Restore"
                    >
                      Restore
                    </button>
                    <button
                      className="hidden rounded px-1 text-muted-foreground hover:text-red-500 group-hover:inline"
                      onClick={() => setPurgeTarget(n)}
                      title="Delete forever"
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      <div className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
        {notes.length} note{notes.length === 1 ? "" : "s"} · SQLite vault
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        {renderBody()}
      </aside>
      <div className="md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 border-border bg-sidebar p-0">
            <SheetTitle className="sr-only">Notebooks</SheetTitle>
            <div className="flex h-full flex-col">{renderBody()}</div>
          </SheetContent>
        </Sheet>
      </div>
      <ConfirmDialog
        open={purgeTarget !== null}
        onOpenChange={(o) => !o && setPurgeTarget(null)}
        title={`Delete "${purgeTarget?.title}" forever?`}
        description="This cannot be undone. The note, its links, and its search index rows are removed permanently."
        confirmLabel="Delete forever"
        destructive
        onConfirm={purgeTrashed}
      />
    </>
  );
}

function flatten(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

export function relTime(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export const KIND_DOT: Record<string, string> = {
  note: "var(--primary)",
  wiki: "#10b981",
  index: "#f59e0b",
};

export function NoteRow({ note, isActive, sub }: { note: NoteSummary; isActive: boolean; sub?: string }) {
  return (
    <Link
      href={`/app/note/${note.id}`}
      title={`${note.title}${note.folder ? ` · ${note.folder}` : ""} · edited ${relTime(note.updated_at)}`}
      className={`tree-item ${isActive ? "active" : ""}`}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: KIND_DOT[note.kind] ?? KIND_DOT.note }}
      />
      <IconFile size={13} />
      <span className="min-w-0 flex-1 truncate">{note.title}</span>
      {sub && <span className="shrink-0 text-[10px] text-muted-foreground">{sub}</span>}
    </Link>
  );
}

function RecursiveFolder({
  node,
  collapsed,
  toggleFolder,
  isActive,
}: {
  node: FolderNode;
  collapsed: Set<string>;
  toggleFolder: (p: string) => void;
  isActive: (id: string) => boolean;
}) {
  const open = !collapsed.has(node.path);
  const count = [node, ...flatten(node.children)].reduce((acc, x) => acc + x.notes.length, 0);
  return (
    <div>
      <button className="tree-item w-full" onClick={() => toggleFolder(node.path)}>
        <IconChevron size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        <IconFolder size={13} />
        <span className="flex-1 truncate text-left">{node.name}</span>
        <span className="text-[10px] text-muted-foreground">{count}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-border pl-1">
          {node.notes.map((note) => (
            <NoteRow key={note.id} note={note} isActive={isActive(note.id)} />
          ))}
          {node.children.map((c) => <RecursiveFolder key={c.path} node={c} collapsed={collapsed} toggleFolder={toggleFolder} isActive={isActive} />)}
        </div>
      )}
    </div>
  );
}