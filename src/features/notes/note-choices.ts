import { getDb } from "../../lib/db";

export function listNoteChoices(query: { q: string; limit: number; offset: number }) {
  const needle = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
  const db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare("SELECT COUNT(*) AS total FROM notes WHERE deleted_at IS NULL AND title LIKE ? ESCAPE '\\'").get(needle) as { total: number };
    const notes = db.prepare("SELECT id, title FROM notes WHERE deleted_at IS NULL AND title LIKE ? ESCAPE '\\' ORDER BY title COLLATE NOCASE, id LIMIT ? OFFSET ?")
      .all(needle, query.limit, query.offset) as { id: string; title: string }[];
    return { notes, total, limit: query.limit, offset: query.offset };
  })();
}
