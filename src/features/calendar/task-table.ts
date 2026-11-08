import type { NoteSummary } from "@/lib/notes";
import { inFolder } from "@/features/calendar/task-folder";

export interface StatusGroup {
  /** Status value, or "" for Notes without one. */
  status: string;
  notes: NoteSummary[];
}

const text = (value: unknown) => (Array.isArray(value) ? value.join(", ") : String(value ?? ""));

/** Notes matching the Type filter ("" = any type) and folder filter (subfolders included). */
export function filterTable(notes: NoteSummary[], type: string, folder: string): NoteSummary[] {
  return notes.filter((note) =>
    (!type || text(note.properties.type).toLowerCase() === type.toLowerCase()) &&
    inFolder(note.folder, folder)
  );
}

/** Groups in Status choice order, then off-list statuses, then "No status"; each sorted by date (undated last), then title. */
export function groupByStatus(notes: NoteSummary[], statusOptions: string[]): StatusGroup[] {
  const groups = new Map<string, NoteSummary[]>(statusOptions.map((option) => [option, []]));
  for (const note of notes) {
    const status = text(note.properties.status);
    const key = status ? statusOptions.find((option) => option.toLowerCase() === status.toLowerCase()) ?? status : "";
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  const noStatus = groups.get("") ?? [];
  groups.delete("");
  const byDate = (a: NoteSummary, b: NoteSummary) => {
    const da = text(a.properties.date), db = text(b.properties.date);
    if (da !== db) return !da ? 1 : !db ? -1 : da.localeCompare(db);
    return a.title.localeCompare(b.title);
  };
  return [...groups, ["", noStatus] as const]
    .filter(([, list]) => list.length)
    .map(([status, list]) => ({ status, notes: [...list].sort(byDate) }));
}
