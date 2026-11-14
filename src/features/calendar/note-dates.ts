import type { NoteSummary } from "@/lib/notes";

export interface DatedNote extends NoteSummary {
  date: string;
  /** Inclusive last day; equals `date` for single-day Notes. */
  endDate: string;
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
    if (!isNoteDate(date)) return [];
    const end = note.properties.end_date;
    // ISO date strings compare chronologically; an invalid or earlier end falls back to one day.
    const endDate = isNoteDate(end) && end > date ? end : date;
    return [{ ...note, date, endDate }];
  });
}

/** Which part of a calendar pill is dragged: the whole range or one edge. */
export type DragMode = "move" | "start" | "end";

/** Frontmatter values for a rescheduled range; `end_date: null` removes it for a single day. */
export interface NoteDateRange {
  date: string;
  end_date: string | null;
}

function addDays(day: string, days: number): string {
  const date = noteDateToDate(day);
  date.setDate(date.getDate() + days);
  return dateToNoteDate(date);
}

/** Range after dragging `mode` from day `from` to day `to`; an edge never passes the other edge. */
export function rescheduleRange(note: { date: string; endDate: string }, mode: DragMode, from: string, to: string): NoteDateRange {
  let { date, endDate } = note;
  if (mode === "move") {
    // Rounding absorbs DST hours between local midnights.
    const days = Math.round((noteDateToDate(to).getTime() - noteDateToDate(from).getTime()) / 86_400_000);
    date = addDays(date, days);
    endDate = addDays(endDate, days);
  } else if (mode === "start") {
    date = to < endDate ? to : endDate;
  } else {
    endDate = to > date ? to : date;
  }
  return { date, end_date: endDate > date ? endDate : null };
}

export function coversDate(note: DatedNote, day: string): boolean {
  return note.date <= day && day <= note.endDate;
}

export function sortDatedNotes(notes: DatedNote[]): DatedNote[] {
  return [...notes].sort((a, b) =>
    b.is_pinned - a.is_pinned ||
    a.title.localeCompare(b.title) ||
    a.folder.localeCompare(b.folder) ||
    a.id.localeCompare(b.id)
  );
}
