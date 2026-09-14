import { getDb, now } from "../../lib/db";
import { NoteInputError } from "../../lib/note-errors";
import { listReferenceNotes, rewriteWikilinkReferences, type ReferenceNote } from "../notes/rewrite-wikilink-references";
import { ensureFolder, folderTree, normalizeFolder } from "./folders";

/** Rename/move a whole folder subtree without merging or changing Note IDs. */
function relocateNotes(
  rows: readonly ReferenceNote[],
  inside: (path: string) => boolean,
  destination: (path: string) => string,
): Map<string, ReferenceNote> {
  const db = getDb();
  const changed = new Map<string, ReferenceNote>();
  for (const note of rows.filter((item) => inside(item.folder))) {
    const folder = destination(note.folder);
    db.prepare("UPDATE notes SET folder = ?, updated_at = ? WHERE id = ?").run(folder, now(), note.id);
    db.prepare("UPDATE notes_fts SET folder = ? WHERE id = ?").run(folder, note.id);
    changed.set(note.id, { id: note.id, title: note.title, folder });
  }
  return changed;
}

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
    const moved = paths.filter(inside).map((path) => [path, destination(path)] as const);
    const before = listReferenceNotes();
    // Include Trash so restoring a Note keeps it in the renamed folder.
    const rows = db.prepare("SELECT id, title, folder FROM notes").all() as ReferenceNote[];
    const changed = relocateNotes(rows, inside, destination);
    for (const [oldPath] of moved) db.prepare("DELETE FROM folders WHERE path = ?").run(oldPath);
    for (const [, nextPath] of moved) ensureFolder(nextPath);
    rewriteWikilinkReferences(before, changed);
    return to;
  })();
}

/**
 * Delete a folder and its subfolders. Notes are promoted to the parent folder
 * while retaining the remaining subtree hierarchy and their IDs.
 */
export function deleteFolder(from: string): string {
  from = normalizeFolder(from);
  if (!from) throw new NoteInputError("The vault root cannot be deleted.");
  const db = getDb();
  return db.transaction(() => {
    const paths = folderTree();
    if (!paths.includes(from)) throw new NoteInputError("Folder not found.", 404);
    const parent = parentOf(from);
    const inside = (path: string) => path === from || path.startsWith(`${from}/`);
    const destination = (path: string) => normalizeFolder(parent + path.slice(from.length));
    const removed = paths.filter(inside);
    const before = listReferenceNotes();
    // Include Trash so restoring a Note keeps it in the promoted folder.
    const rows = db.prepare("SELECT id, title, folder FROM notes").all() as ReferenceNote[];
    const changed = relocateNotes(rows, inside, destination);
    for (const oldPath of removed) db.prepare("DELETE FROM folders WHERE path = ?").run(oldPath);
    // Recreate only folders that received Notes; empty subfolders are removed.
    const used = new Set<string>();
    for (const note of rows.filter((item) => inside(item.folder))) used.add(destination(note.folder));
    for (const path of used) if (path) ensureFolder(path);
    rewriteWikilinkReferences(before, changed);
    return parent;
  })();
}

function parentOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}
