import { MaintenanceError, now } from "./db";
import { listNotes, getNote, type Note } from "./notes";
import {
  getEmbeddingProvider,
  embeddingInput,
  embeddingBatchSize,
  inputHash,
  BULK_REQUEST_TIMEOUT_MS,
  INPUT_VERSION,
  type EmbeddingProvider,
} from "./embeddings";
import {
  getEmbedding,
  putEmbedding,
  deleteOrphanEmbeddings,
  countEmbeddings,
  getMeta,
  setMeta,
  embedStoreVersion,
} from "./embedding-store";

// ---------- embedding index (orchestration) ----------
//
// Freshness model (docs/adr/0001): an embedding is fresh when its stored
// content_hash equals the hash of the note's current Embedding input, and its
// model / input_version / dimensions match the active Provider. Timestamps are
// never trusted for correctness.

const DEFAULT_MAX = 200;
const BREAKER_MS = 60_000;
const BREAKER_THRESHOLD = 3;
const QUERY_LATENCY_SAMPLES = 200;
const SCAN_TTL_MS = 10_000;

let consecutiveFailures = 0;
let breakerUntil = 0;

// Per-process guards so concurrent recalls/reindexes do not double-embed.
const inFlight = new Set<string>();
let reindexInFlight = false;

export interface ReindexResult {
  enabled: boolean;
  indexed: number;
  skipped: number;
  remaining: number;
}

export interface EmbeddingStatus {
  enabled: boolean;
  provider: string;
  model: string;
  dim: number;
  input_version: number;
  indexed: number;
  stale: number;
  total: number;
  /** Raw stored embedding rows (includes orphans before the next reindex). */
  rows: number;
  last_error: string | null;
  last_indexed_at: number | null;
  /** When the last Reindex run (scheduled or manual) ended. A later single-Note success does not change it or the two figures below. */
  last_repair_at: number | null;
  /** Notes with a fresh Embedding after that run. */
  repair_indexed: number;
  /** Notes still without one after that run. */
  repair_remaining: number;
  /** Recall queries the Provider could not embed in time, so Recall fell back to keywords. A call that failed while another call still answered is not counted here; see query_failures_rescued. */
  query_failures: { timeout: number; provider_error: number };
  /** Query calls that failed while another call still answered the query, so Recall kept its vectors. */
  query_failures_rescued: number;
  /** Recalls that fell back to keywords, by reason (disabled is configuration, not counted). */
  query_fallbacks: { timeout: number; provider_error: number; no_vectors: number };
  last_query_failure_reason: "timeout" | "provider_error" | null;
  last_query_failure_at: number | null;
  /** How long the Provider took to answer recent query Embeddings, including answers after the time limit. Calls that fail or never answer are not timed; see query_failures and query_failures_rescued. */
  query_latency: { samples: number; p50_ms: number | null; p95_ms: number | null; max_ms: number | null };
}

export type QueryFallbackReason = "timeout" | "provider_error" | "no_vectors";

/** Count a keyword fallback. Stores the reason and time only, never the query. */
export function recordQueryFallback(reason: QueryFallbackReason): void {
  const meta = getMeta();
  if (reason === "no_vectors") {
    setMeta({ query_no_vectors: meta.query_no_vectors + 1 });
    return;
  }
  setMeta(
    reason === "timeout"
      ? { query_timeouts: meta.query_timeouts + 1, last_query_failure_reason: reason, last_query_failure_at: now() }
      : { query_provider_errors: meta.query_provider_errors + 1, last_query_failure_reason: reason, last_query_failure_at: now() },
  );
}

/** Count a query call that failed while another call still answered the query. */
export function recordQueryRescue(): void {
  setMeta({ query_rescued_failures: getMeta().query_rescued_failures + 1 });
}

/** Keep one answer time. Stores the number only, never the query. */
export function recordQueryLatency(ms: number): void {
  setMeta({ query_latency_ms: [...getMeta().query_latency_ms, Math.round(ms)].slice(-QUERY_LATENCY_SAMPLES) });
}

function queryLatencyFigures(times: number[]): EmbeddingStatus["query_latency"] {
  const sorted = [...times].sort((a, b) => a - b);
  const nearestRank = (p: number) => sorted[Math.ceil((p / 100) * sorted.length) - 1] ?? null;
  return { samples: sorted.length, p50_ms: nearestRank(50), p95_ms: nearestRank(95), max_ms: sorted.at(-1) ?? null };
}

function isFresh(note: Note, provider: EmbeddingProvider): boolean {
  const stored = getEmbedding(note.id);
  if (!stored) return false;
  if (stored.model !== provider.model) return false;
  if (stored.input_version !== INPUT_VERSION) return false;
  if (provider.dim > 0 && stored.dim !== provider.dim) return false;
  return stored.content_hash === inputHash(embeddingInput(note));
}

interface Scan {
  total: number;
  indexed: number;
  staleIds: string[];
  freshIds: string[];
}

function scan(): Scan {
  const provider = getEmbeddingProvider();
  const summaries = listNotes();
  const staleIds: string[] = [];
  const freshIds: string[] = [];
  for (const s of summaries) {
    const note = getNote(s.id);
    if (!note) continue;
    if (!embeddingInput(note).trim()) continue; // nothing to embed
    if (provider && isFresh(note, provider)) freshIds.push(note.id);
    else staleIds.push(note.id);
  }
  return { total: staleIds.length + freshIds.length, indexed: freshIds.length, staleIds, freshIds };
}

// The scan hashes every note, so cache it briefly. The store version is bumped
// on every embedding mutation and on every markStale(), which invalidates the
// cache on writes; the TTL covers content changes that bypass markStale.
let scanCache: { version: number; at: number; value: Scan } | null = null;

function cachedScan(): Scan {
  const version = embedStoreVersion();
  const at = Date.now();
  if (scanCache && scanCache.version === version && at - scanCache.at < SCAN_TTL_MS) return scanCache.value;
  const value = scan();
  scanCache = { version, at, value };
  return value;
}

/**
 * Follow the active model / dimensions / input formula. Rows made under another one are never deleted here: they are stale
 * (isFresh), so vector search skips them and repair replaces each as its Note is re-embedded. Deleting would leave a Provider
 * that refuses calls with an empty index.
 */
function syncMeta(provider: EmbeddingProvider): void {
  const meta = getMeta();
  const changed =
    meta.model !== provider.model ||
    meta.input_version !== INPUT_VERSION ||
    (provider.dim > 0 && meta.dim !== provider.dim);
  if (changed) {
    setMeta({ model: provider.model, dim: provider.dim, input_version: INPUT_VERSION, query_latency_ms: [] });
  }
}

/** A hung Provider call must not hold the in-flight guards forever: fail it so later repair ticks run. */
function withTimeout<T>(call: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`embedding request timed out after ${ms} ms`)), ms);
  });
  return Promise.race([call, limit]).finally(() => clearTimeout(timer));
}

/** Embed the given note ids. Provider failures are recorded, not thrown; a maintenance fence (MaintenanceError) propagates. */
export async function refreshNotes(ids: string[]): Promise<number> {
  const provider = getEmbeddingProvider();
  if (!provider || ids.length === 0) return 0;
  if (Date.now() < breakerUntil) return 0;

  let done = 0;
  const batch = embeddingBatchSize();
  for (let i = 0; i < ids.length; i += batch) {
    const slice = ids.slice(i, i + batch);
    const valid: string[] = [];
    const inputs: string[] = [];
    const hashes: string[] = [];
    for (const id of slice) {
      if (inFlight.has(id)) continue;
      const note = getNote(id);
      if (!note) continue;
      if (isFresh(note, provider)) continue; // hash unchanged — skip the provider call
      const input = embeddingInput(note);
      inputs.push(input.slice(0, 8000)); // provider safety cap
      hashes.push(inputHash(input));
      valid.push(id);
    }
    if (!valid.length) continue;
    for (const id of valid) inFlight.add(id);
    try {
      const vectors = await withTimeout(provider.embed(inputs), BULK_REQUEST_TIMEOUT_MS);
      for (let k = 0; k < valid.length; k++) {
        const vec = vectors[k];
        if (!vec) continue;
        putEmbedding({
          note_id: valid[k],
          model: provider.model,
          vector: vec,
          content_hash: hashes[k],
          dim: vec.length,
          input_version: INPUT_VERSION,
        });
        done++;
      }
      consecutiveFailures = 0;
      setMeta({ last_error: null, last_indexed_at: now() });
    } catch (e) {
      if (e instanceof MaintenanceError) throw e; // a maintenance fence is not a provider failure
      consecutiveFailures++;
      const message = e instanceof Error ? e.message : String(e);
      setMeta({ last_error: message.slice(0, 300) });
      if (consecutiveFailures >= BREAKER_THRESHOLD) {
        breakerUntil = Date.now() + BREAKER_MS;
        consecutiveFailures = 0; // next failure after the pause starts a fresh count
      }
      break;
    } finally {
      for (const id of valid) inFlight.delete(id);
    }
  }
  return done;
}

/** Backfill/reindex, capped per call so callers can loop on `remaining`. */
export async function reindexEmbeddings(opts: { max?: number } = {}): Promise<ReindexResult> {
  const provider = getEmbeddingProvider();
  if (!provider) return { enabled: false, indexed: 0, skipped: 0, remaining: 0 };
  if (reindexInFlight) {
    const current = cachedScan();
    return { enabled: true, indexed: 0, skipped: current.indexed, remaining: current.staleIds.length };
  }
  reindexInFlight = true;
  try {
    syncMeta(provider);
    deleteOrphanEmbeddings();
    const current = scan();
    const take = current.staleIds.slice(0, opts.max ?? DEFAULT_MAX);
    const indexed = await refreshNotes(take);
    setMeta({ last_repair_at: now(), repair_indexed: current.indexed + indexed, repair_remaining: current.staleIds.length - indexed });
    return {
      enabled: true,
      indexed,
      skipped: current.indexed,
      remaining: Math.max(0, current.staleIds.length - take.length),
    };
  } finally {
    reindexInFlight = false;
  }
}

/** Ids whose embedding is missing or stale, capped. */
export function staleNoteIds(limit = 20): string[] {
  if (!getEmbeddingProvider()) return [];
  return cachedScan().staleIds.slice(0, limit);
}

/** Ids whose stored embedding is currently usable (fresh + matching model). */
export function freshEmbeddingIds(): Set<string> {
  if (!getEmbeddingProvider()) return new Set();
  return new Set(cachedScan().freshIds);
}

export function embeddingStatus(): EmbeddingStatus {
  const provider = getEmbeddingProvider();
  const meta = getMeta();
  const current = provider ? cachedScan() : { total: listNotes().length, indexed: 0, staleIds: [] as string[] };
  const query_failures = { timeout: meta.query_timeouts, provider_error: meta.query_provider_errors };
  return {
    enabled: Boolean(provider),
    provider: provider?.id ?? "disabled",
    model: provider?.model ?? meta.model,
    dim: provider?.dim || meta.dim,
    input_version: INPUT_VERSION,
    indexed: provider ? current.indexed : 0,
    stale: provider ? current.staleIds.length : 0,
    total: current.total,
    rows: countEmbeddings(),
    last_error: meta.last_error,
    last_indexed_at: meta.last_indexed_at,
    last_repair_at: meta.last_repair_at,
    repair_indexed: meta.repair_indexed,
    repair_remaining: meta.repair_remaining,
    query_failures,
    query_failures_rescued: meta.query_rescued_failures,
    query_fallbacks: { ...query_failures, no_vectors: meta.query_no_vectors },
    last_query_failure_reason: meta.last_query_failure_reason,
    last_query_failure_at: meta.last_query_failure_at,
    query_latency: queryLatencyFigures(meta.query_latency_ms),
  };
}
