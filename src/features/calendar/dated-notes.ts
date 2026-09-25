import { listNotes } from "@/lib/notes";
import { datedNotes, type DatedNote } from "./note-dates";

export function listDatedNotes(): DatedNote[] {
  return datedNotes(listNotes());
}
