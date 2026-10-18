import { getDb } from "../../lib/db";
import { getNote } from "../../lib/notes";
import { FinanceError } from "./types";

export function readActivityNoteIds(id: string): string[] {
  return (getDb().prepare("SELECT note_id FROM finance_note_links WHERE activity_id = ? ORDER BY note_id").all(id) as { note_id: string }[]).map(row => row.note_id);
}

// Call only within a finance mutation, after authorizing Note access.
export function replaceActivityNoteLinks(id: string, noteIds: string[]): void {
  for (const noteId of noteIds) {
    if (!getNote(noteId)) throw new FinanceError("Choose an existing Note outside Trash", 400, "invalid_note");
  }
  const db = getDb();
  db.prepare("DELETE FROM finance_note_links WHERE activity_id = ?").run(id);
  const insert = db.prepare("INSERT INTO finance_note_links (activity_id, note_id) VALUES (?, ?)");
  for (const noteId of noteIds) insert.run(id, noteId);
}
