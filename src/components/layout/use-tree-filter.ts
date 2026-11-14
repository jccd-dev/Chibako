"use client";

import { useMemo } from "react";
import { parseSearchQuery } from "@/features/notes/search-query";
import { useNoteSearch } from "@/features/notes/use-note-search";

const ancestorsOf = (folder: string) => {
  const parts = folder.split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};
const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

export interface TreeFilterView {
  showNote(note: { id: string; folder: string }): boolean;
  showFolder(path: string): boolean;
  /** Folders shown open for the filter only; the user's expanded set is untouched. */
  open: Set<string>;
  empty: boolean;
}

/**
 * The file tree narrowed by search-box syntax: matching notes with their
 * ancestor folders, or a whole folder subtree for `folder:` alone.
 */
export function useTreeFilter(filter: string, notes: { id: string; folder: string }[], folders: string[]) {
  const parsed = useMemo(() => parseSearchQuery(filter), [filter]);
  const typed = parsed.folder !== undefined && !parsed.text.trim() ? parsed.folder : null;
  // Folder names match regardless of case, like the search route; show the real path.
  const focus = typed === null ? null : folders.find((f) => f.toLowerCase() === typed.toLowerCase()) ?? typed;
  // A bare `folder:` filter needs no search; the tree already holds the subtree.
  const { results, busy } = useNoteSearch(focus === null ? filter : "");

  return useMemo((): TreeFilterView | null => {
    if (!filter.trim()) return null;
    if (focus !== null) {
      const open = new Set(ancestorsOf(focus));
      return {
        showNote: (note) => inside(note.folder, focus),
        showFolder: (path) => open.has(path) || inside(path, focus),
        open,
        empty: !folders.some((f) => f === focus),
      };
    }
    const ids = new Set(results.map((r) => r.id));
    const open = new Set(results.flatMap((r) => ancestorsOf(r.folder)));
    return {
      showNote: (note) => ids.has(note.id),
      showFolder: (path) => open.has(path),
      open,
      empty: !busy && !notes.some((n) => ids.has(n.id)),
    };
  }, [filter, focus, results, busy, notes, folders]);
}
