"use client";

import { createContext, useContext, useLayoutEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { Note } from "@/lib/notes";
import { NoteClient, type ViewMode } from "@/features/notes/components/NoteClient";

interface NoteRouteData {
  initial: Note | null;
  draftDate?: string;
  initialView?: ViewMode;
}

const NoteRouteContext = createContext<Dispatch<SetStateAction<NoteRouteData | null>> | null>(null);

/** Owned by the static note layout, outside the changing [id] page segment. */
export function NoteWorkspace({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<NoteRouteData | null>(null);
  return (
    <NoteRouteContext.Provider value={setRoute}>
      {children}
      {route && <NoteClient initial={route.initial} draftDate={route.draftDate} initialView={route.initialView} />}
    </NoteRouteContext.Provider>
  );
}

/** The server page supplies only the selected document, never editor ownership. */
export function NoteRoute({ initial, draftDate, initialView }: NoteRouteData) {
  const setRoute = useContext(NoteRouteContext);
  if (!setRoute) throw new Error("NoteRoute requires NoteWorkspace");
  useLayoutEffect(() => {
    setRoute({ initial, draftDate, initialView });
  }, [setRoute, initial, draftDate, initialView]);
  return null;
}
