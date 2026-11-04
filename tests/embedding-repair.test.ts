import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb, maintenanceMarkerPath } from "../src/lib/db";
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

/** Runs fn with an OpenAI-compatible fake provider on localhost; `requests` counts embedding calls. */
async function withFakeProvider(handler: (res: ServerResponse, inputs: number) => void, fn: (state: { requests: number }) => Promise<void>) {
  const state = { requests: 0 };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.requests++;
      handler(res, (JSON.parse(body).input as string[]).length);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const saved = { ...process.env };
  Object.assign(process.env, {
    CHIBAKO_EMBEDDING_PROVIDER: "openai",
    CHIBAKO_EMBEDDING_API_KEY: "TEST-key",
    CHIBAKO_EMBEDDING_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    CHIBAKO_EMBEDDING_MODEL: "TEST-model",
    CHIBAKO_EMBEDDING_DIM: "8",
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

const ok = (res: ServerResponse, inputs: number) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: Array.from({ length: inputs }, () => ({ embedding: [1, 0, 0, 0, 0, 0, 0, 0] })) }));
};

test("a repair run that is still in flight makes the next call a no-op", async () => {
  await withFakeProvider(
    (res, n) => setTimeout(() => ok(res, n), 150),
    async (state) => {
      notes.createNote({ title: "Overlap", content: "overlap text" });
      const first = repair.runEmbeddingRepair();
      for (let i = 0; i < 50 && state.requests === 0; i++) await new Promise((r) => setTimeout(r, 10)); // first run is now waiting on the provider
      const second = await repair.runEmbeddingRepair();
      assert.deepEqual(second, { indexed: 0 });
      assert.equal(state.requests, 1, "the overlapping call did not reach the provider");
      assert.ok((await first).indexed > 0);
      assert.equal(index.embeddingStatus().stale, 0);
    },
  );
});

test("a maintenance fence during a repair is not counted as a provider failure", async () => {
  let mode: "fence" | "fail" | "ok" = "fence";
  await withFakeProvider(
    (res, n) => {
      if (mode === "fail") return void res.writeHead(500).end("boom");
      if (mode === "fence") writeFileSync(maintenanceMarkerPath(), ""); // the fence appears while the provider call is in flight
      ok(res, n);
    },
    async () => {
      notes.createNote({ title: "Fenced", content: "fenced text" });
      for (let i = 0; i < 2; i++) {
        assert.deepEqual(await repair.runEmbeddingRepair({ batch: 1, passes: 1 }), { indexed: 0 });
        rmSync(maintenanceMarkerPath(), { force: true });
      }
      assert.equal(index.embeddingStatus().last_error, null, "the fence is not recorded as a provider error");
      mode = "fail";
      await repair.runEmbeddingRepair({ batch: 1, passes: 1 }); // one real failure: with fences counted this would be the 3rd and open the breaker
      mode = "ok";
      assert.ok((await repair.runEmbeddingRepair({ batch: 1, passes: 1 })).indexed > 0, "the breaker is still closed");
    },
  );
});

test("provider failure never throws, never blocks Note writes, Recall keeps answering, and an open breaker stops provider calls", async () => {
  await withFakeProvider(
    (res) => res.writeHead(500).end("boom"),
    async (state) => {
      const note = notes.createNote({ title: "Broken provider", content: "findable keyword zebra" });
      for (let i = 0; i < 3; i++) assert.deepEqual(await repair.runEmbeddingRepair({ batch: 5, passes: 3 }), { indexed: 0 }); // trips the breaker
      assert.equal(state.requests, 3);
      assert.deepEqual(await repair.runEmbeddingRepair({ batch: 5, passes: 3 }), { indexed: 0 });
      assert.equal(state.requests, 3, "the open breaker kept the provider from being called");
      assert.ok(index.embeddingStatus().last_error);
      notes.updateNote(note.id, { content: "findable keyword zebra edited" });
      const results = await recall({ query: "zebra", refreshStale: false });
      assert.ok(results.some((r) => r.id === note.id));
    },
  );
});
