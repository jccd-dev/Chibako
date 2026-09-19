import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("remote recall does not refresh stale note embeddings", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-remote-recall-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  process.env.CHIBAKO_EMBEDDING_PROVIDER = "fake";
  const notes = await import("../src/lib/notes");
  const index = await import("../src/lib/embedding-index");
  const { recall } = await import("../src/lib/recall");
  const { getDb } = await import("../src/lib/db");
  try {
    const note = notes.createNote({ title: "Remote recall", content: "original searchable text" });
    await index.reindexEmbeddings();
    notes.updateNote(note.id, { content: "updated searchable text" });
    assert.equal(index.embeddingStatus().stale, 1);

    await recall({ query: "updated", refreshStale: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(index.embeddingStatus().stale, 1);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
    delete process.env.CHIBAKO_EMBEDDING_PROVIDER;
  }
});
