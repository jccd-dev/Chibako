import { getDb, now, uid } from "./db";
import { listNotes, searchNotes, getNote, type SearchResult, type NoteSummary } from "./notes";
import { stripFrontmatter } from "./markdown";

// ---------- embedding config (optional, env-gated) ----------
//
// Embeddings are OFF by default. To enable semantic recall with a remote
// OpenAI-compatible embeddings API, set:
//   CHIBAKO_EMBEDDING_PROVIDER=openai      (or openrouter / custom)
//   CHIBAKO_EMBEDDING_API_KEY=<key>
//   CHIBAKO_EMBEDDING_MODEL=text-embedding-3-small
//   CHIBAKO_EMBEDDING_BASE_URL=https://api.openai.com/v1   (optional)
//   CHIBAKO_EMBEDDING_DIM=1536                              (optional)

const EMBEDDING_PROVIDER = process.env.CHIBAKO_EMBEDDING_PROVIDER ?? "";
const EMBEDDING_API_KEY = process.env.CHIBAKO_EMBEDDING_API_KEY ?? "";
const EMBEDDING_MODEL = process.env.CHIBAKO_EMBEDDING_MODEL ?? "text-embedding-3-small";
const EMBEDDING_DIM = Number(process.env.CHIBAKO_EMBEDDING_DIM ?? 0);

function embeddingBaseUrl(): string {
  if (process.env.CHIBAKO_EMBEDDING_BASE_URL) return process.env.CHIBAKO_EMBEDDING_BASE_URL.replace(/\/$/, "");
  if (EMBEDDING_PROVIDER === "openrouter") return "https://openrouter.ai/api/v1";
  return "https://api.openai.com/v1";
}

export function embeddingsEnabled(): boolean {
  return Boolean(EMBEDDING_PROVIDER && EMBEDDING_API_KEY);
}

// ---------- embedding primitives ----------

async function embedTexts(texts: string[]): Promise<number[][]> {
  const url = `${embeddingBaseUrl()}/embeddings`;
  const body: Record<string, unknown> = { model: EMBEDDING_MODEL, input: texts };
  if (EMBEDDING_DIM > 0) body.dimensions = EMBEDDING_DIM;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${EMBEDDING_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`embedding request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

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

/** Ensure every visible note has a fresh embedding. No-op when disabled. */
export async function indexEmbeddings(): Promise<{ indexed: number; skipped: number }> {
  if (!embeddingsEnabled()) return { indexed: 0, skipped: 0 };
  const db = getDb();
  const notes = listNotes().filter((n) => n.kind !== "index");
  const missing = notes.filter((n) => {
    const row = db.prepare(`SELECT 1 AS x FROM note_embeddings WHERE note_id = ? AND model = ?`).get(n.id, EMBEDDING_MODEL);
    return !row;
  });
  if (missing.length === 0) return { indexed: 0, skipped: notes.length };

  const batch = 100;
  let indexed = 0;
  for (let i = 0; i < missing.length; i += batch) {
    const slice = missing.slice(i, i + batch);
    const full = slice.map((n) => getNote(n.id));
    const texts = full.map((n) => `${n?.title ?? ""}\n\n${stripFrontmatter(n?.content ?? "")}`.slice(0, 8000));
    const vectors = await embedTexts(texts);
    const upsert = db.prepare(`
      INSERT INTO note_embeddings (note_id, model, vector, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET model=excluded.model, vector=excluded.vector, updated_at=excluded.updated_at
    `);
    for (let k = 0; k < slice.length; k++) {
      upsert.run(slice[k].id, EMBEDDING_MODEL, JSON.stringify(vectors[k]), now());
      indexed++;
    }
  }
  return { indexed, skipped: notes.length - missing.length };
}

function storedVector(noteId: string): number[] | null {
  const row = getDb().prepare(`SELECT vector FROM note_embeddings WHERE note_id = ? AND model = ?`).get(noteId, EMBEDDING_MODEL) as
    | { vector: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.vector) as number[];
  } catch {
    return null;
  }
}

/** Cosine-similarity search over stored vectors. Returns note ids + scores. */
async function vectorSearch(query: string, limit: number): Promise<Array<{ id: string; score: number }>> {
  const [qvec] = await embedTexts([query]);
  const rows = getDb()
    .prepare(`SELECT note_id, vector FROM note_embeddings WHERE model = ?`)
    .all(EMBEDDING_MODEL) as Array<{ note_id: string; vector: string }>;
  const scored: Array<{ id: string; score: number }> = [];
  for (const r of rows) {
    let v: number[];
    try {
      v = JSON.parse(r.vector) as number[];
    } catch {
      continue;
    }
    const sim = cosine(qvec, v);
    if (sim > 0) scored.push({ id: r.note_id, score: sim });
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

const TITLE_WEIGHT = 4;

/** Trim content to roughly `budget` words around the best query-term hit. */
function trimmedSnippet(content: string, query: string, budget: number): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = content.toLowerCase();
  let best = -1;
  let bestCount = 0;
  for (const t of terms) {
    let idx = lower.indexOf(t);
    while (idx !== -1) {
      // count term occurrences forward to pick the densest window
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
    const vec = await vectorSearch(query, 50);
    rankings = [bm25, vec.map((v) => ({ id: v.id }))];
    vectorScores = new Map(vec.map((v) => [v.id, v.score]));
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
        // never return zero results on a tiny budget; force one best match
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

export function getEmbeddingStatus(): { enabled: boolean; provider: string; model: string; indexed: number } {
  const indexed = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM note_embeddings WHERE model = ?`)
    .get(EMBEDDING_MODEL) as { c: number };
  return {
    enabled: embeddingsEnabled(),
    provider: EMBEDDING_PROVIDER || "disabled",
    model: EMBEDDING_MODEL,
    indexed: indexed.c,
  };
}
