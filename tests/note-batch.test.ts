import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("Note organization batches commit together or roll back their indexes", async t => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-note-batch-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const { getDb } = await import("../src/lib/db");
  const notes = await import("../src/lib/notes");
  const { organizeNotes, noteBatchInput } = await import("../src/features/organization/note-batch");
  const { addBookmark } = await import("../src/lib/bookmarks");
  const { putEmbedding } = await import("../src/lib/embedding-store");
  const db = getDb();
  const snapshot = () => Object.fromEntries(
    ["notes", "folders", "links", "notes_fts", "bookmarks", "note_embeddings"].map(table => [
      table, db.prepare(`SELECT * FROM ${table} ORDER BY ${table === "links" ? "1, 2" : "1"}`).all(),
    ]),
  );
  try {
    await t.test("move collisions and failed Wikilink rewrites leave the entire Vault unchanged", () => {
      const first = notes.createNote({ title: "Conflict", folder: "Source A", content: "searchable" });
      const second = notes.createNote({ title: "Conflict", folder: "Source B" });
      notes.createNote({ title: "References", content: "[[Source A/Conflict|alias]] [[Source B/Conflict]]" });
      const before = snapshot();
      assert.throws(() => organizeNotes({ action: "move", ids: [first.id, second.id], folder: "New/Destination" }), /already exists/);
      assert.deepEqual(snapshot(), before);
      db.exec("CREATE TEMP TRIGGER reject_rewrite BEFORE UPDATE OF content ON notes WHEN OLD.title = 'References' BEGIN SELECT RAISE(ABORT, 'rewrite blocked'); END");
      try {
        assert.throws(() => organizeNotes({ action: "move", ids: [first.id], folder: "New/Destination" }), /rewrite blocked/);
        assert.deepEqual(snapshot(), before);
      } finally {
        db.exec("DROP TRIGGER reject_rewrite");
      }
    });

    await t.test("missing or wrong-state Notes reject the entire selection", () => {
      const active = notes.createNote({ title: "Active" });
      const trashed = notes.createNote({ title: "Trashed" });
      notes.deleteNote(trashed.id);
      const before = snapshot();
      for (const action of ["delete", "restore", "purge"] as const) {
        const first = action === "delete" ? active : trashed;
        assert.throws(() => organizeNotes({ action, ids: [first.id, "missing"] }), /no longer available/);
        assert.throws(() => organizeNotes({ action, ids: [active.id, trashed.id] }), /no longer available/);
      }
      assert.throws(() => organizeNotes({ action: "move", ids: [active.id, trashed.id], folder: "Elsewhere" }), /no longer available/);
      assert.deepEqual(snapshot(), before);
    });

    await t.test("a failed purge restores Notes, bookmarks, links, FTS, and Embeddings", () => {
      const first = notes.createNote({ title: "Purge first", content: "purge searchable" });
      const second = notes.createNote({ title: "Purge blocked" });
      notes.createNote({ title: "Purge references", content: "[[Purge first]]" });
      addBookmark({ note_id: first.id });
      putEmbedding({ note_id: first.id, model: "test", vector: [1], content_hash: "test", dim: 1, input_version: 1 });
      organizeNotes({ action: "delete", ids: [first.id, second.id] });
      const before = snapshot();
      db.exec("CREATE TEMP TRIGGER reject_purge BEFORE DELETE ON notes WHEN OLD.title = 'Purge blocked' BEGIN SELECT RAISE(ABORT, 'purge blocked'); END");
      try {
        assert.throws(() => organizeNotes({ action: "purge", ids: [first.id, second.id] }), /purge blocked/);
        assert.deepEqual(snapshot(), before);
      } finally {
        db.exec("DROP TRIGGER reject_purge");
      }
      organizeNotes({ action: "purge", ids: [first.id, second.id] });
      assert.equal(notes.getNote(first.id, true), null);
      assert.equal(notes.getNote(second.id, true), null);
      for (const table of ["notes_fts", "bookmarks", "note_embeddings"]) {
        const column = table === "notes_fts" ? "id" : "note_id";
        assert.deepEqual(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(first.id), { count: 0 });
      }
    });

    await t.test("successful moves preserve path Wikilinks and delete/restore transitions", () => {
      const first = notes.createNote({ title: "Move A", folder: "Old" });
      const second = notes.createNote({ title: "Move B", folder: "Old" });
      const source = notes.createNote({ title: "Move references", content: "[[Old/Move A|A]] [[Old/Move B]]" });
      const stationary = notes.createNote({ title: "Already there", folder: "Fresh/Nested" });
      db.prepare("UPDATE notes SET updated_at = 1 WHERE id = ?").run(stationary.id);
      const unchanged = notes.getNote(stationary.id);
      const ids = [first.id, second.id];
      organizeNotes({ action: "move", ids: [...ids, stationary.id], folder: "/Fresh/Nested/" });
      assert.deepEqual(notes.getNote(stationary.id), unchanged);
      assert(ids.every(id => notes.getNote(id)?.folder === "Fresh/Nested"));
      assert.equal(notes.getNote(source.id)?.content, "[[Fresh/Nested/Move A|A]] [[Fresh/Nested/Move B]]");
      assert.deepEqual(db.prepare("SELECT COUNT(*) AS count FROM notes_fts WHERE folder = ?").get("Fresh/Nested"), { count: 3 });
      organizeNotes({ action: "delete", ids });
      assert(ids.every(id => notes.getNote(id) === null));
      organizeNotes({ action: "restore", ids });
      assert(ids.every(id => notes.getNote(id)?.folder === "Fresh/Nested"));
    });

    await t.test("batch input rejects empty, duplicated, and malformed selections", () => {
      for (const input of [
        { action: "delete", ids: [] }, { action: "delete", ids: ["a", "a"] },
        { action: "move", ids: ["a"] }, { action: "unknown", ids: ["a"] },
        { action: "purge", ids: [1] },
      ]) assert.equal(noteBatchInput.safeParse(input).success, false);
    });
  } finally {
    db.close();
    rmSync(vault, { recursive: true, force: true });
  }
});
