import { z } from "zod";
import { getDb, now } from "../../lib/db";
import { NoteInputError } from "../../lib/note-errors";
import { deleteNote, getNote, purgeNote, restoreNote } from "../../lib/notes";
import { listReferenceNotes, rewriteWikilinkReferences } from "../notes/rewrite-wikilink-references";
import { ensureFolder, normalizeFolder } from "./folders";

const ids = z.array(z.string().min(1)).min(1).refine(
  values => new Set(values).size === values.length,
  "Provide each Note only once.",
);

export const noteBatchInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), ids, folder: z.string().max(512) }).strict(),
  z.object({ action: z.literal("delete"), ids }).strict(),
  z.object({ action: z.literal("restore"), ids }).strict(),
  z.object({ action: z.literal("purge"), ids }).strict(),
]);

export type NoteBatchInput = z.infer<typeof noteBatchInput>;

export function organizeNotes(input: NoteBatchInput): void {
  const db = getDb();
  db.transaction(() => {
    const fromTrash = input.action === "restore" || input.action === "purge";
    const selected = input.ids.map(id => {
      const note = getNote(id, true);
      if (!note || (note.deleted_at !== null) !== fromTrash) {
        throw new NoteInputError("One or more selected Notes are no longer available. Refresh and try again.", 409);
      }
      return note;
    });
    if (input.action === "move") {
      const folder = normalizeFolder(input.folder);
      const moved = selected.filter(note => note.folder !== folder);
      if (!moved.length) return;
      const before = listReferenceNotes();
      const titles = new Set(before.filter(note => note.folder === folder).map(note => note.title));
      for (const note of moved) {
        if (titles.has(note.title)) throw new NoteInputError("A note with this name already exists in that folder.", 409);
        titles.add(note.title);
      }
      ensureFolder(folder);
      const move = db.prepare("UPDATE notes SET folder = ?, updated_at = ? WHERE id = ?");
      const moveFts = db.prepare("UPDATE notes_fts SET folder = ? WHERE id = ?");
      for (const note of moved) {
        move.run(folder, now(), note.id);
        moveFts.run(folder, note.id);
      }
      // Resolve every Wikilink against the original identities, then rebuild once.
      rewriteWikilinkReferences(before, new Map(moved.map(note => [note.id, { id: note.id, title: note.title, folder }])));
      return;
    }
    for (const id of input.ids) {
      switch (input.action) {
        case "delete": deleteNote(id); break;
        case "restore": restoreNote(id); break;
        case "purge": purgeNote(id); break;
      }
    }
  })();
}
