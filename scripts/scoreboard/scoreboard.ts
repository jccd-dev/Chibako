// Scoreboard: developer tool that scores a question set through Recall. Not part of the app or the stdio import graph.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { dataDir, getDb } from "../../src/lib/db";
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

export interface QuestionResult {
  id: string;
  group: Group;
  split: Split;
  hit_rank: number | null;
  hit_source: HitSource | null;
  canonical_rank: number | null;
  tokens: number;
  latency_ms: number;
  fallback_reason: RecallFallbackReason | null;
}

export interface Bucket { group: Group; split: Split; n: number; hit_at_1: number; hit_at_5: number }

export interface ScoreboardResult {
  version: 1;
  label: string;
  created_at: string;
  final: boolean;
  summary: {
    buckets: Bucket[];
    hits_by_source: Record<HitSource, number>;
    tokens: { total: number; mean: number };
    latency_ms: { p50: number; p95: number };
    /** Share of questions Recall answered with keywords only. */
    keyword_fallback_rate: number;
  };
  questions: QuestionResult[];
}

const norm = (s: string) => s.trim().toLowerCase();

function isCheckpoint(noteId: string): boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM memory_records WHERE note_id = ? AND role = 'session'").get(noteId));
}

async function scoreQuestion(q: Question): Promise<QuestionResult> {
  const started = performance.now();
  // refreshStale: false keeps the run from mutating the temporary Vault's Embeddings.
  const { results: items, fallback_reason } = await recallDetailed({ query: q.question, limit: TOP_K, refreshStale: false });
  const latency_ms = performance.now() - started;
  const hit = items.findIndex((it) => {
    if (q.expected_title && norm(it.title) === norm(q.expected_title)) return true;
    return Boolean(q.expected_phrase && norm(`${it.title}\n${it.snippet}`).includes(norm(q.expected_phrase)));
  });
  const canonical = q.canonical_note ? items.findIndex((it) => norm(it.title) === norm(q.canonical_note!)) : -1;
  return {
    id: q.id, group: q.group, split: q.split,
    hit_rank: hit === -1 ? null : hit + 1,
    hit_source: hit === -1 ? null : isCheckpoint(items[hit].id) ? "checkpoint" : "canonical",
    canonical_rank: canonical === -1 ? null : canonical + 1,
    tokens: items.reduce((sum, it) => sum + Math.ceil((it.title.length + it.snippet.length) / 4), 0),
    latency_ms,
    fallback_reason,
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
        hit_at_1: rate(part.filter((r) => r.hit_rank === 1).length, part.length),
        hit_at_5: rate(part.filter((r) => r.hit_rank !== null).length, part.length),
      });
    }
  }
  const tokensTotal = rows.reduce((sum, r) => sum + r.tokens, 0);
  const latencies = rows.map((r) => r.latency_ms);
  return {
    buckets,
    hits_by_source: {
      checkpoint: rows.filter((r) => r.hit_source === "checkpoint").length,
      canonical: rows.filter((r) => r.hit_source === "canonical").length,
    },
    tokens: { total: tokensTotal, mean: rows.length ? tokensTotal / rows.length : 0 },
    latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    keyword_fallback_rate: rate(rows.filter((r) => r.fallback_reason !== null).length, rows.length),
  };
}

/** Scores `tune` questions; `hidden` ones only when `final` is requested. */
export async function runScoreboard(opts: { questions: Question[]; final?: boolean; label?: string }): Promise<ScoreboardResult> {
  assertTemporaryDataDir(dataDir());
  const selected = opts.questions.filter((q) => opts.final || q.split === "tune");
  const rows: QuestionResult[] = [];
  for (const q of selected) rows.push(await scoreQuestion(q));
  return {
    version: 1,
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

export function loadResult(file: string): ScoreboardResult {
  return JSON.parse(readFileSync(file, "utf8")) as ScoreboardResult;
}

const pad = (n: number, digits: number) => n.toFixed(digits);
const signed = (n: number, digits: number) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;

export function formatReport(r: ScoreboardResult): string {
  const lines = [`Scoreboard "${r.label}" ${r.created_at}${r.final ? " (final: hidden questions included)" : " (tune only)"}`];
  for (const b of r.summary.buckets) lines.push(`  ${b.group}/${b.split}  n=${b.n}  top1 ${pad(b.hit_at_1, 2)}  top5 ${pad(b.hit_at_5, 2)}`);
  const s = r.summary;
  lines.push(`  hits by source  checkpoint ${s.hits_by_source.checkpoint}  canonical ${s.hits_by_source.canonical}`);
  lines.push(`  recall tokens  total ${s.tokens.total}  mean ${pad(s.tokens.mean, 1)}`);
  lines.push(`  latency ms  p50 ${pad(s.latency_ms.p50, 1)}  p95 ${pad(s.latency_ms.p95, 1)}`);
  lines.push(`  keyword fallback  ${pad(s.keyword_fallback_rate, 2)}`);
  return lines.join("\n");
}

/** Lines showing how `next` moved against `prev`; empty-diff runs say so. */
export function compareResults(prev: ScoreboardResult, next: ScoreboardResult): string {
  const lines: string[] = [];
  const note = (name: string, a: number, b: number, digits: number) => {
    if (a !== b) lines.push(`  ${name}  ${pad(a, digits)} -> ${pad(b, digits)} (${signed(b - a, digits)})`);
  };
  for (const b of next.summary.buckets) {
    const old = prev.summary.buckets.find((x) => x.group === b.group && x.split === b.split);
    if (!old) continue;
    note(`${b.group}/${b.split} top1`, old.hit_at_1, b.hit_at_1, 2);
    note(`${b.group}/${b.split} top5`, old.hit_at_5, b.hit_at_5, 2);
  }
  note("tokens mean", prev.summary.tokens.mean, next.summary.tokens.mean, 1);
  note("latency p50 ms", prev.summary.latency_ms.p50, next.summary.latency_ms.p50, 1);
  note("latency p95 ms", prev.summary.latency_ms.p95, next.summary.latency_ms.p95, 1);
  note("keyword fallback", prev.summary.keyword_fallback_rate ?? 0, next.summary.keyword_fallback_rate ?? 0, 2);
  return [`Compared with "${prev.label}" (${prev.created_at})`, ...(lines.length ? lines : ["  no change"])].join("\n");
}
