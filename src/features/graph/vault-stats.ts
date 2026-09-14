import { getDb } from "../../lib/db";
import { listNotes } from "../../lib/notes";

export interface VaultStats {
  notes: number;
  by_kind: Record<string, number>;
  folders: number;
  links: number;
  unresolved_links: number;
}

export function getVaultStats(): VaultStats {
  const notes = listNotes();
  const byKind: Record<string, number> = {};
  for (const note of notes) byKind[note.kind] = (byKind[note.kind] ?? 0) + 1;
  const folders = new Set(notes.map((note) => note.folder));
  const db = getDb();
  const all = db.prepare(`
    SELECT COUNT(*) AS count
    FROM links AS link
    JOIN notes AS source ON source.id = link.source_id AND source.deleted_at IS NULL
    LEFT JOIN notes AS target ON target.id = link.target_id
    WHERE link.target_id IS NULL OR (target.id IS NOT NULL AND target.deleted_at IS NULL)
  `).get() as { count: number };
  const unresolved = db.prepare(`
    SELECT COUNT(*) AS count
    FROM links AS link
    JOIN notes AS source ON source.id = link.source_id AND source.deleted_at IS NULL
    WHERE link.target_id IS NULL
  `).get() as { count: number };
  return {
    notes: notes.length,
    by_kind: byKind,
    folders: folders.size,
    links: all.count,
    unresolved_links: unresolved.count,
  };
}
