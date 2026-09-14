import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("organization preserves active and trashed Note identity, FTS, and path links", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-organization-characterization-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const notes = await import("../src/lib/notes");
  const folders = await import("../src/features/organization/folders");
  const organization = await import("../src/features/organization/organization");
  const { getDb } = await import("../src/lib/db");
  try {
    folders.createFolder("Projects/Work/Empty");
    const target = notes.createNote({ title: "Plan", folder: "Projects/Work", content: "launch checklist" });
    const trashed = notes.createNote({ title: "Old plan", folder: "Projects/Work/Trash", content: "old" });
    notes.deleteNote(trashed.id);
    const source = notes.createNote({ title: "Links", content: "[[Plan|the plan]] [[Projects/Work/Plan]]" });

    organization.moveFolder("Projects", "Archive");

    assert.equal(notes.getNote(target.id)?.folder, "Archive/Work");
    assert.equal(notes.getNote(trashed.id, true)?.folder, "Archive/Work/Trash");
    assert.equal(notes.getNote(source.id)?.content, "[[Plan|the plan]] [[Archive/Work/Plan]]");
    assert.equal(notes.getNote(source.id)?.id, source.id);
    assert(notes.searchNotes("Archive/Work").some((note) => note.id === target.id));
    assert.equal((getDb().prepare("SELECT folder FROM notes_fts WHERE id = ?").get(target.id) as { folder: string }).folder, "Archive/Work");
    assert.deepEqual(folders.folderTree(), ["Archive", "Archive/Work", "Archive/Work/Empty", "Archive/Work/Trash"]);

    assert.throws(() => organization.moveFolder("Archive", "Archive/Child"), /itself/);
    assert.deepEqual(folders.folderTree(), ["Archive", "Archive/Work", "Archive/Work/Empty", "Archive/Work/Trash"]);

    const parent = organization.deleteFolder("Archive/Work");
    assert.equal(parent, "Archive");
    assert.equal(notes.getNote(target.id)?.folder, "Archive");
    assert.equal(notes.getNote(trashed.id, true)?.folder, "Archive/Trash");
    assert.deepEqual(folders.folderTree(), ["Archive", "Archive/Trash"]);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
