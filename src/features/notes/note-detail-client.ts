export interface LinkInfo {
  outlinks: Array<{ target: string; target_id: string | null; resolved: boolean }>;
  backlinks: Array<{ id: string; title: string; folder: string; snippet: string }>;
}

export interface MentionInfo {
  id: string;
  title: string;
  folder: string;
  snippet: string;
}

export interface NoteDetailData {
  links: LinkInfo;
  mentions: MentionInfo[];
}

const EMPTY_LINKS: LinkInfo = { outlinks: [], backlinks: [] };

export type DetailFetcher = (url: string) => Promise<unknown>;

export interface NoteDetailClient {
  /** Links and mentions in one request, cached per note. */
  load(noteId: string): Promise<NoteDetailData>;
  /** Drop one note's cached detail, or all of it when no id is given. */
  invalidate(noteId?: string): void;
}

interface DetailResult {
  data: NoteDetailData;
  partial: boolean;
}

/** A cold note costs one request; revisits use the same per-editor cache. */
export function createNoteDetailClient(fetcher: DetailFetcher): NoteDetailClient {
  const cache = new Map<string, NoteDetailData>();
  const inFlight = new Map<string, Promise<NoteDetailData>>();
  // A load that was already running when the note changed must not put its
  // stale answer back into the cache after the invalidation.
  let generation = 0;

  async function fetchDetail(noteId: string): Promise<DetailResult> {
    try {
      const response = await fetcher(`/api/notes/${noteId}/links?include=mentions`) as
        (Partial<LinkInfo> & { ok?: boolean; mentions?: MentionInfo[] }) | null;
      if (!response || response.ok === false) throw new Error("Note detail request failed");
      const complete = Array.isArray(response.outlinks) && Array.isArray(response.backlinks) && Array.isArray(response.mentions);
      return {
        data: {
          links: { outlinks: response.outlinks ?? [], backlinks: response.backlinks ?? [] },
          mentions: response.mentions ?? [],
        },
        partial: !complete,
      };
    } catch {
      return { data: { links: EMPTY_LINKS, mentions: [] }, partial: true };
    }
  }

  return {
    load(noteId: string): Promise<NoteDetailData> {
      const cached = cache.get(noteId);
      if (cached) return Promise.resolve(cached);
      const pending = inFlight.get(noteId);
      if (pending) return pending;
      const startedAt = generation;
      const operation = fetchDetail(noteId).then(({ data, partial }) => {
        if (inFlight.get(noteId) === operation) inFlight.delete(noteId);
        // Caching a half-empty panel would keep it empty for the whole session,
        // and an answer that predates an invalidation is already out of date.
        if (!partial && startedAt === generation) cache.set(noteId, data);
        return data;
      });
      inFlight.set(noteId, operation);
      return operation;
    },

    invalidate(noteId?: string): void {
      generation += 1;
      if (noteId === undefined) {
        cache.clear();
        inFlight.clear();
        return;
      }
      cache.delete(noteId);
      inFlight.delete(noteId);
    },
  };
}
