import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("duplicateNote copies content into a free title and applies the new dates", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-note-duplicate-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const { getDb } = await import("../src/lib/db");
  const notes = await import("../src/lib/notes");
  try {
    const source = notes.createNote({
      title: "Standup",
      folder: "Work",
      content: "Agenda [[Other]]",
      properties: { date: "2026-11-10", end_date: "2026-11-12", status: "todo" },
    });
    const copy = notes.duplicateNote(source.id, { date: "2026-11-17", end_date: null })!;
    assert.equal(copy.title, "Standup (copy)");
    assert.equal(copy.folder, "Work");
    assert.notEqual(copy.id, source.id);
    assert.deepEqual(copy.properties, { date: "2026-11-17", status: "todo" });
    assert.match(copy.content, /Agenda \[\[Other\]\]/);
    assert.equal(notes.getNote(source.id)!.properties.date, "2026-11-10");
    assert.ok(getDb().prepare("SELECT 1 FROM notes_fts WHERE id = ?").get(copy.id));

    assert.equal(notes.duplicateNote(source.id)!.title, "Standup (copy 2)");
    assert.equal(notes.duplicateNote("missing"), null);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
