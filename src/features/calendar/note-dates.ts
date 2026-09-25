import type { NoteSummary } from "@/lib/notes";

export interface DatedNote extends NoteSummary {
  date: string;
}

function localDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date;
}

export function isNoteDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = localDate(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function dateToNoteDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function noteDateToDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return localDate(year, month, day);
}

export function datedNotes(notes: NoteSummary[]): DatedNote[] {
  return notes.flatMap((note) => {
    const date = note.properties.date;
    return isNoteDate(date) ? [{ ...note, date }] : [];
  });
}

export function sortDatedNotes(notes: DatedNote[]): DatedNote[] {
  return [...notes].sort((a, b) =>
    b.is_pinned - a.is_pinned ||
    a.title.localeCompare(b.title) ||
    a.folder.localeCompare(b.folder) ||
    a.id.localeCompare(b.id)
  );
}
