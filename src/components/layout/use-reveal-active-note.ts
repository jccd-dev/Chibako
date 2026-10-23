import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";

/** Expand the open note's folders and scroll its row into view, once per note (like VS Code's explorer). */
export function useRevealActiveNote(
  pathname: string,
  notes: { id: string; folder: string }[],
  setExpanded: Dispatch<SetStateAction<Set<string>>>,
  treeRef: RefObject<HTMLElement | null>,
) {
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    const id = pathname.match(/^\/app\/note\/([^/]+)$/)?.[1];
    const note = id ? notes.find(n => n.id === id) : undefined;
    if (!id || !note || revealed.current === id) return;
    revealed.current = id;
    const parts = note.folder.split("/").filter(Boolean);
    const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    if (ancestors.length) setExpanded(prev => new Set([...prev, ...ancestors]));
    const frame = requestAnimationFrame(() =>
      treeRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [pathname, notes, setExpanded, treeRef]);
}
