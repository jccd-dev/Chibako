"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Note } from "@/lib/notes";

const SavedNotesContext = createContext<Map<string, Note> | null>(null);

/** Keep this tab's saves across navigation outside the Notes workspace. */
export function SavedNotesProvider({ children }: { children: ReactNode }) {
  const [notes] = useState(() => new Map<string, Note>());
  return <SavedNotesContext.Provider value={notes}>{children}</SavedNotesContext.Provider>;
}

export function useSavedNotes() {
  const notes = useContext(SavedNotesContext);
  if (!notes) throw new Error("useSavedNotes requires SavedNotesProvider");
  return notes;
}
