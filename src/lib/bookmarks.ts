import { getDb, now, uid } from "./db";

// ---------- bookmarks ----------
//
// Pinned-but-richer: a bookmark is a note + custom display label + optional
// group + manual sort order. One bookmark per note (re-adding updates it).

export interface Bookmark {
  id: string;
  note_id: string;
  label: string;
  group_name: string;
  sort: number;
  created_at: number;
}

export interface BookmarkInput {
  note_id: string;
  label?: string;
  group_name?: string;
}

export class BookmarkError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const ROW_ORDER = `ORDER BY group_name, sort, created_at`;

export function listBookmarks(): Bookmark[] {
  return getDb().prepare(`SELECT * FROM bookmarks ${ROW_ORDER}`).all() as Bookmark[];
}

export function getBookmark(id: string): Bookmark | null {
  return (getDb().prepare(`SELECT * FROM bookmarks WHERE id = ?`).get(id) as Bookmark | undefined) ?? null;
}

export function getBookmarkForNote(noteId: string): Bookmark | null {
  return (getDb().prepare(`SELECT * FROM bookmarks WHERE note_id = ?`).get(noteId) as Bookmark | undefined) ?? null;
}

/** Add (or update, since a note has at most one bookmark) and return it. */
export function addBookmark(input: BookmarkInput): Bookmark {
  const noteId = input.note_id?.trim();
  if (!noteId) throw new BookmarkError("note_id is required");
  const note = getDb().prepare(`SELECT id FROM notes WHERE id = ? AND deleted_at IS NULL`).get(noteId);
  if (!note) throw new BookmarkError("Note not found.", 404);
  const label = input.label?.trim() ?? "";
  const groupName = normalizeGroup(input.group_name ?? "");
  const existing = getBookmarkForNote(noteId);
  if (existing) {
    getDb().prepare(`UPDATE bookmarks SET label = ?, group_name = ? WHERE id = ?`).run(label, groupName, existing.id);
    return getBookmark(existing.id)!;
  }
  const bookmark: Bookmark = { id: uid(), note_id: noteId, label, group_name: groupName, sort: nextSort(groupName), created_at: now() };
  getDb()
    .prepare(`INSERT INTO bookmarks (id, note_id, label, group_name, sort, created_at) VALUES (?,?,?,?,?,?)`)
    .run(bookmark.id, bookmark.note_id, bookmark.label, bookmark.group_name, bookmark.sort, bookmark.created_at);
  return bookmark;
}

export function updateBookmark(id: string, patch: { label?: string; group_name?: string }): Bookmark | null {
  const existing = getBookmark(id);
  if (!existing) return null;
  const label = patch.label !== undefined ? patch.label.trim() : existing.label;
  const groupName = patch.group_name !== undefined ? normalizeGroup(patch.group_name) : existing.group_name;
  const sort = groupName === existing.group_name ? existing.sort : nextSort(groupName);
  getDb().prepare(`UPDATE bookmarks SET label = ?, group_name = ?, sort = ? WHERE id = ?`).run(label, groupName, sort, id);
  return getBookmark(id);
}

export function removeBookmark(id: string): boolean {
  return getDb().prepare(`DELETE FROM bookmarks WHERE id = ?`).run(id).changes > 0;
}

/**
 * Apply a full display order: ids in list order get sort = index; a bookmark's
 * group may be changed inline (drag across groups adopts the target's group).
 */
export function reorderBookmarks(order: Array<{ id: string; group_name?: string }>): Bookmark[] {
  const db = getDb();
  return db.transaction(() => {
    const all = new Map(listBookmarks().map((b) => [b.id, b]));
    order.forEach((entry, index) => {
      const existing = all.get(entry.id);
      if (!existing) return;
      const groupName = entry.group_name !== undefined ? normalizeGroup(entry.group_name) : existing.group_name;
      db.prepare(`UPDATE bookmarks SET group_name = ?, sort = ? WHERE id = ?`).run(groupName, index, entry.id);
    });
    return listBookmarks();
  })();
}

/** Remove bookmarks pointing at a note (called when the note is purged). */
export function deleteBookmarksForNote(noteId: string): void {
  getDb().prepare(`DELETE FROM bookmarks WHERE note_id = ?`).run(noteId);
}

function nextSort(groupName: string): number {
  const row = getDb().prepare(`SELECT MAX(sort) AS max FROM bookmarks WHERE group_name = ?`).get(groupName) as { max: number | null };
  return (row.max ?? -1) + 1;
}

function normalizeGroup(group: string): string {
  const cleaned = group.trim().replace(/\s+/g, " ").slice(0, 120);
  if (/[\\\x00-\x1f]/.test(cleaned)) throw new BookmarkError("Invalid group name.");
  return cleaned;
}
