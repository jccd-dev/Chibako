import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { compareResults, formatReport, loadQuestions, runScoreboard, type ScoreboardResult } from "../scripts/scoreboard/scoreboard";
import { createFixtureVault, FIXTURE_QUESTIONS } from "../scripts/scoreboard/fixture/vault";
import { getDb } from "../src/lib/db";
import { reindexEmbeddings, staleNoteIds } from "../src/lib/embedding-index";

// A slow, OpenAI-shaped Provider: deterministic word-hash vectors, with a delay and a failure switch for queries.
let server: Server;
let queryDelayMs = 0;
let failQueries = false;
let slowInputs = false;

function vectorFor(text: string): number[] {
  const v = new Array<number>(32).fill(0);
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % 32;
    v[h] += 1;
  }
  return v;
}

let vault: Awaited<ReturnType<typeof createFixtureVault>>;
before(async () => {
  vault = await createFixtureVault();
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const input = JSON.parse(body).input as string[];
      const reply = () => {
        if (slowInputs && failQueries) return void res.writeHead(500).end("boom");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: input.map((t) => ({ embedding: vectorFor(t) })) }));
      };
      if (slowInputs && queryDelayMs) setTimeout(reply, queryDelayMs);
      else reply();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  process.env.CHIBAKO_EMBEDDING_PROVIDER = "openai";
  process.env.CHIBAKO_EMBEDDING_API_KEY = "test-key";
  process.env.CHIBAKO_EMBEDDING_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  await reindexEmbeddings({ max: 100 });
  assert.equal(staleNoteIds(50).length, 0, "Notes were embedded by the test provider");
  slowInputs = true; // from here on only queries are embedded
});
after(() => {
  server.closeAllConnections();
  server.close();
  vault.cleanup();
});

const ranking = (r: ScoreboardResult) => JSON.stringify([r.summary.ranking, r.questions.map((q) => [q.id, q.ranking])]);

test("ranking scores do not depend on provider speed, and the normal pass still reports timeout fallback", async () => {
  const questions = loadQuestions(FIXTURE_QUESTIONS);

  queryDelayMs = 0;
  const fast = await runScoreboard({ questions });
  assert.equal(fast.summary.normal.keyword_fallback_rate, 0);

  queryDelayMs = 400;
  process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS = "100";
  try {
    const a = await runScoreboard({ questions });
    const b = await runScoreboard({ questions });
    assert.equal(ranking(a), ranking(b), "two slow runs rank identically");
    assert.equal(ranking(a), ranking(fast), "slow and fast providers rank identically");
    for (const run of [a, b]) {
      assert.equal(run.summary.normal.keyword_fallback_rate, 1, "the cache from an earlier run does not hide the timeouts");
      assert.ok(run.questions.every((q) => q.normal.fallback_reason === "timeout"));
      assert.ok(run.summary.normal.latency_ms.p50 < 350, "the normal pass gave up at the time limit");
    }
    assert.equal(process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS, "100", "the time limit is restored after the ranking pass");

    const report = formatReport(a);
    assert.match(report, /ranking pass/i);
    assert.match(report, /normal pass/i);
  } finally {
    delete process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS;
  }
});

test("a query Embedding that cannot be obtained fails the run instead of scoring with keywords", async () => {
  failQueries = true;
  try {
    await assert.rejects(runScoreboard({ questions: loadQuestions(FIXTURE_QUESTIONS) }), /query Embedding/i);
  } finally {
    failQueries = false;
  }
});

test("results from an older version are reported as not comparable", async () => {
  const next = await runScoreboard({ questions: loadQuestions(FIXTURE_QUESTIONS) });
  const report = compareResults({ version: 1, label: "old", created_at: "2026-01-01T00:00:00.000Z" }, next);
  assert.match(report, /not directly comparable/);
  assert.doesNotMatch(report, /->/);
  assert.equal(next.version, 2);
});

test("a Provider that works but has no stored Embeddings (no_vectors) also refuses to score", async () => {
  const kept = getDb().prepare("SELECT * FROM note_embeddings").all() as Array<Record<string, unknown>>;
  getDb().prepare("DELETE FROM note_embeddings").run();
  try {
    await assert.rejects(runScoreboard({ questions: loadQuestions(FIXTURE_QUESTIONS) }), /no_vectors/);
  } finally {
    const cols = Object.keys(kept[0] ?? {});
    const insert = getDb().prepare(`INSERT INTO note_embeddings (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`);
    for (const row of kept) insert.run(row);
  }
});

test("a current-version result without a summary gives a clear error, not a TypeError", async () => {
  const next = await runScoreboard({ questions: loadQuestions(FIXTURE_QUESTIONS) });
  assert.throws(() => compareResults({ version: 2, label: "broken", created_at: "2026-01-01T00:00:00.000Z" }, next), /no usable summary/);
});

test("per-question report lines name their pass: ranking hit and normal latency/fallback", async () => {
  const run = await runScoreboard({ questions: loadQuestions(FIXTURE_QUESTIONS) });
  const line = formatReport(run).split("\n").find((l) => l.startsWith(`  ${run.questions[0].id}  `));
  assert.match(line ?? "", /ranking: (hit @\d in \w+|miss)\s+normal: \d+\.\d ms, (no fallback|timeout|provider_error|no_vectors|disabled)/);
});
