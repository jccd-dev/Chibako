// Scoreboard: developer tool that scores a question set through Recall. Not part of the app or the stdio import graph.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { dataDir, getDb } from "../../src/lib/db";
import { clearQueryEmbeddingCache, MAX_TIMEOUT_MS } from "../../src/lib/query-embedding";
import { recallDetailed, type RecallFallbackReason } from "../../src/lib/recall";

const TOP_K = 5;

const questionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  group: z.enum(["saved", "conversation-only"]),
  expected_title: z.string().min(1).optional(),
  expected_phrase: z.string().min(1).optional(),
  canonical_note: z.string().min(1).optional(),
  split: z.enum(["tune", "hidden"]),
}).refine((q) => q.expected_title || q.expected_phrase, { message: "expected_title or expected_phrase is required" });

export type Question = z.infer<typeof questionSchema>;
export type Group = Question["group"];
export type Split = Question["split"];
export type HitSource = "checkpoint" | "canonical";

export function loadQuestions(file: string): Question[] {
  const parsed = z.array(questionSchema).safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`).join("; ");
    throw new Error(`Invalid question file ${file} (${issues})`);
  }
  const ids = new Set<string>();
  for (const q of parsed.data) {
    if (ids.has(q.id)) throw new Error(`Duplicate question id "${q.id}" in ${file}`);
    ids.add(q.id);
  }
  return parsed.data;
}

/** Real-vault runs must use a throwaway copy: refuse anything that is not an existing directory inside the OS temp dir. */
export function assertTemporaryDataDir(dir: string): void {
  const refuse = () => new Error(`Refusing to run: data directory "${dir}" is not inside the OS temporary directory. Run on a temporary copy of the Vault.`);
  let real: string;
  let tmp: string;
  try {
    real = realpathSync(dir);
    tmp = realpathSync(tmpdir());
  } catch {
    throw refuse();
  }
  const rel = relative(tmp, real);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw refuse();
}

/** Ranking figures come from the ranking pass (every query Embedding available); normal figures from the normal pass (real time limit). */
export interface QuestionResult {
  id: string;
  group: Group;
  split: Split;
  ranking: { hit_rank: number | null; hit_source: HitSource | null; canonical_rank: number | null; tokens: number };
  normal: { latency_ms: number; fallback_reason: RecallFallbackReason | null };
}

export interface Bucket { group: Group; split: Split; n: number; hit_at_1: number; hit_at_5: number }

export const RESULT_VERSION = 2;

export interface ScoreboardResult {
  version: typeof RESULT_VERSION;
  label: string;
  created_at: string;
  final: boolean;
  summary: {
    /** Ranking pass: hit rates and hit sources are the stable figures; tokens can shift slightly when a near-tie changes the result set. */
    ranking: {
      buckets: Bucket[];
      hits_by_source: Record<HitSource, number>;
      tokens: { total: number; mean: number };
    };
    /** Normal pass: cold query cache, real time limit. Latency and fallback vary with the Provider. */
    normal: {
      latency_ms: { p50: number; p95: number };
      /** Share of questions Recall answered with keywords only. */
      keyword_fallback_rate: number;
    };
  };
  questions: QuestionResult[];
}

/** Older results keep only what compare needs to say they cannot be compared. */
export type LoadedResult = ScoreboardResult | { version: number; label: string; created_at: string };

const norm = (s: string) => s.trim().toLowerCase();

function isCheckpoint(noteId: string): boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM memory_records WHERE note_id = ? AND role = 'session'").get(noteId));
}

// refreshStale: false keeps the run from mutating the temporary Vault's Embeddings.
const recallFor = (q: Question) => recallDetailed({ query: q.question, limit: TOP_K, refreshStale: false });

/** Normal pass: real time limit, cold query cache. Late answers fill the cache, so run it before the ranking pass. */
async function normalPass(q: Question): Promise<QuestionResult["normal"]> {
  const started = performance.now();
  const { fallback_reason } = await recallFor(q);
  return { latency_ms: performance.now() - started, fallback_reason };
}

/** Ranking pass: waits (up to the longest allowed time limit) for the query Embedding, and fails if it never arrives. */
async function rankingPass(q: Question): Promise<QuestionResult["ranking"]> {
  const { results: items, fallback_reason } = await recallFor(q);
  // "disabled" means no Provider at all, so every run is keyword-only by design; a missing query Embedding is the noise to refuse.
  if (fallback_reason !== null && fallback_reason !== "disabled") {
    throw new Error(`Ranking pass could not get the query Embedding for "${q.id}" (${fallback_reason}); refusing to score it with keywords.`);
  }
  const hit = items.findIndex((it) => {
    if (q.expected_title && norm(it.title) === norm(q.expected_title)) return true;
    return Boolean(q.expected_phrase && norm(`${it.title}\n${it.snippet}`).includes(norm(q.expected_phrase)));
  });
  const canonical = q.canonical_note ? items.findIndex((it) => norm(it.title) === norm(q.canonical_note!)) : -1;
  return {
    hit_rank: hit === -1 ? null : hit + 1,
    hit_source: hit === -1 ? null : isCheckpoint(items[hit].id) ? "checkpoint" : "canonical",
    canonical_rank: canonical === -1 ? null : canonical + 1,
    // Same ceil(chars / 4) estimate Recall budgets with; recall.ts does not expose its running total.
    tokens: items.reduce((sum, it) => sum + Math.ceil((it.title.length + it.snippet.length) / 4), 0),
  };
}

/** Nearest-rank percentile of a non-empty list. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

const rate = (hits: number, n: number) => (n ? Number((hits / n).toFixed(4)) : 0);

function summarize(rows: QuestionResult[]): ScoreboardResult["summary"] {
  const buckets: Bucket[] = [];
  for (const group of ["saved", "conversation-only"] as const) {
    for (const split of ["tune", "hidden"] as const) {
      const part = rows.filter((r) => r.group === group && r.split === split);
      if (!part.length) continue;
      buckets.push({
        group, split, n: part.length,
        hit_at_1: rate(part.filter((r) => r.ranking.hit_rank === 1).length, part.length),
        hit_at_5: rate(part.filter((r) => r.ranking.hit_rank !== null).length, part.length),
      });
    }
  }
  const tokensTotal = rows.reduce((sum, r) => sum + r.ranking.tokens, 0);
  const latencies = rows.map((r) => r.normal.latency_ms);
  return {
    ranking: {
      buckets,
      hits_by_source: {
        checkpoint: rows.filter((r) => r.ranking.hit_source === "checkpoint").length,
        canonical: rows.filter((r) => r.ranking.hit_source === "canonical").length,
      },
      tokens: { total: tokensTotal, mean: rows.length ? tokensTotal / rows.length : 0 },
    },
    normal: {
      latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
      keyword_fallback_rate: rate(rows.filter((r) => r.normal.fallback_reason !== null).length, rows.length),
    },
  };
}

/** Runs `work` with the longest allowed query time limit, then restores the caller's setting. */
async function withLongestQueryLimit<T>(work: () => Promise<T>): Promise<T> {
  const key = "CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS";
  const saved = process.env[key];
  process.env[key] = String(MAX_TIMEOUT_MS);
  try {
    return await work();
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
}

/**
 * Two passes per run. The normal pass starts from a cold query cache under the real time limit and gives latency and
 * keyword fallback; its late answers fill the cache. The ranking pass then scores hits with every query Embedding available.
 * Scores `tune` questions; `hidden` ones only when `final` is requested.
 */
export async function runScoreboard(opts: { questions: Question[]; final?: boolean; label?: string }): Promise<ScoreboardResult> {
  assertTemporaryDataDir(dataDir());
  const selected = opts.questions.filter((q) => opts.final || q.split === "tune");
  clearQueryEmbeddingCache();
  const normal: QuestionResult["normal"][] = [];
  for (const q of selected) normal.push(await normalPass(q));
  const ranking = await withLongestQueryLimit(async () => {
    const out: QuestionResult["ranking"][] = [];
    for (const q of selected) out.push(await rankingPass(q));
    return out;
  });
  const rows = selected.map((q, i): QuestionResult => ({ id: q.id, group: q.group, split: q.split, ranking: ranking[i], normal: normal[i] }));
  return {
    version: RESULT_VERSION,
    label: opts.label ?? "run",
    created_at: new Date().toISOString(),
    final: Boolean(opts.final),
    summary: summarize(rows),
    questions: rows,
  };
}

export function saveResult(result: ScoreboardResult, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const stamp = result.created_at.replace(/[:.]/g, "-");
  const label = result.label.replace(/[^\w.-]+/g, "_");
  const file = join(dir, `${stamp}-${label}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
  return file;
}

export function loadResult(file: string): LoadedResult {
  return JSON.parse(readFileSync(file, "utf8")) as LoadedResult;
}

const pad = (n: number, digits: number) => n.toFixed(digits);
const signed = (n: number, digits: number) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;

export function formatReport(r: ScoreboardResult): string {
  const lines = [`Scoreboard "${r.label}" ${r.created_at}${r.final ? " (final: hidden questions included)" : " (tune only)"}`];
  const { ranking, normal } = r.summary;
  lines.push("  Ranking pass (every query Embedding available; hit rates are stable, tokens can shift slightly on near-ties):");
  for (const b of ranking.buckets) lines.push(`    ${b.group}/${b.split}  n=${b.n}  top1 ${pad(b.hit_at_1, 2)}  top5 ${pad(b.hit_at_5, 2)}`);
  lines.push(`    hits by source  checkpoint ${ranking.hits_by_source.checkpoint}  canonical ${ranking.hits_by_source.canonical}`);
  lines.push(`    recall tokens  total ${ranking.tokens.total}  mean ${pad(ranking.tokens.mean, 1)}`);
  lines.push("  Normal pass (cold query cache, real time limit; varies with the Provider):");
  lines.push(`    latency ms  p50 ${pad(normal.latency_ms.p50, 1)}  p95 ${pad(normal.latency_ms.p95, 1)}`);
  lines.push(`    keyword fallback  ${pad(normal.keyword_fallback_rate, 2)}`);
  for (const q of r.questions) {
    const hit = q.ranking.hit_rank === null ? "miss" : `hit @${q.ranking.hit_rank} in ${q.ranking.hit_source}`;
    lines.push(`  ${q.id}  ${q.group}/${q.split}  ranking: ${hit}  normal: ${pad(q.normal.latency_ms, 1)} ms, ${q.normal.fallback_reason ?? "no fallback"}`);
  }
  return lines.join("\n");
}

function isCurrentResult(r: LoadedResult): r is ScoreboardResult {
  const summary = (r as Partial<ScoreboardResult>).summary;
  return r.version === RESULT_VERSION && Boolean(summary?.ranking?.buckets && summary.ranking.tokens && summary.normal?.latency_ms);
}

/** Lines showing how `next` moved against `prev`; empty-diff runs say so. */
export function compareResults(prev: LoadedResult, next: ScoreboardResult): string {
  const header = `Compared with "${prev.label}" (${prev.created_at})`;
  if (prev.version !== RESULT_VERSION) {
    return `${header}\n  Result version ${prev.version} is not directly comparable with version ${RESULT_VERSION}: its ranking was scored under the Provider time limit, so Provider timeouts moved it between runs. No deltas shown.`;
  }
  if (!isCurrentResult(prev)) throw new Error(`Result "${prev.label}" claims version ${RESULT_VERSION} but has no usable summary; it is damaged or hand-edited, so it cannot be compared.`);
  const before = prev;
  const lines: string[] = [];
  const note = (name: string, a: number, b: number, digits: number) => {
    if (a !== b) lines.push(`  ${name}  ${pad(a, digits)} -> ${pad(b, digits)} (${signed(b - a, digits)})`);
  };
  for (const b of next.summary.ranking.buckets) {
    const old = before.summary.ranking.buckets.find((x) => x.group === b.group && x.split === b.split);
    if (!old) continue;
    note(`ranking ${b.group}/${b.split} top1`, old.hit_at_1, b.hit_at_1, 2);
    note(`ranking ${b.group}/${b.split} top5`, old.hit_at_5, b.hit_at_5, 2);
  }
  note("ranking tokens mean", before.summary.ranking.tokens.mean, next.summary.ranking.tokens.mean, 1);
  note("normal latency p50 ms", before.summary.normal.latency_ms.p50, next.summary.normal.latency_ms.p50, 1);
  note("normal latency p95 ms", before.summary.normal.latency_ms.p95, next.summary.normal.latency_ms.p95, 1);
  note("normal keyword fallback", before.summary.normal.keyword_fallback_rate, next.summary.normal.keyword_fallback_rate, 2);
  return [header, ...(lines.length ? lines : ["  no change"])].join("\n");
}
