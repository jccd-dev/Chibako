"use client";

import { createContext, useContext, useLayoutEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { Note } from "@/lib/notes";
import { NoteClient, type ViewMode } from "@/features/notes/components/NoteClient";
import { LoadingStatus } from "@/components/LoadingStatus";

interface NoteRouteData {
  initial: Note | null;
  draftDate?: string;
  initialView?: ViewMode;
}

const NoteRouteContext = createContext<{
  setRoute: Dispatch<SetStateAction<NoteRouteData | null>>;
  setOpening: Dispatch<SetStateAction<boolean>>;
  hasDocument: boolean;
} | null>(null);

/** Owned by the static note layout, outside the changing [id] page segment. */
export function NoteWorkspace({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<NoteRouteData | null>(null);
  const [opening, setOpening] = useState(false);
  return (
    <NoteRouteContext.Provider value={{ setRoute, setOpening, hasDocument: route !== null }}>
      {children}
      {route && <NoteClient initial={route.initial} draftDate={route.draftDate} initialView={route.initialView} opening={opening} />}
    </NoteRouteContext.Provider>
  );
}

/** The server page supplies only the selected document, never editor ownership. */
export function NoteRoute({ initial, draftDate, initialView }: NoteRouteData) {
  const workspace = useContext(NoteRouteContext);
  if (!workspace) throw new Error("NoteRoute requires NoteWorkspace");
  const { setRoute } = workspace;
  useLayoutEffect(() => {
    setRoute({ initial, draftDate, initialView });
  }, [setRoute, initial, draftDate, initialView]);
  return null;
}

/** The note index has no document: drop the editor left by the previous note. */
export function NoNoteRoute() {
  const workspace = useContext(NoteRouteContext);
  if (!workspace) throw new Error("NoNoteRoute requires NoteWorkspace");
  const { setRoute } = workspace;
  useLayoutEffect(() => {
    setRoute(null);
  }, [setRoute]);
  return null;
}

export function NoteRouteLoading() {
  const workspace = useContext(NoteRouteContext);
  if (!workspace) throw new Error("NoteRouteLoading requires NoteWorkspace");
  const { setOpening, hasDocument } = workspace;
  useLayoutEffect(() => {
    setOpening(true);
    return () => setOpening(false);
  }, [setOpening]);
  return hasDocument ? null : <LoadingStatus size={96} className="h-full flex-col justify-center p-6">Opening note…</LoadingStatus>;
}
