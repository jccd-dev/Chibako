import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseSearchQuery } from "../src/features/notes/search-query";

test("search query parser reads note: and folder: qualifiers", () => {
  assert.deepEqual(parseSearchQuery("rocket launch"), { text: "rocket launch", titleOnly: false });
  assert.deepEqual(parseSearchQuery("folder:Guides x"), { text: "x", folder: "Guides", titleOnly: false });
  assert.deepEqual(parseSearchQuery('folder:"Work/Big Plans" note:"road map" draft'), { text: "road map draft", folder: "Work/Big Plans", titleOnly: true });
  assert.deepEqual(parseSearchQuery("NOTE:alpha FOLDER:/Guides/"), { text: "alpha", folder: "Guides", titleOnly: true });
});

test("search query parser keeps unknown and empty qualifiers as plain text", () => {
  assert.deepEqual(parseSearchQuery("db:migrate-tenant"), { text: "db:migrate-tenant", titleOnly: false });
  assert.deepEqual(parseSearchQuery("folder: x"), { text: "folder: x", titleOnly: false });
  assert.deepEqual(parseSearchQuery('note:"" y'), { text: 'note:"" y', titleOnly: false });
  assert.deepEqual(parseSearchQuery("   "), { text: "", titleOnly: false });
});

test("searchNotes scopes to a folder inside the query and matches titles only on request", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-search-scope-test-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = "";
  process.env.CHIBAKO_EMBEDDING_API_KEY = "";
  const { createNote, searchNotes } = await import("../src/lib/notes");
  const { getDb } = await import("../src/lib/db");
  try {
    // 60 strong matches outside the folder would fill a post-query 50-row limit.
    for (let i = 0; i < 60; i++) createNote({ title: `Outside ${i}`, folder: "Elsewhere", content: "zebra zebra zebra zebra" });
    const inside = createNote({ title: "Inside", folder: "Guides", content: "a zebra" });
    const nested = createNote({ title: "Nested", folder: "Guides/Deep", content: "a zebra" });
    createNote({ title: "Lookalike", folder: "Guides2", content: "a zebra" });
    assert.deepEqual(searchNotes("zebra", [], { folder: "Guides" }).map((r) => r.id).sort(), [inside.id, nested.id].sort());
    assert.deepEqual(searchNotes("zebra", [], { folder: "guides" }).map((r) => r.id).sort(), [inside.id, nested.id].sort(), "folder scope ignores case");

    const titled = createNote({ title: "Quokka facts", content: "small marsupial" });
    createNote({ title: "Animals", content: "the quokka smiles" });
    assert.deepEqual(searchNotes("quokka", [], { titleOnly: true }).map((r) => r.id), [titled.id]);
    assert.equal(searchNotes("quokka").length, 2);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
