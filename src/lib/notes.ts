import { getDb, now, uid } from "./db";
import { extractWikiLinks, resolveWikiTarget, WIKILINK_RE } from "./markdown";

export type NoteKind = "note" | "wiki" | "index";

export interface Note {
  id: string;
  title: string;
  folder: string;
  content: string;
  kind: NoteKind;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  is_pinned: number;
}

export interface NoteSummary {
  id: string;
  title: string;
  folder: string;
  kind: NoteKind;
  created_at: number;
  updated_at: number;
  /** Soft-delete timestamp (trash). Null = visible. */
  deleted_at: number | null;
  is_pinned: number;
}

export interface NoteLink {
  source_id: string;
  source_title: string;
  target_title: string;
  target_id: string | null;
}

const SUM = `id, title, folder, kind, created_at, updated_at, deleted_at, is_pinned`;

export function listNotes(): NoteSummary[] {
  return getDb().prepare(`SELECT ${SUM} FROM notes WHERE deleted_at IS NULL ORDER BY folder, title`).all() as NoteSummary[];
}

/** Trashed notes, newest first. Lazily purges items older than 30 days. */
export function listTrash(): NoteSummary[] {
  const db = getDb();
  const stale = db
    .prepare(`SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
    .all(now() - 30 * 24 * 3600) as Array<{ id: string }>;
  for (const s of stale) purgeNote(s.id);
  return db.prepare(`SELECT ${SUM} FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all() as NoteSummary[];
}

export function getNote(id: string, includeDeleted = false): Note | null {
  const row = getDb().prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as Note | null;
  if (!row) return null;
  if (!includeDeleted && row.deleted_at) return null;
  return row;
}

export function getNoteByTitle(title: string): Note | null {
  return getDb()
    .prepare(`SELECT * FROM notes WHERE title = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1`)
    .get(title) as Note | null;
}

export function getNoteByPath(folder: string, title: string): Note | null {
  return getDb().prepare(`SELECT * FROM notes WHERE folder = ? AND title = ? AND deleted_at IS NULL LIMIT 1`).get(folder, title) as Note | null;
}

export function suggestTitle(content: string, fallback = "Untitled"): string {
  const m = content.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim().slice(0, 120);
  const first = content.split("\n").find((l) => l.trim().length > 0);
  if (first) return first.trim().replace(/[#*\-`>]/g, "").slice(0, 120).trim();
  return fallback;
}

export interface CreateNoteInput {
  title?: string;
  folder?: string;
  content?: string;
  kind?: NoteKind;
}

export function createNote(input: CreateNoteInput): Note {
  return getDb().transaction(() => createNoteRecord(input))();
}

function createNoteRecord(input: CreateNoteInput): Note {
  const db = getDb();
  const id = uid();
  const title = input.title?.trim() || suggestTitle(input.content ?? "") || "Untitled";
  const folder = normalizeFolder(input.folder ?? "");
  ensureFolder(folder);
  const kind = input.kind ?? "note";
  const ts = now();
  db.prepare(`INSERT INTO notes (id, title, folder, content, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`).run(
    id, title, folder, input.content ?? "", kind, ts, ts
  );
  db.prepare(`INSERT INTO notes_fts (id, title, content, folder) VALUES (?,?,?,?)`).run(id, title, input.content ?? "", folder);
  reindexLinks(id, input.content ?? "");
  resolveLinksForTitle(title, id);
  return getNote(id)!;
}

export interface UpdateNoteInput {
  title?: string;
  folder?: string;
  content?: string;
  kind?: NoteKind;
  is_pinned?: number;
}

export function updateNote(id: string, input: UpdateNoteInput): Note | null {
  return getDb().transaction(() => updateNoteRecord(id, input))();
}

function updateNoteRecord(id: string, input: UpdateNoteInput): Note | null {
  const db = getDb();
  const existing = getNote(id, true);
  if (!existing) return null;

  const title = input.title?.trim() || existing.title;
  const folder = normalizeFolder(input.folder ?? existing.folder);
  const renamed = title !== existing.title || folder !== existing.folder;
  if (renamed && listNotes().some(n => n.id !== id && n.folder === folder && n.title === title)) {
    throw new NoteInputError("A note with this name already exists in that folder.", 409);
  }
  const before = renamed ? listNotes() : [];
  ensureFolder(folder);
  const content = input.content ?? existing.content;
  const kind = input.kind ?? existing.kind;
  const pinned = input.is_pinned ?? existing.is_pinned;
  const ts = now();

  db.prepare(`UPDATE notes SET title = ?, folder = ?, content = ?, kind = ?, is_pinned = ?, updated_at = ? WHERE id = ?`).run(
    title, folder, content, kind, pinned ? 1 : 0, ts, id
  );
  db.prepare(`DELETE FROM notes_fts WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO notes_fts (id, title, content, folder) VALUES (?,?,?,?)`).run(id, title, content, folder);

  reindexLinks(id, content);
  if (renamed) rewriteReferences(before, new Map([[id, { title, folder }]]));
  resolveLinksForTitle(title, id);
  return getNote(id);
}

export function deleteNote(id: string): boolean {
  const db = getDb();
  const existing = getNote(id, true);
  if (!existing || existing.deleted_at) return false;
  db.prepare(`UPDATE notes SET deleted_at = ? WHERE id = ?`).run(now(), id);
  return true;
}

export function restoreNote(id: string): Note | null {
  const db = getDb();
  const existing = getNote(id, true);
  if (!existing || !existing.deleted_at) return null;
  db.prepare(`UPDATE notes SET deleted_at = NULL WHERE id = ?`).run(id);
  return getNote(id);
}

/** Permanent delete (trash purge). Removes note + links + FTS rows. */
export function purgeNote(id: string): boolean {
  const db = getDb();
  const existing = getNote(id, true);
  if (!existing) return false;
  db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM links WHERE source_id = ?`).run(id);
  db.prepare(`DELETE FROM links WHERE target_id = ?`).run(id);
  db.prepare(`DELETE FROM notes_fts WHERE id = ?`).run(id);
  return true;
}

/** Rebuild a note's outbound [[links]] table rows. */
export function reindexLinks(id: string, content: string): void {
  const db = getDb();
  const note = getNote(id);
  if (!note) return;
  const all = listNotes();
  const resolver = (t: string) => resolveWikiTarget(t, all);
  db.prepare(`DELETE FROM links WHERE source_id = ?`).run(id);
  const insert = db.prepare(`INSERT OR REPLACE INTO links (source_id, target_title, target_id) VALUES (?,?,?)`);
  for (const target of extractWikiLinks(content)) {
    const resolved = resolver(target);
    insert.run(id, target, resolved?.id ?? null);
  }
}

/** Preserve resolved title/path links and aliases when an item is organized. */
function rewriteReferences(before: NoteSummary[], changed: Map<string, { title: string; folder: string }>): void {
  const db = getDb();
  for (const summary of listNotes()) {
    const note = getNote(summary.id)!;
    const content = note.content.replace(WIKILINK_RE, (token, inner: string) => {
      const [raw, ...alias] = inner.split("|");
      const target = raw.trim();
      const resolved = resolveWikiTarget(target, before);
      const next = resolved && changed.get(resolved.id);
      if (!next) return token;
      const old = before.find(n => n.id === resolved.id)!;
      const pathLink = target === `${old.folder}/${old.title}` && target !== old.title;
      const replacement = pathLink && next.folder ? `${next.folder}/${next.title}` : next.title;
      return `[[${replacement}${alias.length ? `|${alias.join("|")}` : ""}]]`;
    });
    if (content !== note.content) {
      db.prepare("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?").run(content, now(), note.id);
      db.prepare("UPDATE notes_fts SET content = ? WHERE id = ?").run(content, note.id);
    }
  }
  reindexAll();
}

/**
 * Re-point any [[links]] that reference this note's title to its id.
 * Runs after a note is created or renamed so links made to not-yet-existing
 * notes resolve automatically (Obsidian-style).
 */
function resolveLinksForTitle(title: string, id: string): void {
  const db = getDb();
  const note = getNote(id);
  const rows = db.prepare("SELECT DISTINCT source_id FROM links WHERE target_title = ? COLLATE NOCASE OR target_title = ? OR target_id = ?")
    .all(title, `${note?.folder ?? ""}/${title}`, id) as Array<{ source_id: string }>;
  for (const { source_id } of rows) {
    const source = getNote(source_id);
    if (source) reindexLinks(source.id, source.content);
  }
}

/** Rebuild the whole link index (used after bulk import / restore). */
export function reindexAll(): void {
  const db = getDb();
  db.prepare(`DELETE FROM links`).run();
  for (const n of listNotes()) {
    const note = getNote(n.id);
    if (note) reindexLinks(note.id, note.content);
  }
}

/** Notes that link TO the given title (case-insensitive). */
export function getBacklinks(title: string): Array<{ id: string; title: string; folder: string; snippet: string }> {
  const db = getDb();
  const rows = db
    .prepare(`SELECT source_id, target_title FROM links WHERE target_title = ? COLLATE NOCASE`)
    .all(title) as Array<{ source_id: string; target_title: string }>;
  return rows
    .map((r) => {
      const n = getNote(r.source_id);
      if (!n) return null;
      return { id: n.id, title: n.title, folder: n.folder, snippet: snippetAround(n.content, r.target_title) };
    })
    .filter(Boolean) as Array<{ id: string; title: string; folder: string; snippet: string }>;
}

/** Outbound [[links]] of a note, with resolved titles. */
export function getOutlinks(id: string): NoteLink[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM links WHERE source_id = ?`).all(id) as NoteLink[];
}

function snippetAround(content: string, needle: string, radius = 80): string {
  const idx = content.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return content.slice(0, radius);
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + needle.length + radius);
  return `${start > 0 ? "…" : ""}${content.slice(start, end).replace(/\s+/g, " ").trim()}${end < content.length ? "…" : ""}`;
}

export interface SearchResult extends NoteSummary {
  snippet: string;
  score: number;
}

export function searchNotes(query: string): SearchResult[] {
  if (!query.trim()) return [];
  const db = getDb();
  const clean = query.trim().replace(/[^A-Za-z0-9_\-\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af ]/g, " ").slice(0, 60);
  if (!clean) return [];
  const q = clean.split(/\s+/).map((t) => `${t}*`).join(" AND ");
  const rows = db
    .prepare(`
      SELECT id, bm25(notes_fts, 0.0, 2.0, 1.0, 0.5) AS score, snippet(notes_fts, 2, '<mark>', '</mark>', '…', 14) AS snippet
      FROM notes_fts
      WHERE notes_fts MATCH ?
      ORDER BY score LIMIT 50
    `)
    .all(q) as Array<{ id: string; score: number; snippet: string }>;
  const byId = new Map<string, NoteSummary>(listNotes().map((n) => [n.id, n]));
  return rows
    .map((r) => {
      const summary = byId.get(r.id);
      if (!summary) return null;
      return { ...summary, snippet: r.snippet, score: r.score };
    })
    .filter(Boolean) as SearchResult[];
}

/** Notes that mention this note's title in plain text without a [[wikilink]]. */
export interface UnlinkedMention {
  id: string;
  title: string;
  folder: string;
  snippet: string;
}

export function unlinkedMentions(id: string): UnlinkedMention[] {
  const db = getDb();
  const note = getNote(id, true);
  if (!note || !note.title.trim()) return [];
  const title = note.title.trim();
  const out: UnlinkedMention[] = [];
  for (const n of listNotes()) {
    if (n.id === id) continue;
    const full = getNote(n.id);
    if (!full) continue;
    if (full.content.toLowerCase().indexOf(title.toLowerCase()) === -1) continue;
    const linked = db
      .prepare(`SELECT 1 AS x FROM links WHERE source_id = ? AND target_title = ? COLLATE NOCASE`)
      .get(n.id, title) as { x: number } | undefined;
    if (linked) continue;
    out.push({ id: n.id, title: n.title, folder: n.folder, snippet: snippetAround(full.content, title) });
    if (out.length >= 20) break;
  }
  return out;
}

/** Replace the first plain-text mention of `title` in the source note with a [[wikilink]]. */
export function linkMention(sourceId: string, title: string): boolean {
  const src = getNote(sourceId);
  if (!src || !title.trim()) return false;
  const t = title.trim();
  const idx = src.content.toLowerCase().indexOf(t.toLowerCase());
  if (idx === -1) return false;
  // skip occurrences already inside a [[...]] span
  const open = src.content.lastIndexOf("[[", idx);
  const close = src.content.indexOf("]]", idx);
  if (open !== -1 && close !== -1 && open < idx && idx + t.length <= close) return false;
  updateNote(sourceId, { content: `${src.content.slice(0, idx)}[[${t}]]${src.content.slice(idx + t.length)}` });
  return true;
}

export class NoteInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function normalizeFolder(path: string): string {
  const normalized = path.trim().replace(/^\/+|\/+$/g, "");
  if (normalized.length > 512 || /[\\\x00-\x1f]/.test(normalized) ||
      (normalized && normalized.split("/").some(p => !p.trim() || p === "." || p === ".."))) {
    throw new NoteInputError("Invalid folder path.");
  }
  return normalized;
}

function ensureFolder(path: string): void {
  const insert = getDb().prepare("INSERT OR IGNORE INTO folders (path) VALUES (?)");
  const parts = path.split("/").filter(Boolean);
  for (let i = 1; i <= parts.length; i++) insert.run(parts.slice(0, i).join("/"));
}

export function folderTree(): string[] {
  return (getDb().prepare("SELECT path FROM folders ORDER BY path").all() as Array<{ path: string }>).map(r => r.path);
}

export function createFolder(path: string): string {
  path = normalizeFolder(path);
  if (!path) throw new NoteInputError("Enter a folder name.");
  return getDb().transaction(() => {
    if (folderTree().includes(path)) throw new NoteInputError("Folder already exists.", 409);
    ensureFolder(path);
    return path;
  })();
}

/** Rename/move a whole subtree without merging or changing note identities. */
export function moveFolder(from: string, to: string): string {
  from = normalizeFolder(from);
  to = normalizeFolder(to);
  if (!from || !to) throw new NoteInputError("The vault root cannot be renamed or moved.");
  if (to.startsWith(`${from}/`)) throw new NoteInputError("Cannot move a folder inside itself.");
  const db = getDb();
  return db.transaction(() => {
    const paths = folderTree();
    if (!paths.includes(from)) throw new NoteInputError("Folder not found.", 404);
    if (from === to) return to;
    if (paths.includes(to)) throw new NoteInputError("Destination folder already exists.", 409);
    const inside = (path: string) => path === from || path.startsWith(`${from}/`);
    const destination = (path: string) => normalizeFolder(to + path.slice(from.length));
    const moved = paths.filter(inside).map(path => [path, destination(path)] as const);
    const before = listNotes();
    const changed = new Map<string, { title: string; folder: string }>();
    // Include trash so restoring a note keeps it in the renamed folder.
    const rows = db.prepare("SELECT id, title, folder FROM notes").all() as Array<{ id: string; title: string; folder: string }>;
    for (const note of rows.filter(n => inside(n.folder))) {
      const folder = destination(note.folder);
      db.prepare("UPDATE notes SET folder = ?, updated_at = ? WHERE id = ?").run(folder, now(), note.id);
      db.prepare("UPDATE notes_fts SET folder = ? WHERE id = ?").run(folder, note.id);
      changed.set(note.id, { title: note.title, folder });
    }
    for (const [old] of moved) db.prepare("DELETE FROM folders WHERE path = ?").run(old);
    for (const [, next] of moved) ensureFolder(next);
    rewriteReferences(before, changed);
    return to;
  })();
}

/** All nodes + edges for the graph view. */
export function graphData(): { nodes: NoteSummary[]; links: Array<{ source: string; target: string }> } {
  const db = getDb();
  const nodes = listNotes();
  const ids = new Set(nodes.map((n) => n.id));
  const links = (db
    .prepare(`SELECT source_id, target_id FROM links WHERE target_id IS NOT NULL`)
    .all() as Array<{ source_id: string; target_id: string }>)
    .filter((l) => ids.has(l.source_id) && ids.has(l.target_id))
    .map((l) => ({ source: l.source_id, target: l.target_id }));
  return { nodes, links };
}

/** Create the Home index note on first boot if none exists. */
export function ensureIndexNote(): void {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM notes WHERE kind = 'index' LIMIT 1`).get();
  if (existing) return;
  createNote({
    kind: "index",
    title: "Home",
    folder: "",
    content: [
      "# Home",
      "",
      "Welcome to **Chibako** — your self-hosted second brain.",
      "",
      "## Getting started",
      "- Press `Cmd/Ctrl + N` to create a note",
      "- Link notes together with `[[wikilinks]]` like `[[Home]]`",
      "- Use the graph view (top bar) to see connections",
      "- Read `AGENTS.md` (in settings) to teach your AI agent how to use this vault",
      "",
      "## Starting points",
      "- [[Obsidian-style linking]]",
      "- [[Setup & deployment]]",
    ].join("\n"),
  });
  createNote({
    kind: "note",
    title: "Obsidian-style linking",
    folder: "Guides",
    content: [
      "# Obsidian-style linking",
      "",
      "Notes connect to each other using **wikilinks**:",
      "",
      "- `[[Other Note]]` — link to a note by title",
      "- `[[Other Note|display text]]` — link with custom text",
      "- [[Home]] shows backlinks automatically in the right panel",
      "",
      "Links work even before the target exists — the link shows as a placeholder until you create the note.",
    ].join("\n"),
  });
  createNote({
    kind: "note",
    title: "Setup & deployment",
    folder: "Guides",
    content: [
      "# Setup & deployment",
      "",
      "Chibako is a single Next.js app with a SQLite file. It deploys with Docker Compose:",
      "",
      "1. `docker compose up -d`",
      "2. Open `https://your-domain`, run the one-time setup",
      "3. Create an agent API key in **Settings → API Keys**",
      "",
      "Point your AI agent at the MCP server (see `AGENTS.md`) to read and write notes directly.",
    ].join("\n"),
  });
}

/** Strip markdown for plaintext agent reads (keeps tokens low). */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(WIKILINK_RE, (_m, inner) => {
      const [target] = inner.split("|");
      return `[[${target.trim()}]]`;
    })
    .replace(/```[\s\S]*?```/g, (c) => c)
    .replace(/[#>*`~_-]{1,}/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "image: $2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}