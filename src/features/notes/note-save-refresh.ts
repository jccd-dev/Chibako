import type { Note } from "../../lib/notes";
import { extractWikiLinks } from "../../lib/markdown";

export function noteSaveRefreshChanges(previous: Note | null, saved: Note) {
  const links = (note: Note) => JSON.stringify(extractWikiLinks(note.content).sort());
  return {
    tree: !previous || previous.title !== saved.title || previous.folder !== saved.folder ||
      previous.kind !== saved.kind || previous.is_pinned !== saved.is_pinned ||
      JSON.stringify(previous.properties) !== JSON.stringify(saved.properties),
    details: !previous || previous.title !== saved.title || links(previous) !== links(saved),
    // Text edits can change another note's mention matches or backlink snippets,
    // even when this note's own link-set did not change.
    invalidateDetails: !previous || previous.title !== saved.title ||
      previous.content !== saved.content || previous.folder !== saved.folder,
  };
}
