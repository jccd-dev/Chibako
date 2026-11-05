import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { assertTemporaryDataDir, compareResults, formatReport, loadQuestions, runScoreboard, saveResult, type ScoreboardResult } from "../scripts/scoreboard/scoreboard";
import { createFixtureVault, FIXTURE_QUESTIONS } from "../scripts/scoreboard/fixture/vault";
import { staleNoteIds } from "../src/lib/embedding-index";
import { updateNote, listNotes } from "../src/lib/notes";

let vault: Awaited<ReturnType<typeof createFixtureVault>>;
before(async () => { vault = await createFixtureVault(); });
after(() => vault.cleanup());

const rates = (result: ScoreboardResult) => Object.fromEntries(result.summary.buckets.map((b) => [`${b.group}/${b.split}`, [b.n, b.hit_at_1, b.hit_at_5]]));

test("question files are validated and the committed fixture loads", () => {
  assert.equal(loadQuestions(FIXTURE_QUESTIONS).length, 8);
  const dir = mkdtempSync(join(tmpdir(), "chibako-scoreboard-q-"));
  try {
    const bad = join(dir, "bad.json");
    const base = { id: "a", question: "q", group: "saved", expected_title: "T", split: "tune" };
    for (const broken of [{ ...base, group: "other" }, { ...base, split: "dev" }, { ...base, expected_title: undefined }, { ...base, id: "" }]) {
      writeFileSync(bad, JSON.stringify([broken]));
      assert.throws(() => loadQuestions(bad), /Invalid question file/);
    }
    writeFileSync(bad, JSON.stringify([base, base]));
    assert.throws(() => loadQuestions(bad), /Duplicate question id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the tool refuses a data directory outside the OS temp dir", async () => {
  assert.throws(() => assertTemporaryDataDir(join(process.cwd(), "data")), /temporary/);
  assert.throws(() => assertTemporaryDataDir(tmpdir()), /temporary/);
  assert.throws(() => assertTemporaryDataDir(join(tmpdir(), "does-not-exist-chibako")), /temporary/);
  assertTemporaryDataDir(vault.dir);

  const saved = process.env.CHIBAKO_DATA_DIR;
  process.env.CHIBAKO_DATA_DIR = join(process.cwd(), "data");
  try {
    await assert.rejects(runScoreboard({ questions: [] }), /temporary/);
  } finally {
    process.env.CHIBAKO_DATA_DIR = saved;
  }
});

test("tune run scores hit rates by group and split, tokens, latency and hit source, without hidden questions", async () => {
  const result = await runScoreboard({ questions: loadQuestions(FIXTURE_QUESTIONS) });
  assert.equal(result.final, false);
  assert.deepEqual(rates(result), { "saved/tune": [5, 0.8, 1], "conversation-only/tune": [1, 0, 0] });
  assert.ok(!result.questions.some((q) => q.split === "hidden"), "hidden questions are not scored while tuning");

  const byId = Object.fromEntries(result.questions.map((q) => [q.id, q]));
  assert.equal(byId.host.hit_rank, 1);
  assert.equal(byId.launch.hit_rank, 2, "the vector half finds a synonym match that keywords miss");
  assert.equal(byId.cents.hit_source, "canonical");
  assert.equal(byId.tax.hit_source, "checkpoint");
  assert.equal(byId.tax.canonical_rank, null, "the answer sits only in a checkpoint, not its canonical Note");
  assert.equal(byId.lost.hit_rank, null);
  assert.equal(byId.lost.hit_source, null);

  assert.deepEqual(result.summary.hits_by_source, { checkpoint: 1, canonical: 4 });
  const report = formatReport(result);
  assert.match(report, /\btax\s.*hit @\d in checkpoint/);
  assert.match(report, /\bcents\s.*hit @\d in canonical/);
  assert.match(report, /\blost\s.*miss/);
  assert.ok(result.summary.tokens.total > 0 && result.summary.tokens.mean > 0);
  assert.ok(result.summary.latency_ms.p50 >= 0 && result.summary.latency_ms.p95 >= result.summary.latency_ms.p50);
});

test("the report shows the keyword fallback rate", async () => {
  const questions = loadQuestions(FIXTURE_QUESTIONS);
  const hybrid = await runScoreboard({ questions });
  assert.equal(hybrid.summary.keyword_fallback_rate, 0);
  assert.match(formatReport(hybrid), /keyword fallback\s+0\.00/);

  const provider = process.env.CHIBAKO_EMBEDDING_PROVIDER;
  delete process.env.CHIBAKO_EMBEDDING_PROVIDER;
  try {
    const keyword = await runScoreboard({ questions });
    assert.equal(keyword.summary.keyword_fallback_rate, 1);
    assert.ok(keyword.questions.every((q) => q.fallback_reason === "disabled"));
    assert.match(formatReport(keyword), /keyword fallback\s+1\.00/);
    assert.match(compareResults(hybrid, keyword), /keyword fallback.*0\.00 -> 1\.00/);
  } finally {
    process.env.CHIBAKO_EMBEDDING_PROVIDER = provider;
  }
});

test("a final run also scores hidden questions", async () => {
  const result = await runScoreboard({ questions: loadQuestions(FIXTURE_QUESTIONS), final: true });
  assert.equal(result.final, true);
  assert.deepEqual(rates(result), {
    "saved/tune": [5, 0.8, 1], "saved/hidden": [1, 1, 1],
    "conversation-only/tune": [1, 0, 0], "conversation-only/hidden": [1, 0, 0],
  });
});

test("fixture runs are deterministic apart from latency", async () => {
  const strip = (r: ScoreboardResult) => JSON.stringify([r.summary.buckets, r.summary.hits_by_source, r.summary.tokens, r.questions.map((q) => ({ ...q, latency_ms: 0 }))]);
  const questions = loadQuestions(FIXTURE_QUESTIONS);
  assert.equal(strip(await runScoreboard({ questions })), strip(await runScoreboard({ questions })));
});

test("a run never lazily refreshes stale Embeddings", async () => {
  const note = listNotes().find((n) => n.title === "Hosting Decision")!;
  updateNote(note.id, { content: "The server provider changed." });
  assert.ok(staleNoteIds(50).includes(note.id));
  await runScoreboard({ questions: loadQuestions(FIXTURE_QUESTIONS) });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(staleNoteIds(50).includes(note.id), "the run left the stale Embedding alone");
});

test("nothing under src imports the Scoreboard, so it stays out of the stdio bundle", () => {
  const grep = spawnSync("grep", ["-rli", "scoreboard", "src"], { encoding: "utf8" });
  assert.equal(grep.status, 1, `unexpected references: ${grep.stdout}`);
});

test("results are saved and compared with earlier runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chibako-scoreboard-out-"));
  try {
    const questions = loadQuestions(FIXTURE_QUESTIONS);
    const before = await runScoreboard({ questions, label: "before" });
    const file = saveResult(before, join(dir, "results"));
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).summary, before.summary);
    mkdirSync(join(dir, "results"), { recursive: true });

    const worse: ScoreboardResult = structuredClone(before);
    worse.summary.buckets[0].hit_at_1 = 0;
    worse.summary.tokens.mean += 100;
    const report = compareResults(before, worse);
    assert.match(report, /saved\/tune.*top1.*-/s);
    assert.match(report, /tokens.*\+100/);
    assert.match(compareResults(before, before), /no change/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--source-dir style backup copies the database into a temp dir and cleanup removes it", async () => {
  const { backupVaultToTemp } = await import("../scripts/scoreboard/backup");
  const copy = await backupVaultToTemp(vault.dir);
  try {
    assertTemporaryDataDir(copy.dir);
    const db = new Database(join(copy.dir, "brain.db"), { readonly: true });
    try {
      assert.equal(db.prepare("SELECT title FROM notes WHERE title = 'Hosting Decision'").all().length, 1);
    } finally {
      db.close();
    }
  } finally {
    copy.cleanup();
  }
  assert.equal(existsSync(copy.dir), false);
  await assert.rejects(backupVaultToTemp(join(tmpdir(), "does-not-exist-chibako")));
});
