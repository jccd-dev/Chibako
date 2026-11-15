import assert from "node:assert/strict";
import { test } from "node:test";
import type { NoteSummary } from "../src/lib/notes";
import { summarizeHome, type HomeContext } from "../src/features/home/home-summary";

let seq = 0;
const at = (day: string) => new Date(`${day}T12:00:00`).getTime() / 1000;
const note = (title: string, properties: NoteSummary["properties"] = {}, extra: Partial<NoteSummary> & { created?: string; updated?: string } = {}): NoteSummary => {
  const { created = "2026-01-01", updated = created, ...rest } = extra;
  return { id: `n${++seq}`, title, folder: "", kind: "note", created_at: at(created), updated_at: at(updated), deleted_at: null, is_pinned: 0, properties, ...rest };
};
const titles = (notes: Array<{ title: string }>) => notes.map((n) => n.title);
const context: HomeContext = { statusOptions: ["Not started", "In progress", "Done"], bookmarks: [], memoryFolder: null, bookkeepingIds: [] };

test("home summary counts tasks and groups dated Notes around today", () => {
  const summary = summarizeHome([
    note("Late", { type: "task", date: "2026-11-10" }),
    note("Late but done", { type: "task", status: "Done", date: "2026-11-10" }),
    note("Spans today", { type: "task", status: "In progress", date: "2026-11-14", end_date: "2026-11-16" }),
    note("Done today", { type: "task", status: "done", date: "2026-11-15" }),
    note("Journal", { date: "2026-11-15" }, { created: "2026-11-09" }),
    note("Old journal", { date: "2026-11-01" }, { created: "2026-11-08" }),
    note("Next week edge", { type: "task", date: "2026-11-21" }),
    note("Too far", { type: "task", date: "2026-11-22" }),
    note("Undated task", { type: "task" }, { created: "2026-11-15" }),
  ], "2026-11-15", context);

  assert.equal(summary.notes, 9);
  assert.equal(summary.tasks, 7);
  assert.equal(summary.openTasks, 5);
  assert.equal(summary.dueToday, 1);
  assert.deepEqual(titles(summary.overdue), ["Late"]);
  assert.deepEqual(titles(summary.today), ["Done today", "Journal", "Spans today"]);
  assert.deepEqual(titles(summary.upcoming), ["Next week edge"]);
  assert.deepEqual(summary.statuses, [
    { status: "In progress", count: 1 },
    { status: "Done", count: 2 },
    { status: "", count: 4 },
  ]);
  assert.equal(summary.createdThisWeek, 2);
  assert.equal(summary.agent, null);
  assert.equal(summary.recent[0].title, "Undated task");
});

test("home summary lists pinned Notes before bookmarks and keeps agent memory out of recent notes", () => {
  const pinned = note("Pinned", {}, { is_pinned: 1 });
  const marked = note("Marked", {}, { folder: "Guides" });
  const checkpoint = note("Checkpoint", {}, { folder: "Agent Memory/chibako", updated: "2026-11-15" });
  const shared = note("Shared fact", {}, { folder: "Agent Memory", updated: "2026-11-14" });
  const activity = note("Activity", {}, { folder: "Agent Memory", updated: "2026-11-15" });
  const mine = note("Mine", {}, { folder: "Agent Memory notes", updated: "2026-11-13" });

  const summary = summarizeHome([pinned, marked, checkpoint, shared, activity, mine], "2026-11-15", {
    ...context,
    bookmarks: [{ note_id: pinned.id, label: "Dup" }, { note_id: marked.id, label: "Guide" }, { note_id: "gone", label: "Deleted" }],
    memoryFolder: "Agent Memory",
    bookkeepingIds: [activity.id],
  });

  assert.deepEqual(summary.quick, [
    { id: pinned.id, title: "Pinned", folder: "" },
    { id: marked.id, title: "Guide", folder: "Guides" },
  ]);
  assert.deepEqual(summary.agent?.map((entry) => [entry.note.title, entry.project]), [["Checkpoint", "chibako"], ["Shared fact", ""]]);
  assert.deepEqual(titles(summary.recent), ["Mine", "Pinned", "Marked"]);
});
