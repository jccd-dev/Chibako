import { getDb, now, uid } from "./db";
import { listNotes, searchNotes, getNote, type NoteSummary } from "./notes";
import { stripFrontmatter } from "./markdown";
import { embeddingsEnabled, getEmbeddingProvider } from "./embeddings";
import { listEmbeddings } from "./embedding-store";
import { freshEmbeddingIds, staleNoteIds, refreshNotes } from "./embedding-index";

// ---------- vector search ----------

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
  const [qvec] = await provider.embed([query]);
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

/** Reciprocal Rank Fusion over ranked id lists. Higher k = smoother. */
function rrf(rankings: Array<Array<{ id: string }>>, k = 60): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  for (const list of rankings) {
    list.forEach((item, idx) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// ---------- token-budget snippet ----------

/** Trim content to roughly `budget` words around the densest query-term hit. */
function trimmedSnippet(content: string, query: string, budget: number): string {
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
  const start = best === -1 ? 0 : Math.max(0, best - budget * 2);
  const words = content.slice(start).split(/\s+/).filter(Boolean);
  const trimmed = words.slice(0, budget).join(" ");
  return `${start > 0 ? "…" : ""}${trimmed}${words.length > budget ? "…" : ""}`;
}

// ---------- public recall API ----------

export interface RecallOptions {
  query: string;
  limit?: number;
  budget?: number;
  includeVectors?: boolean;
}

export interface RecallItem {
  id: string;
  title: string;
  folder: string;
  kind: NoteSummary["kind"];
  snippet: string;
  score: number;
  matched: string[];
}

/**
 * Token-budget-capped semantic recall. Always runs BM25; when embeddings are
 * enabled it fuses vector similarity via RRF. Returns ranked titles + trimmed
 * snippets only — never full note bodies — so the payload stays small.
 */
export async function recall(opts: RecallOptions): Promise<RecallItem[]> {
  const query = opts.query.trim();
  if (!query) return [];
  const limit = opts.limit ?? 8;
  const budget = opts.budget ?? 2000;
  const includeVectors = opts.includeVectors ?? true;

  const bm25 = searchNotes(query).slice(0, 50).map((r) => ({ id: r.id }));

  let rankings = [bm25];
  let vectorScores: Map<string, number> | null = null;
  if (includeVectors && embeddingsEnabled()) {
    // Lazy self-heal: queue a few stale notes for background refresh. This is
    // the process-agnostic backstop for edits made by the other process, and it
    // must never block or fail the recall response.
    const stale = staleNoteIds(20);
    if (stale.length) void refreshNotes(stale);
    try {
      const vec = await vectorSearch(query, 50);
      if (vec.length) {
        rankings = [bm25, vec.map((v) => ({ id: v.id }))];
        vectorScores = new Map(vec.map((v) => [v.id, v.score]));
      }
    } catch {
      // Provider failed: fall back to keyword-only results.
    }
  }

  const fused = rrf(rankings);
  const byId = new Map<string, NoteSummary>(listNotes().map((n) => [n.id, n]));
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const items: RecallItem[] = [];
  let tokens = 0;
  for (const { id, score } of fused.slice(0, limit)) {
    const summary = byId.get(id);
    if (!summary) continue;
    const full = getNote(id);
    if (!full) continue;

    const titleTokens = Math.ceil(summary.title.length / 4);
    const snippet = trimmedSnippet(stripFrontmatter(full.content), query, budget);
    const snippetTokens = Math.ceil(snippet.length / 4);
    const addTokens = titleTokens + snippetTokens;

    if (tokens + addTokens > budget) {
      if (items.length === 0) {
        items.push(buildItem(summary, snippet, score, vectorScores, terms));
      }
      break;
    }
    tokens += addTokens;
    items.push(buildItem(summary, snippet, score, vectorScores, terms));
  }

  return items;
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
