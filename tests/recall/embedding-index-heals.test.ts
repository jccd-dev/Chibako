import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
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

const vault = mkdtempSync(join(tmpdir(), "chibako-index-heals-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

let activeModel = "TEST-model"; // a test that changes the model leaves the later ones on the new one

type Handler = (res: ServerResponse, inputs: number) => void;

const ok: Handler = (res, inputs) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: Array.from({ length: inputs }, () => ({ embedding: [1, 0, 0, 0, 0, 0, 0, 0] })) }));
};
const refuse: Handler = (res) => void res.writeHead(429, { "retry-after": "12", "x-ratelimit-remaining-requests": "0" }).end("rate limited");

/** Runs fn against an OpenAI-compatible fake Provider on localhost. `sizes` lists the Notes in each request, in order. */
async function withProvider(handler: Handler, fn: (state: { sizes: number[] }) => Promise<void>, env: Record<string, string> = {}) {
  const state = { sizes: [] as number[] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const inputs = (JSON.parse(body).input as string[]).length;
      state.sizes.push(inputs);
      handler(res, inputs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const saved = { ...process.env };
  Object.assign(process.env, {
    CHIBAKO_EMBEDDING_PROVIDER: "openai",
    CHIBAKO_EMBEDDING_API_KEY: "TEST-secret-key",
    CHIBAKO_EMBEDDING_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    CHIBAKO_EMBEDDING_MODEL: activeModel,
    CHIBAKO_EMBEDDING_DIM: "8",
    ...env,
  });
  try {
    await fn(state);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    server.closeAllConnections();
    server.close();
  }
}

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

test("a Provider volume limit keeps the requests that passed, and repair ticks finish the index", async () => {
  makeNotes("Volume", 163);
  const total = index.embeddingStatus().total;
  let used = 0;
  const limit = 51; // Notes the Provider takes per window; a request that would pass it is refused whole
  const handler: Handler = (res, inputs) => {
    if (used + inputs > limit) return refuse(res, inputs);
    used += inputs;
    ok(res, inputs);
  };
  await withProvider(handler, async () => {
    const rowsBefore = index.embeddingStatus().rows;
    await repair.runEmbeddingRepair();
    assert.ok(used > 0 && used <= limit);
    assert.equal(index.embeddingStatus().rows, rowsBefore + used, "every request that passed was kept");
    assert.equal(index.embeddingStatus().stale, 163 - used);
    const status = index.embeddingStatus();
    assert.equal(status.repair_remaining, 163 - used);
    assert.equal(status.repair_indexed, total - 163 + used);
    assert.match(status.last_error ?? "", /^\[retry-after=12 x-ratelimit-remaining-requests=0\] embedding request failed \(429\)/);
    assert.doesNotMatch(status.last_error ?? "", /TEST-secret-key|SECRET-NOTE-TEXT/);

    let ticks = 1;
    while (index.embeddingStatus().stale > 0 && ticks < 6) {
      used = 0; // a new window
      await repair.runEmbeddingRepair();
      ticks++;
    }
    assert.equal(index.embeddingStatus().stale, 0, `all ${total} Notes indexed after ${ticks} ticks`);
    assert.equal(index.embeddingStatus().repair_remaining, 0);
    assert.equal(index.embeddingStatus().repair_indexed, total);
    assert.ok(ticks <= 5);
  }, { CHIBAKO_EMBEDDING_BATCH: "3" });
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
