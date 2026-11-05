import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { getDb } from "../../src/lib/db";
import * as index from "../../src/lib/embedding-index";
import * as repair from "../../src/lib/embedding-repair";
import * as store from "../../src/lib/embedding-store";
import { BULK_REQUEST_TIMEOUT_MS, embeddingBatchSize } from "../../src/lib/embeddings";
import * as notes from "../../src/lib/notes";
import { recallDetailed } from "../../src/lib/recall";
import * as provider from "./provider-fixture";
import { ok, refuse, TEST_KEY, type Handler } from "./provider-fixture";

const vault = mkdtempSync(join(tmpdir(), "chibako-index-heals-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

let activeModel = "TEST-model"; // a test that changes the model leaves the later ones on the new one

const withProvider: typeof provider.withProvider = (handler, fn, env = {}) =>
  provider.withProvider(handler, fn, { CHIBAKO_EMBEDDING_MODEL: activeModel, ...env });

const makeNotes = (prefix: string, count: number) => {
  for (let i = 0; i < count; i++) notes.createNote({ title: `${prefix} ${i}`, content: `${prefix} body number ${i} SECRET-NOTE-TEXT` });
};

test("never-synced, wrong-dim or wrong-model metadata keeps every fresh row, even when the Provider refuses all calls", async () => {
  makeNotes("Keep", 3);
  await withProvider(ok, async () => { await index.reindexEmbeddings(); });
  assert.equal(index.embeddingStatus().rows, 3);
  for (const meta of [{ model: "", dim: 0, input_version: 0 }, { dim: 3 }, { model: "other-model" }]) {
    store.setMeta(meta);
    await withProvider(refuse, async (state) => {
      await index.reindexEmbeddings();
      assert.equal(state.sizes.length, 0, "every row is fresh, so the Provider is not called");
    });
    assert.equal(index.embeddingStatus().rows, 3);
    assert.equal(index.embeddingStatus().stale, 0);
  }
  assert.equal(store.getMeta().model, "TEST-model", "the metadata followed the active Provider");
});

test("a real model change keeps old rows out of vector search, repair replaces them, and query latency figures reset", async () => {
  const rowsBefore = index.embeddingStatus().rows;
  activeModel = "TEST-model-2";
  const handler: Handler = (res, inputs) => (inputs > 1 ? refuse(res, inputs) : ok(res, inputs)); // queries answer, bulk requests are refused
  await withProvider(handler, async () => {
    index.recordQueryLatency(5);
    await index.reindexEmbeddings();
    assert.equal(index.embeddingStatus().query_latency.samples, 0, "figures belonged to the old model");
    assert.equal(index.embeddingStatus().rows, rowsBefore, "nothing was deleted while the Provider refused");
    assert.equal(index.freshEmbeddingIds().size, 0);
    const keyword = await recallDetailed({ query: "Keep body", refreshStale: false });
    assert.equal(keyword.mode, "keyword", "old-model vectors are not searched");
    assert.equal(keyword.fallback_reason, "no_vectors");
  });
  await withProvider(ok, async () => {
    await repair.runEmbeddingRepair();
    assert.equal(index.embeddingStatus().stale, 0);
    assert.equal(index.embeddingStatus().rows, rowsBefore, "rows were replaced, not added");
    assert.equal((await recallDetailed({ query: "Keep body", refreshStale: false })).mode, "hybrid");
  });
});

test("CHIBAKO_EMBEDDING_BATCH sets Notes per request: default 4, invalid values use it, 1 is the floor", async () => {
  const withBatch = (value: string | undefined) => {
    if (value === undefined) delete process.env.CHIBAKO_EMBEDDING_BATCH;
    else process.env.CHIBAKO_EMBEDDING_BATCH = value;
    return embeddingBatchSize();
  };
  try {
    assert.equal(withBatch(undefined), 4);
    for (const bad of ["", "abc", "0", "-3", "2.5", "101", "1e2"]) assert.equal(withBatch(bad), 4, `${JSON.stringify(bad)} falls back`);
    assert.equal(withBatch("1"), 1);
    assert.equal(withBatch(" 7 "), 7);
    assert.equal(withBatch("100"), 100);
  } finally {
    delete process.env.CHIBAKO_EMBEDDING_BATCH;
  }

  makeNotes("Batchy", 9);
  await withProvider(ok, async (state) => {
    await index.reindexEmbeddings();
    assert.deepEqual(state.sizes, [4, 4, 1]);
  });
  makeNotes("Singly", 3);
  await withProvider(ok, async (state) => {
    await index.reindexEmbeddings();
    assert.deepEqual(state.sizes, [1, 1, 1]);
  }, { CHIBAKO_EMBEDDING_BATCH: "1" });
});

test("a hung bulk request times out, and later repair ticks still run", async () => {
  let hang = true;
  const note = notes.createNote({ title: "Hung", content: "waits for a Provider that never answers" });
  await withProvider(
    (res, inputs) => { if (!hang) ok(res, inputs); }, // a hung request leaves the response open
    async (state) => {
      mock.timers.enable({ apis: ["setTimeout"] });
      try {
        const first = repair.runEmbeddingRepair({ batch: 5, passes: 1 });
        for (let i = 0; i < 500 && state.sizes.length === 0; i++) await new Promise((resolve) => setImmediate(resolve));
        assert.equal(state.sizes.length, 1, "the request reached the Provider and is hanging");
        mock.timers.tick(BULK_REQUEST_TIMEOUT_MS);
        assert.deepEqual(await first, { indexed: 0 });
      } finally {
        mock.timers.reset();
      }
      assert.match(index.embeddingStatus().last_error ?? "", /timed out/);
      hang = false;
      assert.equal((await repair.runEmbeddingRepair({ batch: 5, passes: 1 })).indexed, 1, "the guards were released");
      assert.ok(store.getEmbedding(note.id));
    },
  );
});

test("repair figures survive a later single-Note success", async () => {
  await withProvider(ok, async () => {
    await repair.runEmbeddingRepair();
    const after = index.embeddingStatus();
    assert.ok(after.last_repair_at);
    const note = notes.createNote({ title: "Single", content: "one more Note" });
    assert.equal(await index.refreshNotes([note.id]), 1);
    const later = index.embeddingStatus();
    assert.equal(later.indexed, after.indexed + 1, "the live count moved");
    assert.equal(later.last_repair_at, after.last_repair_at);
    assert.equal(later.repair_indexed, after.repair_indexed);
    assert.equal(later.repair_remaining, after.repair_remaining);
  });
});

test("a rate-limit header can carry no key or Note text: values are cut and stripped", async () => {
  makeNotes("Header", 1);
  await withProvider(
    (res) => void res.writeHead(429, { "retry-after": "30", "x-ratelimit-reset-requests": "6m0s", "x-request-id": "not-allowlisted" }).end("slow down"),
    async () => {
      await index.reindexEmbeddings();
      const error = index.embeddingStatus().last_error ?? "";
      assert.match(error, /^\[retry-after=30 x-ratelimit-reset-requests=6m0s\] embedding request failed \(429\): slow down/);
      assert.doesNotMatch(error, /x-request-id|TEST-secret-key|SECRET-NOTE-TEXT/);
      assert.ok(error.length <= 300, "stored error stays inside its 300-character cut");
    },
  );
  await withProvider(ok, async () => { await repair.runEmbeddingRepair(); });
});

test("a row rewritten by another process is not searched, even while the fresh-id cache still lists it", async () => {
  makeNotes("Cross", 2);
  await withProvider(ok, async () => {
    await repair.runEmbeddingRepair();
    assert.ok(index.freshEmbeddingIds().size > 0); // fills the cache
    getDb().prepare(`UPDATE note_embeddings SET model = 'written-by-another-process'`).run(); // no store version bump, as from another process
    const result = await recallDetailed({ query: "Cross body", refreshStale: false });
    assert.equal(result.mode, "keyword");
    assert.equal(result.fallback_reason, "no_vectors");
  });
  index.recordQueryLatency(1); // keep the meta write path warm; rows are repaired next
  await withProvider(ok, async () => { await repair.runEmbeddingRepair(); });
});

test("a Provider error that echoes the key or Note text is stored redacted", async () => {
  makeNotes("Echo", 1);
  await withProvider(
    (res, _inputs, texts) => void res.writeHead(400).end(`bad input ${texts?.[0]} with key ${TEST_KEY}`),
    async () => {
      await index.reindexEmbeddings();
      const error = index.embeddingStatus().last_error ?? "";
      assert.match(error, /embedding request failed \(400\)/);
      assert.doesNotMatch(error, /SECRET-NOTE-TEXT|TEST-secret-key/);
    },
  );
  await withProvider(ok, async () => { await repair.runEmbeddingRepair(); });
});

test("repair figures count a Note edited while the run embedded as remaining", async () => {
  const note = notes.createNote({ title: "Edited midway", content: "before the edit" });
  await withProvider(
    (res, inputs) => { notes.updateNote(note.id, { content: "after the edit" }); ok(res, inputs); },
    async () => {
      await index.reindexEmbeddings();
      const status = index.embeddingStatus();
      assert.equal(status.repair_remaining, status.stale);
      assert.equal(status.repair_remaining, 1);
    },
  );
  await withProvider(ok, async () => { await repair.runEmbeddingRepair(); });
});
