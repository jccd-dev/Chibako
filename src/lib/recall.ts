import { getDb, now, uid } from "./db";
import { listNotes, searchNotes, getNote, type NoteSummary } from "./notes";
import { stripFrontmatter } from "./markdown";
import { embeddingsEnabled, getEmbeddingProvider } from "./embeddings";
import { embedQuery, QueryEmbedTimeout } from "./query-embedding";
import { listEmbeddings } from "./embedding-store";
import { bookkeepingNoteIds } from "../features/memory/session-memory";
import { freshEmbeddingIds, staleNoteIds, refreshNotes, recordQueryFallback, type QueryFallbackReason } from "./embedding-index";

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
  const qvec = await embedQuery(provider, query);
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

/** Trim content to at most `maxChars` characters (ellipses included), centered on the densest query-term hit. */
function trimmedSnippet(raw: string, query: string, maxChars: number): string {
  const content = raw.replace(/\s+/g, " ").trim();
  if (content.length <= maxChars) return content;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = content.toLowerCase();
  let best = -1;
  let bestCount = 0;
  for (const t of terms) {
    let idx = lower.indexOf(t);
    while (idx !== -1) {
      let count = 0;
      let j = idx;
      while (j !== -1) {
        count++;
        j = lower.indexOf(t, j + t.length);
      }
      if (count > bestCount) {
        bestCount = count;
        best = idx;
      }
      idx = -1;
    }
  }
  const room = Math.max(0, maxChars - 2); // reserve both possible ellipses
  const start = best === -1 ? 0 : Math.min(Math.max(0, best - Math.floor(room / 2)), content.length - room);
  const end = start + room;
  return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`.slice(0, maxChars);
}

// ---------- public recall API ----------

export interface RecallOptions {
  query: string;
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

  const bm25 = searchNotes(query, [], { anyTerm: true }).slice(0, 50).map((r) => ({ id: r.id }));
  const { vec, fallback } = await vectorHalf(query, opts);
  const rankings = vec ? [bm25, vec.map((v) => ({ id: v.id }))] : [bm25];
  const vectorScores = vec ? new Map(vec.map((v) => [v.id, v.score])) : null;

  // Any-term keyword hits are broad in large vaults: let them boost semantic
  // matches, not displace them. shortcut: fixed 0.5 weight, tune from pilot recall samples.
  // Bookkeeping notes are left out; archived ones sink below current ones but stay findable.
  // shortcut: strict demotion, ticket 10 tunes it against the tune split.
  const skip = bookkeepingNoteIds();
  const ranked = rrf(rankings, [0.5, 1]).filter(({ id }) => !skip.has(id));
  const byId = new Map<string, NoteSummary>(listNotes().map((n) => [n.id, n]));
  const isArchived = ({ id }: { id: string }) => byId.get(id)?.properties.status === "archived";
  const fused = [...ranked.filter((r) => !isArchived(r)), ...ranked.filter(isArchived)];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const items: RecallItem[] = [];
  let tokens = 0;
  for (const { id, score } of fused.slice(0, limit)) {
    const summary = byId.get(id);
    if (!summary) continue;
    const full = getNote(id);
    if (!full) continue;

    const titleTokens = Math.ceil(summary.title.length / 4);
    const snippetTokens = budget - tokens - titleTokens;
    if (snippetTokens < 1) break; // hard limit: no room left for even a tiny Snippet
    const snippet = trimmedSnippet(stripFrontmatter(full.content), query, snippetTokens * 4);
    tokens += titleTokens + Math.ceil(snippet.length / 4);
    items.push(buildItem(summary, snippet, score, vectorScores, terms));
  }

  return { results: items, mode: vec ? "hybrid" : "keyword", fallback_reason: fallback };
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
    // The one write on this read path: a settings counter that never touches notes, embeddings, the store version or scan cache, so results are unaffected.
    recordQueryFallback(reason);
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
