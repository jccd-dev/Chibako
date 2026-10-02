export interface NoteTreeNote {
  id: string;
  title: string;
  folder: string;
  kind: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  is_pinned: number;
  properties: Record<string, unknown>;
}

export interface NoteTreeFolder {
  name: string;
  [key: string]: unknown;
}

export interface NoteTreeData {
  notes: NoteTreeNote[];
  folders: NoteTreeFolder[];
}

const EMPTY: NoteTreeData = { notes: [], folders: [] };

export type TreeFetcher = () => Promise<unknown>;

export interface NoteTreeCache {
  /** The whole note tree, fetched at most once until something changes it. */
  read(): Promise<NoteTreeData>;
  /** Mark the tree stale: the next read refetches. */
  invalidate(): void;
}

/**
 * Navigation never changes the note tree — it only changes which note is open.
 * One shared cache keeps the tree off the per-navigation path while the
 * `chibako:notes-changed` event still refreshes every consumer after a write.
 */
export function createNoteTreeCache(fetcher: TreeFetcher): NoteTreeCache {
  let cached: NoteTreeData | null = null;
  let inFlight: Promise<NoteTreeData> | null = null;

  function fetchTree(): Promise<NoteTreeData> {
    const operation = (async () => {
      try {
        const response = (await fetcher()) as { ok?: boolean; notes?: NoteTreeNote[]; folders?: NoteTreeFolder[] };
        if (response.ok === false) throw new Error("notes request failed");
        const data: NoteTreeData = { notes: response.notes ?? [], folders: response.folders ?? [] };
        cached = data;
        return data;
      } catch {
        // Keep whatever is already on screen; a failed refresh is not a reason
        // to blank the sidebar.
        return cached ?? EMPTY;
      }
    })();
    const tracked = operation.then((data) => {
      if (inFlight === tracked) inFlight = null;
      return data;
    });
    inFlight = tracked;
    return tracked;
  }

  return {
    read(): Promise<NoteTreeData> {
      if (cached) return Promise.resolve(cached);
      if (inFlight) return inFlight;
      return fetchTree();
    },

    invalidate(): void {
      cached = null;
    },
  };
}

/** One cache per browser tab, shared by every component that lists notes. */
let sharedNoteTreeCache: NoteTreeCache | null = null;

export function noteTreeCache(fetcher: TreeFetcher): NoteTreeCache {
  if (!sharedNoteTreeCache) {
    sharedNoteTreeCache = createNoteTreeCache(fetcher);
    if (typeof window !== "undefined") {
      window.addEventListener("chibako:notes-changed", () => sharedNoteTreeCache?.invalidate());
    }
  }
  return sharedNoteTreeCache;
}
