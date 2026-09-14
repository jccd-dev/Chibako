import { getDb, now } from "../../lib/db";
import { markStale } from "../../lib/embedding-queue";
import {
  extractWikiLinks,
  resolveWikiTarget,
  stripFrontmatter,
  WIKILINK_RE,
} from "../../lib/markdown";

export interface ReferenceNote {
  id: string;
  title: string;
  folder: string;
}

/** Read the visible Note identities needed to resolve title/path Wikilinks. */
export function listReferenceNotes(): ReferenceNote[] {
  return getDb()
    .prepare("SELECT id, title, folder FROM notes WHERE deleted_at IS NULL ORDER BY folder, title")
    .all() as ReferenceNote[];
}

/** Rebuild all visible Note outbound Wikilinks after a bulk organization change. */
export function reindexVisibleLinks(): void {
  const db = getDb();
  const notes = listReferenceNotes();
  db.prepare("DELETE FROM links").run();
  const insert = db.prepare("INSERT OR REPLACE INTO links (source_id, target_title, target_id) VALUES (?,?,?)");
  const rows = db.prepare("SELECT id, content FROM notes WHERE deleted_at IS NULL").all() as Array<{ id: string; content: string }>;
  for (const note of rows) {
    for (const target of extractWikiLinks(stripFrontmatter(note.content))) {
      const resolved = resolveWikiTarget(target, notes);
      insert.run(note.id, target, resolved?.id ?? null);
    }
  }
}

/** Preserve resolved title/path links and aliases when Notes are organized. */
export function rewriteWikilinkReferences(
  before: readonly ReferenceNote[],
  changed: ReadonlyMap<string, ReferenceNote>,
): void {
  const db = getDb();
  for (const row of db.prepare("SELECT id, content FROM notes WHERE deleted_at IS NULL").all() as Array<{ id: string; content: string }>) {
    const content = row.content.replace(WIKILINK_RE, (token, inner: string) => {
      const [raw, ...alias] = inner.split("|");
      const target = raw.trim();
      const resolved = resolveWikiTarget(target, [...before]);
      const next = resolved && changed.get(resolved.id);
      if (!next) return token;
      const old = before.find((note) => note.id === resolved.id);
      if (!old) return token;
      const pathLink = target === `${old.folder}/${old.title}` && target !== old.title;
      const replacement = pathLink && next.folder ? `${next.folder}/${next.title}` : next.title;
      return `[[${replacement}${alias.length ? `|${alias.join("|")}` : ""}]]`;
    });
    if (content !== row.content) {
      db.prepare("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?").run(content, now(), row.id);
      db.prepare("UPDATE notes_fts SET content = ? WHERE id = ?").run(stripFrontmatter(content), row.id);
      markStale(row.id);
    }
  }
  reindexVisibleLinks();
}
