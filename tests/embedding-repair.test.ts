import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb } from "../src/lib/db";
import * as index from "../src/lib/embedding-index";
import * as repair from "../src/lib/embedding-repair";
import * as notes from "../src/lib/notes";
import { recall } from "../src/lib/recall";

const vault = mkdtempSync(join(tmpdir(), "chibako-embedding-repair-"));
process.env.CHIBAKO_DATA_DIR = vault;
process.env.CHIBAKO_EMBEDDING_PROVIDER = "fake";
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

const runner = globalThis as typeof globalThis & { embeddingRepairTimer?: ReturnType<typeof setInterval> };
function stopTimer() {
  clearInterval(runner.embeddingRepairTimer);
  delete runner.embeddingRepairTimer;
}

test("a repair run embeds at most one bounded batch per pass and later passes finish the rest", async () => {
  for (const n of [1, 2, 3, 4, 5]) notes.createNote({ title: `Repair ${n}`, content: `repair text ${n}` });
  assert.equal(index.embeddingStatus().stale, 5);
  assert.equal((await repair.runEmbeddingRepair({ batch: 2, passes: 1 })).indexed, 2);
  assert.equal(index.embeddingStatus().stale, 3);
  await repair.runEmbeddingRepair({ batch: 2, passes: 5 });
  assert.equal(index.embeddingStatus().stale, 0);
});

test("a started timer finds stale Notes again after a restart and repairs them", async (t) => {
  const note = notes.createNote({ title: "Restart", content: "before restart" });
  await index.reindexEmbeddings();
  notes.updateNote(note.id, { content: "after restart" });
  assert.equal(index.embeddingStatus().stale, 1);
  t.after(stopTimer);
  repair.startEmbeddingRepair(); // a fresh process has no in-memory dirty set; staleness comes from hashes
  for (let i = 0; i < 50 && index.embeddingStatus().stale > 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(index.embeddingStatus().stale, 0);
  const timer = runner.embeddingRepairTimer;
  repair.startEmbeddingRepair();
  assert.equal(runner.embeddingRepairTimer, timer, "second start is a no-op");
});

test("provider failure never throws, never blocks Note writes, and Recall keeps answering", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    CHIBAKO_EMBEDDING_PROVIDER: "openai",
    CHIBAKO_EMBEDDING_API_KEY: "TEST-key",
    CHIBAKO_EMBEDDING_BASE_URL: "http://127.0.0.1:1/v1",
    CHIBAKO_EMBEDDING_MODEL: "TEST-broken",
    CHIBAKO_EMBEDDING_DIM: "8",
  });
  try {
    const note = notes.createNote({ title: "Broken provider", content: "findable keyword zebra" });
    for (let i = 0; i < 4; i++) assert.deepEqual(await repair.runEmbeddingRepair({ batch: 5, passes: 3 }), { indexed: 0 }); // trips the breaker
    assert.ok(index.embeddingStatus().last_error);
    notes.updateNote(note.id, { content: "findable keyword zebra edited" });
    const results = await recall({ query: "zebra", refreshStale: false });
    assert.ok(results.some((r) => r.id === note.id));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
