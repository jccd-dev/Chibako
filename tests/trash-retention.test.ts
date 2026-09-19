import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("listing Trash never performs permanent deletion", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-trash-retention-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const notes = await import("../src/lib/notes");
  const { getDb } = await import("../src/lib/db");
  try {
    const note = notes.createNote({ title: "Expired trash", content: "old" });
    notes.deleteNote(note.id);
    getDb().prepare("UPDATE notes SET deleted_at = 1 WHERE id = ?").run(note.id);

    assert.equal(notes.listTrash().length, 1);
    assert.ok(notes.getNote(note.id, true));
    assert.equal(notes.purgeExpiredTrash(), 1);
    assert.equal(notes.getNote(note.id, true), null);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
