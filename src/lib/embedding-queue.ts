import { embeddingsEnabled } from "./embeddings";
import { bumpStoreVersion } from "./embedding-store";

// ---------- embedding write queue ----------
//
// Per-process, in-memory, debounced. notes.ts calls markStale() on write; the
// flush reaches note-reading code through a *dynamic* import so the static
// module graph stays acyclic (notes -> queue -> embeddings; queue -.-> index).
// The hash check in embedding-index is the process-agnostic backstop that
// catches edits made by the other process (web vs MCP).

const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 2000;
const MAX_BATCH = 100;

/** Queue a note for re-embedding. No-op (and no rows) when embeddings are off. */
export function markStale(noteId: string): void {
  if (!embeddingsEnabled()) return;
  bumpStoreVersion();
  dirty.add(noteId);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushEmbeddingQueue();
  }, FLUSH_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
}

/** Process the dirty set now. Returns how many notes were embedded. */
export async function flushEmbeddingQueue(): Promise<number> {
  if (!embeddingsEnabled() || dirty.size === 0) return 0;
  const ids = [...dirty].slice(0, MAX_BATCH);
  for (const id of ids) dirty.delete(id);
  const { refreshNotes } = await import("./embedding-index");
  const done = await refreshNotes(ids);
  if (dirty.size > 0) void flushEmbeddingQueue();
  return done;
}

export function pendingStaleCount(): number {
  return dirty.size;
}
