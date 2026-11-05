import { getDb, now, uid } from "./db";
import { listNotes, searchNotes, getNote, type NoteSummary } from "./notes";
import { stripFrontmatter } from "./markdown";
import { embeddingsEnabled, getEmbeddingProvider } from "./embeddings";
import { embedQuery, QueryEmbedTimeout } from "./query-embedding";
import { listEmbeddings } from "./embedding-store";
import { bookkeepingNoteIds } from "../features/memory/session-memory";
import { freshEmbeddingIds, staleNoteIds, refreshNotes, recordQueryFallback, recordQueryLatency, type QueryFallbackReason } from "./embedding-index";

// ---------- vector search ----------

// The query embedding time limit is configurable (CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS); see ./query-embedding.
// A slow provider still falls back to keyword results once the limit passes.

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Cosine search over stored vectors, restricted to embeddings that are currently fresh. */
async function vectorSearch(query: string, limit: number): Promise<Array<{ id: string; score: number }>> {
  const provider = getEmbeddingProvider();
  if (!provider) return [];
  const qvec = await embedQuery(provider, query, recordLatencyBestEffort);
  if (!qvec) return [];
  const fresh = freshEmbeddingIds();
  const scored: Array<{ id: string; score: number }> = [];
  for (const e of listEmbeddings()) {
    if (!fresh.has(e.note_id)) continue;
    const sim = cosine(qvec, e.vector);
    if (sim > 0) scored.push({ id: e.note_id, score: sim });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ---------- RRF fusion ----------

/** Weighted Reciprocal Rank Fusion over ranked id lists. Higher k = smoother. */
export function rrf(rankings: Array<Array<{ id: string }>>, weights: number[] = [], k = 60): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  for (const [list, ranking] of rankings.entries()) {
    const weight = weights[list] ?? 1;
    ranking.forEach((item, idx) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + weight / (k + idx + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// ---------- token-budget snippet ----------

const CHARS_PER_TOKEN = 4;
const tokensFor = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

/** Leading and trailing punctuation only, so `osprey?` becomes `osprey` while `i18n` and `a11y` stay whole. */
const stripEdgePunctuation = (term: string) => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** Lowercase query terms without edge punctuation, for matching text. */
function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).map(stripEdgePunctuation).filter(Boolean))];
}

/**
 * Trim content to at most `maxChars` characters (ellipses included). The window holds the most distinct
 * query terms, then the most hits, and is centered on the hits inside it.
 */
function trimmedSnippet(raw: string, terms: string[], maxChars: number): string {
  const content = raw.replace(/\s+/g, " ").trim();
  if (content.length <= maxChars) return content;
  const lower = content.toLowerCase();
  const hits: Array<{ at: number; end: number; term: string }> = [];
  for (const term of terms) {
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) hits.push({ at, end: at + term.length, term });
  }
  hits.sort((a, b) => a.at - b.at);
  const room = Math.max(0, maxChars - 2); // reserve both possible ellipses
  let center = 0;
  let bestDistinct = 0;
  let bestHits = 0;
  // Each window starts at a hit; ties keep the earliest.
  hits.forEach((first, i) => {
    const inside = [];
    for (let j = i; j < hits.length && hits[j].at < first.at + room; j++) inside.push(hits[j]);
    const distinct = new Set(inside.map((h) => h.term)).size;
    if (distinct > bestDistinct || (distinct === bestDistinct && inside.length > bestHits)) {
      bestDistinct = distinct;
      bestHits = inside.length;
      center = (first.at + inside[inside.length - 1].end) / 2;
    }
  });
  const start = bestDistinct === 0 ? 0 : Math.min(Math.max(0, Math.floor(center - room / 2)), content.length - room);
  const end = start + room;
  return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`.slice(0, maxChars);
}

// ---------- query cleaning ----------

// Filler words stop matching in Recall only; exact Search keeps every term.
// shortcut: short hand-picked English list plus common Tagalog, tune from recall misses.
const FILLER = new Set((
  "a an and are as at be been but by can could did do does for from had has have how i if in is it its me my of on or our so than that the their them then there these they this to us was we were what when where which who why will with would you your " +
  "ang ay ba din na ng sa mga si ni kay ko mo ka ako ikaw siya kami tayo sila ito iyan iyon at o pero kasi para pa naman lang po ano paano bakit saan kailan sino"
).split(" "));

/** Drops filler terms for the keyword query; when nothing is left, the original terms stay. */
function cleanQuery(query: string): string {
  const terms = query.split(/\s+/).filter(Boolean);
  const kept = terms.filter((t) => !FILLER.has(stripEdgePunctuation(t).toLowerCase()));
  return (kept.length ? kept : terms).join(" ");
}

/** A Note belongs to the project when a segment of its folder is the project. */
function inProject(folder: string, project: string): boolean {
  const wanted = project.toLowerCase();
  return folder.toLowerCase().split("/").includes(wanted);
}

// shortcut: flat 1.3x boost. Not tuned in ticket 10: the tuning runs pass no project hint, so there is no evidence.
const PROJECT_BOOST = 1.3;

// A title that holds the query terms is the strongest sign of the Note asked for. Rank fusion alone lets a
// vector-only top hit beat an exact title match. Tuned on the tune split: 1 was too weak, 3 gave the best top 1 and top 5.
// shortcut: substring match with no stemming ("tests" misses "Test"), upgrade if recall misses show it.
const TITLE_BOOST = 3;

/** Share of the query terms found in the title, from 0 to 1. */
function titleCoverage(title: string, terms: string[]): number {
  const lower = title.toLowerCase();
  return terms.length ? terms.filter((t) => lower.includes(t)).length / terms.length : 0;
}

// ---------- public recall API ----------

export interface RecallOptions {
  query: string;
  /** Ranking hint only: Notes in this project rank higher; it is never search text. */
  project?: string;
  limit?: number;
  budget?: number;
  includeVectors?: boolean;
  refreshStale?: boolean;
}

export type RecallMode = "hybrid" | "keyword";
export type RecallFallbackReason = "timeout" | "provider_error" | "disabled" | "no_vectors";

export interface RecallResponse {
  results: RecallItem[];
  /** `keyword` means the vector half did not contribute; see `fallback_reason`. */
  mode: RecallMode;
  fallback_reason: RecallFallbackReason | null;
}

export interface RecallItem {
  id: string;
  title: string;
  folder: string;
  kind: NoteSummary["kind"];
  snippet: string;
  score: number;
  matched: string[];
  /** The Note's `status` property (draft, active, done, archived), or null when unset. */
  status: string | null;
}

/**
 * Token-budget-capped semantic recall. Always runs BM25; when embeddings are
 * enabled it fuses vector similarity via RRF. Returns ranked titles + trimmed
 * snippets only — never full note bodies — so the payload stays small.
 */
export async function recall(opts: RecallOptions): Promise<RecallItem[]> {
  return (await recallDetailed(opts)).results;
}

/** Same ranking as `recall`, plus whether the vector half contributed and why not. */
export async function recallDetailed(opts: RecallOptions): Promise<RecallResponse> {
  const query = opts.query.trim();
  if (!query) return { results: [], mode: "keyword", fallback_reason: null };
  const limit = opts.limit ?? 8;
  const budget = opts.budget ?? 2000;

  const keywords = cleanQuery(query);
  const bm25 = searchNotes(keywords, [], { anyTerm: true }).slice(0, 50).map((r) => ({ id: r.id }));
  const { vec, fallback } = await vectorHalf(query, opts);
  const rankings = vec ? [bm25, vec.map((v) => ({ id: v.id }))] : [bm25];
  const vectorScores = vec ? new Map(vec.map((v) => [v.id, v.score])) : null;

  const byId = new Map<string, NoteSummary>(listNotes().map((n) => [n.id, n]));
  // Any-term keyword hits are broad in large vaults: let them boost semantic
  // matches, not displace them. 0.5 kept after a sweep on the tune split: 2 and 4 lost top 5 without
  // recovering top 1 (a vector-only top hit still outranks a keyword top hit at any sane weight; TITLE_BOOST fixes that).
  const fused = rrf(rankings, [0.5, 1]);
  const terms = queryTerms(keywords);
  const candidates = selectCandidates(fused, byId, opts.project?.trim(), limit, terms);

  // Each result may use at most an even share of what is left, so one long Note cannot take the whole
  // allowance; a share it leaves unused rolls forward. The total stays a hard limit.
  const items: RecallItem[] = [];
  let used = 0;
  for (const [index, { id, score }] of candidates.entries()) {
    const summary = byId.get(id);
    if (!summary) continue;
    const full = getNote(id);
    if (!full) continue;

    const share = Math.floor((budget - used) / (candidates.length - index));
    const titleTokens = tokensFor(summary.title);
    const snippetRoom = share - titleTokens; // tokens this result's Snippet may use
    if (snippetRoom < 1) continue; // no room for even a tiny Snippet; later results may have a larger share
    const snippet = trimmedSnippet(stripFrontmatter(full.content), terms, snippetRoom * CHARS_PER_TOKEN);
    used += titleTokens + tokensFor(snippet);
    items.push(buildItem(summary, snippet, score, vectorScores, terms));
  }

  return { results: items, mode: vec ? "hybrid" : "keyword", fallback_reason: fallback };
}

/**
 * Picks the Notes Recall may return: bookkeeping Notes are left out, Notes in the project and Notes whose title holds the query terms get a boost, the best `limit`
 * by score are kept, and archived Notes go after current ones within that window. Archived Notes compete for a place
 * on score first, so an exact match to an old Note is not cut by weaker current ones.
 * shortcut: strict demotion inside the window, ticket 10 tunes it against the tune split.
 */
function selectCandidates(
  fused: Array<{ id: string; score: number }>,
  byId: Map<string, NoteSummary>,
  project: string | undefined,
  limit: number,
  terms: string[],
): Array<{ id: string; score: number }> {
  const hidden = bookkeepingNoteIds();
  const top = fused
    .filter(({ id }) => !hidden.has(id))
    .map((r) => { const folder = byId.get(r.id)?.folder; return project && folder !== undefined && inProject(folder, project) ? { ...r, score: r.score * PROJECT_BOOST } : r; })
    .map((r) => ({ ...r, score: r.score * (1 + TITLE_BOOST * titleCoverage(byId.get(r.id)?.title ?? "", terms)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const isArchived = ({ id }: { id: string }) => byId.get(id)?.properties.status === "archived";
  return [...top.filter((r) => !isArchived(r)), ...top.filter(isArchived)];
}

/**
 * Runs the vector half and classifies why it did not contribute. `disabled` means embeddings are off;
 * a caller that opted out with `includeVectors: false` gets no reason.
 */
async function vectorHalf(
  query: string,
  opts: RecallOptions,
): Promise<{ vec: Array<{ id: string; score: number }> | null; fallback: RecallFallbackReason | null }> {
  if (!embeddingsEnabled()) return { vec: null, fallback: "disabled" };
  if (opts.includeVectors === false) return { vec: null, fallback: null };
  // Lazy self-heal: queue a few stale notes for background refresh. This is
  // the process-agnostic backstop for edits made by the other process, and it
  // must never block or fail the recall response.
  if (opts.refreshStale !== false) {
    const stale = staleNoteIds(20);
    if (stale.length) void refreshNotes(stale);
  }
  let fallback: QueryFallbackReason;
  try {
    const vec = await vectorSearch(query, 50);
    if (vec.length) return { vec, fallback: null };
    fallback = "no_vectors";
  } catch (e) {
    // Provider failed: fall back to keyword-only results, and say so.
    fallback = e instanceof QueryEmbedTimeout ? "timeout" : "provider_error";
  }
  recordFallbackBestEffort(fallback);
  return { vec: null, fallback };
}

/** Counters must never break a read-only Recall. */
function recordFallbackBestEffort(reason: QueryFallbackReason): void {
  try {
    // Writes on this read path touch only a settings counter, never notes, embeddings, the store version or scan cache, so results are unaffected.
    recordQueryFallback(reason);
  } catch {
    // Metrics are advisory.
  }
}

/** Runs from the Provider's answer, which can land after Recall has returned, so nothing here may throw. */
function recordLatencyBestEffort(ms: number): void {
  try {
    recordQueryLatency(ms);
  } catch {
    // Metrics are advisory.
  }
}

function buildItem(
  summary: NoteSummary,
  snippet: string,
  score: number,
  vectorScores: Map<string, number> | null,
  terms: string[],
): RecallItem {
  const matched = terms.filter((t) => {
    const lower = summary.title.toLowerCase();
    return lower.includes(t) || snippet.toLowerCase().includes(t);
  });
  const vecScore = vectorScores?.get(summary.id) ?? 0;
  return {
    id: summary.id,
    title: summary.title,
    folder: summary.folder,
    kind: summary.kind,
    snippet,
    score: score + vecScore,
    matched,
    status: typeof summary.properties.status === "string" ? summary.properties.status : null,
  };
}

// ---------- observations ----------

export interface Observation {
  id: string;
  note_id: string | null;
  content: string;
  source: string;
  created_at: number;
}

export function saveObservation(input: { content: string; note_id?: string; source?: string }): Observation {
  const content = input.content.trim();
  if (!content) throw new Error("observation content is required");
  const obs: Observation = {
    id: uid(),
    note_id: input.note_id ?? null,
    content,
    source: input.source ?? "agent",
    created_at: now(),
  };
  getDb()
    .prepare(`INSERT INTO observations (id, note_id, content, source, created_at) VALUES (?,?,?,?,?)`)
    .run(obs.id, obs.note_id, obs.content, obs.source, obs.created_at);
  return obs;
}

export function listObservations(limit = 50): Observation[] {
  return getDb()
    .prepare(`SELECT * FROM observations ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as Observation[];
}

export function deleteObservation(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM observations WHERE id = ?`).run(id);
  return res.changes > 0;
}
