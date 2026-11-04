import type { EmbeddingProvider } from "./embeddings";

// ---------- query embedding: time limit + small cache ----------

const DEFAULT_TIMEOUT_MS = 6000;
const MAX_TIMEOUT_MS = 30000;
export const QUERY_CACHE_MAX = 200;
export const QUERY_CACHE_TTL_MS = 60 * 60 * 1000;

export class QueryEmbedTimeout extends Error {
  constructor() {
    super("Query embedding timed out");
  }
}

/** CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS: positive integer up to 30000, otherwise the 6000 ms default. Read lazily so tests can toggle it. */
export function queryEmbedTimeoutMs(): number {
  const raw = (process.env.CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS ?? "").trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return n >= 1 && n <= MAX_TIMEOUT_MS ? n : DEFAULT_TIMEOUT_MS;
}

// Insertion-ordered Map, so the oldest entry is evicted first (FIFO, not LRU).
const cache = new Map<string, { vec: number[]; at: number }>();

export function clearQueryEmbeddingCache(): void {
  cache.clear();
}

function cacheKey(p: EmbeddingProvider, text: string): string {
  return [p.id, p.model, p.dim, text.trim().replace(/\s+/g, " ")].join("\0");
}

/**
 * Embeds one query within the time limit. A call that finishes after the limit still fills the cache,
 * so the same query is instant next time; failed calls are never cached.
 */
export async function embedQuery(provider: EmbeddingProvider, text: string): Promise<number[] | undefined> {
  const key = cacheKey(provider, text);
  const hit = cache.get(key);
  if (hit) {
    if (Date.now() - hit.at < QUERY_CACHE_TTL_MS) return hit.vec;
    cache.delete(key);
  }
  const call = provider.embed([text]).then(([vec]) => {
    if (vec) {
      cache.delete(key);
      cache.set(key, { vec, at: Date.now() });
      if (cache.size > QUERY_CACHE_MAX) cache.delete(cache.keys().next().value as string);
    }
    return vec;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new QueryEmbedTimeout()), queryEmbedTimeoutMs());
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
