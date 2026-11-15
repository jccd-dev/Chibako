import type { NoteSummary } from "@/lib/notes";
import { coversDate, datedNotes, dateToNoteDate, noteDateToDate, sortDatedNotes, type DatedNote } from "@/features/calendar/note-dates";
import { inFolder, isTask } from "@/features/calendar/task-folder";
import { groupByStatus } from "@/features/calendar/task-table";

/** Vault settings Home needs beside the Notes themselves. */
export interface HomeContext {
  statusOptions: string[];
  /** Bookmarked Notes in display order. */
  bookmarks: { note_id: string; label: string }[];
  /** Agent memory folder; null when automatic memory is off. */
  memoryFolder: string | null;
  /** Managed bookkeeping Notes (Agent Now, Activity) that are not agent work. */
  bookkeepingIds: string[];
}

export interface HomeSummary {
  notes: number;
  tasks: number;
  openTasks: number;
  /** Open tasks scheduled on `today`. */
  dueToday: number;
  /** Open tasks whose last day is before `today`, oldest first. */
  overdue: DatedNote[];
  /** Every dated Note covering `today`, finished tasks included. */
  today: DatedNote[];
  /** Unfinished dated Notes starting in the six days after `today`. */
  upcoming: DatedNote[];
  /** Tasks per status in Status choice order; "" is no status. */
  statuses: { status: string; count: number }[];
  /** Pinned Notes, then bookmarks under their label. */
  quick: { id: string; title: string; folder: string }[];
  /** Latest agent memory Notes with their project ("" at the area root); null when memory is off. */
  agent: { note: NoteSummary; project: string }[] | null;
  /** Notes created on `today` or the six days before it. */
  createdThisWeek: number;
  /** Latest edits outside agent memory. */
  recent: NoteSummary[];
}

export function isDone(note: NoteSummary): boolean {
  return String(note.properties.status ?? "").toLowerCase() === "done";
}

function addDays(day: string, days: number): string {
  const date = noteDateToDate(day);
  date.setDate(date.getDate() + days);
  return dateToNoteDate(date);
}

/** Home dashboard figures for the viewer's local `today` (YYYY-MM-DD). */
export function summarizeHome(notes: NoteSummary[], today: string, context: HomeContext): HomeSummary {
  const dated = datedNotes(notes);
  const pending = dated.filter((note) => !(isTask(note) && isDone(note)));
  const tasks = notes.filter(isTask);
  const byDate = (a: DatedNote, b: DatedNote) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
  const latest = (list: NoteSummary[]) => [...list].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5);

  const { memoryFolder } = context;
  const inMemory = (note: NoteSummary) => memoryFolder !== null && inFolder(note.folder, memoryFolder);
  const bookkeeping = new Set(context.bookkeepingIds);

  const byId = new Map(notes.map((note) => [note.id, note]));
  const quick = new Map<string, HomeSummary["quick"][number]>();
  for (const note of notes) if (note.is_pinned) quick.set(note.id, { id: note.id, title: note.title, folder: note.folder });
  for (const bookmark of context.bookmarks) {
    const note = byId.get(bookmark.note_id);
    if (note && !quick.has(note.id)) quick.set(note.id, { id: note.id, title: bookmark.label || note.title, folder: note.folder });
  }

  const weekStart = new Date(noteDateToDate(addDays(today, -6))).getTime() / 1000;
  return {
    notes: notes.length,
    tasks: tasks.length,
    openTasks: tasks.filter((note) => !isDone(note)).length,
    dueToday: pending.filter((note) => isTask(note) && coversDate(note, today)).length,
    overdue: pending.filter((note) => isTask(note) && note.endDate < today).sort(byDate),
    today: sortDatedNotes(dated.filter((note) => coversDate(note, today))),
    upcoming: pending.filter((note) => note.date > today && note.date <= addDays(today, 6)).sort(byDate),
    statuses: groupByStatus(tasks, context.statusOptions).map((group) => ({ status: group.status, count: group.notes.length })),
    quick: [...quick.values()],
    agent: memoryFolder === null ? null : latest(notes.filter((note) => inMemory(note) && !bookkeeping.has(note.id)))
      .map((note) => ({ note, project: note.folder === memoryFolder ? "" : note.folder.slice(memoryFolder.length + 1) })),
    createdThisWeek: notes.filter((note) => note.created_at >= weekStart).length,
    recent: latest(notes.filter((note) => !inMemory(note))),
  };
}
