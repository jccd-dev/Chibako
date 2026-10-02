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
  /** Links and mentions for a note: one round trip each, in parallel, cached per note. */
  load(noteId: string): Promise<NoteDetailData>;
  /** Drop one note's cached detail, or all of it when no id is given. */
  invalidate(noteId?: string): void;
}

interface DetailResult {
  data: NoteDetailData;
  /** At least one endpoint failed, so this is not worth remembering. */
  partial: boolean;
}

async function readJson<T>(fetcher: DetailFetcher, url: string, fallback: T): Promise<{ value: T; ok: boolean }> {
  try {
    const response = (await fetcher(url)) as { ok?: boolean };
    if (response.ok === false) return { value: fallback, ok: false };
    return { value: (response as T) ?? fallback, ok: true };
  } catch {
    // A failed endpoint must not blank out the panel the user is reading.
    return { value: fallback, ok: false };
  }
}

/**
 * The right-hand details panel needs two endpoints per note. Fetching them in
 * parallel behind a per-note cache means a note switch costs one round trip
 * for a note seen for the first time and none at all for one already visited.
 */
export function createNoteDetailClient(fetcher: DetailFetcher): NoteDetailClient {
  const cache = new Map<string, NoteDetailData>();
  const inFlight = new Map<string, Promise<NoteDetailData>>();
  // A load that was already running when the note changed must not put its
  // stale answer back into the cache after the invalidation.
  let generation = 0;

  async function fetchDetail(noteId: string): Promise<DetailResult> {
    const [links, mentions] = await Promise.all([
      readJson<LinkInfo>(fetcher, `/api/notes/${noteId}/links`, EMPTY_LINKS),
      readJson<{ mentions?: MentionInfo[] }>(fetcher, `/api/notes/${noteId}/mentions`, { mentions: [] }),
    ]);
    return {
      data: { links: links.value, mentions: mentions.value.mentions ?? [] },
      partial: !links.ok || !mentions.ok,
    };
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
