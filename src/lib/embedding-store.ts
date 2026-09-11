import { getDb, now } from "./db";

// ---------- embedding store (DB-only) ----------
//
// Owns every read/write of note_embeddings and the `embedding_meta` setting.
// It deliberately knows nothing about notes or providers, so notes.ts can
// import it for cleanup without creating a cycle.

export interface StoredEmbedding {
  note_id: string;
  model: string;
  vector: number[];
  content_hash: string;
  dim: number;
  input_version: number;
  updated_at: number;
}

export interface EmbeddingMeta {
  model: string;
  dim: number;
  input_version: number;
  last_error: string | null;
  last_indexed_at: number | null;
}

const META_KEY = "embedding_meta";
const EMPTY_META: EmbeddingMeta = { model: "", dim: 0, input_version: 0, last_error: null, last_indexed_at: null };

// Monotonic counter bumped on every mutation. The index uses it to invalidate
// its short-lived scan cache without re-hashing the whole vault.
let storeVersion = 0;
export function embedStoreVersion(): number {
  return storeVersion;
}
export function bumpStoreVersion(): void {
  storeVersion++;
}

interface EmbeddingRow {
  note_id: string;
  model: string;
  vector: string;
  content_hash: string;
  dim: number;
  input_version: number;
  updated_at: number;
}

function toStored(row: EmbeddingRow): StoredEmbedding | null {
  try {
    const vector = JSON.parse(row.vector) as number[];
    if (!Array.isArray(vector)) return null;
    return { ...row, vector };
  } catch {
    return null;
  }
}

export function getEmbedding(noteId: string): StoredEmbedding | null {
  const row = getDb().prepare(`SELECT * FROM note_embeddings WHERE note_id = ?`).get(noteId) as EmbeddingRow | undefined;
  return row ? toStored(row) : null;
}

export function listEmbeddings(): StoredEmbedding[] {
  const rows = getDb().prepare(`SELECT * FROM note_embeddings`).all() as EmbeddingRow[];
  return rows.map(toStored).filter((e): e is StoredEmbedding => e !== null);
}

export function putEmbedding(e: Omit<StoredEmbedding, "updated_at"> & { updated_at?: number }): void {
  getDb()
    .prepare(`
      INSERT INTO note_embeddings (note_id, model, vector, content_hash, dim, input_version, updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(note_id) DO UPDATE SET
        model=excluded.model, vector=excluded.vector, content_hash=excluded.content_hash,
        dim=excluded.dim, input_version=excluded.input_version, updated_at=excluded.updated_at
    `)
    .run(e.note_id, e.model, JSON.stringify(e.vector), e.content_hash, e.dim, e.input_version, e.updated_at ?? now());
  bumpStoreVersion();
}

export function deleteEmbedding(noteId: string): void {
  getDb().prepare(`DELETE FROM note_embeddings WHERE note_id = ?`).run(noteId);
  bumpStoreVersion();
}

export function deleteAllEmbeddings(): void {
  getDb().prepare(`DELETE FROM note_embeddings`).run();
  bumpStoreVersion();
}

/** Remove embeddings whose note no longer exists (best-effort housekeeping). */
export function deleteOrphanEmbeddings(): number {
  const res = getDb()
    .prepare(`DELETE FROM note_embeddings WHERE note_id NOT IN (SELECT id FROM notes)`)
    .run();
  if (res.changes > 0) bumpStoreVersion();
  return res.changes;
}

export function countEmbeddings(): number {
  return (getDb().prepare(`SELECT COUNT(*) AS c FROM note_embeddings`).get() as { c: number }).c;
}

export function getMeta(): EmbeddingMeta {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(META_KEY) as { value: string } | undefined;
  if (!row) return { ...EMPTY_META };
  try {
    const parsed = JSON.parse(row.value) as Partial<EmbeddingMeta>;
    return { ...EMPTY_META, ...parsed };
  } catch {
    return { ...EMPTY_META };
  }
}

export function setMeta(patch: Partial<EmbeddingMeta>): EmbeddingMeta {
  const next = { ...getMeta(), ...patch };
  getDb()
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(META_KEY, JSON.stringify(next));
  return next;
}
