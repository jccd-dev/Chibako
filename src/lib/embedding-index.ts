import { now } from "./db";
import { listNotes, getNote, type Note } from "./notes";
import {
  getEmbeddingProvider,
  embeddingInput,
  inputHash,
  INPUT_VERSION,
  type EmbeddingProvider,
} from "./embeddings";
import {
  getEmbedding,
  putEmbedding,
  deleteAllEmbeddings,
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

const BATCH = 100;
const DEFAULT_MAX = 200;
const BREAKER_MS = 60_000;
const BREAKER_THRESHOLD = 3;
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

/** Wipe and reset when the active model / dimensions / input formula changed. */
function syncMeta(provider: EmbeddingProvider): void {
  const meta = getMeta();
  const changed =
    meta.model !== provider.model ||
    meta.input_version !== INPUT_VERSION ||
    (provider.dim > 0 && meta.dim !== provider.dim);
  if (changed) {
    deleteAllEmbeddings();
    setMeta({ model: provider.model, dim: provider.dim, input_version: INPUT_VERSION });
  }
}

/** Embed the given note ids. Never throws; records failure state instead. */
export async function refreshNotes(ids: string[]): Promise<number> {
  const provider = getEmbeddingProvider();
  if (!provider || ids.length === 0) return 0;
  if (Date.now() < breakerUntil) return 0;

  let done = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
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
      const vectors = await provider.embed(inputs);
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
  };
}
