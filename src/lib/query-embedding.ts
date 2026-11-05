import { envInt, type EmbeddingProvider } from "./embeddings";

// ---------- query embedding: time limit + small cache ----------

// Must stay under the memory hook's 5000 ms request limit (scripts/memory/connection.ts) with room for the rest of Recall; tests/automatic-memory holds that.
const DEFAULT_TIMEOUT_MS = 4000;
export const MAX_TIMEOUT_MS = 30000;
// From laptop measurements of a real Provider: delays up to 2000 ms rescued about the same number of calls, later ones fewer. Recheck against server figures.
const DEFAULT_RETRY_DELAY_MS = 1500;
export const QUERY_CACHE_MAX = 200;
export const QUERY_CACHE_TTL_MS = 60 * 60 * 1000;
export const QUERY_CACHE_MAX_CHARS = 1000; // longer queries are embedded but not cached, so keys stay small

export class QueryEmbedTimeout extends Error {
  constructor() {
    super("Query embedding timed out");
  }
}

/** CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS: positive integer up to 30000, otherwise the 4000 ms default. Read lazily so tests can toggle it. */
export function queryEmbedTimeoutMs(): number {
  return envInt("CHIBAKO_EMBEDDING_QUERY_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
}

/** CHIBAKO_EMBEDDING_QUERY_RETRY_MS: wait before the one extra call. 0 turns it off; anything else invalid gives the 1500 ms default. */
export function queryRetryDelayMs(): number {
  return envInt("CHIBAKO_EMBEDDING_QUERY_RETRY_MS", DEFAULT_RETRY_DELAY_MS, 0, MAX_TIMEOUT_MS);
}

// Insertion-ordered Map, so the oldest entry is evicted first (FIFO, not LRU).
const cache = new Map<string, { vec: number[]; at: number }>();

export function clearQueryEmbeddingCache(): void {
  cache.clear();
}

function cacheKey(p: EmbeddingProvider, text: string): string | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > QUERY_CACHE_MAX_CHARS ? null : [p.id, p.model, p.dim, normalized].join("\0");
}

/**
 * Embeds one query within the time limit. If the Provider has not answered after the retry delay, one extra call is made
 * and the first answer wins; a failed call only fails the query once no other call is running. A call that fails before
 * the delay is not retried. Calls that finish after the limit still fill the cache, so the same query is instant next
 * time; failed calls are never cached. `onAnswer` gets each Provider answer's time, late and losing answers included;
 * cache hits and failed calls make no report. `onRescue` is called once for each call that failed while another call still answered
 * the query, whichever failed first.
 */
export async function embedQuery(
  provider: EmbeddingProvider,
  text: string,
  onAnswer?: (ms: number) => void,
  onRescue?: () => void,
): Promise<number[] | undefined> {
  const key = cacheKey(provider, text);
  const hit = key === null ? undefined : cache.get(key);
  if (key !== null && hit) {
    if (Date.now() - hit.at < QUERY_CACHE_TTL_MS) return hit.vec;
    cache.delete(key);
  }
  const callProvider = async () => {
    const started = performance.now();
    const [vec] = await provider.embed([text]);
    onAnswer?.(performance.now() - started);
    if (vec && key !== null) {
      cache.delete(key);
      cache.set(key, { vec, at: Date.now() });
      if (cache.size > QUERY_CACHE_MAX) cache.delete(cache.keys().next().value as string);
    }
    return vec;
  };
  let answered = false;
  let failedCalls = 0; // failed before any call answered
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const vec = await Promise.race([
      new Promise<number[] | undefined>((resolve, reject) => {
        let running = 0;
        const start = () => {
          running++;
          callProvider().then((vec) => {
            answered = true;
            resolve(vec);
          }, (e) => {
            if (answered) onRescue?.(); // another call already answered, so this failure cost nothing
            else failedCalls++;
            if (--running === 0) reject(e);
          });
        };
        start();
        const delay = queryRetryDelayMs();
        if (delay > 0) retryTimer = setTimeout(start, delay);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new QueryEmbedTimeout()), queryEmbedTimeoutMs());
      }),
    ]);
    if (vec) for (let i = 0; i < failedCalls; i++) onRescue?.();
    return vec;
  } finally {
    clearTimeout(timer);
    clearTimeout(retryTimer);
  }
}
