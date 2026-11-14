import type { NoteSummary } from "@/lib/notes";
import { inFolder } from "@/features/calendar/task-folder";

export interface StatusGroup {
  /** Status value, or "" for Notes without one. */
  status: string;
  notes: NoteSummary[];
}

const text = (value: unknown) => (Array.isArray(value) ? value.join(", ") : String(value ?? ""));

/** Chosen values per select property (e.g. `{ status: ["Done"] }`); an empty list matches any value. */
export type ChoiceFilters = Record<string, string[]>;

const matchesChoices = (note: NoteSummary, choices: ChoiceFilters) =>
  Object.entries(choices).every(([key, chosen]) => {
    const value = text(note.properties[key]).toLowerCase();
    return !chosen.length || chosen.some((choice) => choice.toLowerCase() === value);
  });

/** Notes matching the Type filter ("" = any type), folder filter (subfolders included) and choice filters. */
export function filterTable<T extends NoteSummary>(notes: T[], type: string, folder: string, choices: ChoiceFilters = {}): T[] {
  return notes.filter((note) =>
    (!type || text(note.properties.type).toLowerCase() === type.toLowerCase()) &&
    inFolder(note.folder, folder) &&
    matchesChoices(note, choices)
  );
}

/** Parses a comma-separated URL value into distinct choices, using each option's spelling when it matches. */
export function parseChoices(value: unknown, options: string[]): string[] {
  if (typeof value !== "string") return [];
  const parsed = value.split(",").map((part) => part.trim()).filter(Boolean)
    .map((part) => options.find((option) => option.toLowerCase() === part.toLowerCase()) ?? part);
  return [...new Set(parsed)];
}

/**
 * Groups in Status choice order, then off-list statuses, then "No status". Each group is sorted by
 * priority (last Priority choice first, unset or off-list last), then date (undated last), then title.
 */
export function groupByStatus(notes: NoteSummary[], statusOptions: string[], priorityOptions: string[] = []): StatusGroup[] {
  const groups = new Map<string, NoteSummary[]>(statusOptions.map((option) => [option, []]));
  for (const note of notes) {
    const status = text(note.properties.status);
    const key = status ? statusOptions.find((option) => option.toLowerCase() === status.toLowerCase()) ?? status : "";
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  const noStatus = groups.get("") ?? [];
  groups.delete("");
  const rank = (note: NoteSummary) => {
    const priority = text(note.properties.priority).toLowerCase();
    return priorityOptions.findIndex((option) => option.toLowerCase() === priority);
  };
  const byPriorityThenDate = (a: NoteSummary, b: NoteSummary) => {
    if (rank(a) !== rank(b)) return rank(b) - rank(a);
    const da = text(a.properties.date), db = text(b.properties.date);
    if (da !== db) return !da ? 1 : !db ? -1 : da.localeCompare(db);
    return a.title.localeCompare(b.title);
  };
  return [...groups, ["", noStatus] as const]
    .filter(([, list]) => list.length)
    .map(([status, list]) => ({ status, notes: [...list].sort(byPriorityThenDate) }));
}
