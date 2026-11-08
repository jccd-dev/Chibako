import assert from "node:assert/strict";
import { test } from "node:test";
import type { NoteSummary } from "../src/lib/notes";
import { filterTable, groupByStatus } from "../src/features/calendar/task-table";

const note = (title: string, folder: string, properties: Record<string, string>) =>
  ({ id: title, title, folder, kind: "note", created_at: 0, updated_at: 0, deleted_at: null, is_pinned: 0, properties }) as NoteSummary;

const notes = [
  note("Ship", "Projects/Acme/Tasks", { type: "task", status: "Done", date: "2026-01-02" }),
  note("Plan", "Projects/Acme/Tasks", { type: "task", status: "not started" }),
  note("Draft", "Work", { type: "task", status: "Not started", date: "2026-01-05" }),
  note("Idea", "Work", { type: "concept" }),
  note("Loose", "", { type: "task" }),
  note("Legacy", "", { type: "task", status: "active" }),
];

test("table filter matches type case-insensitively and folders with subfolders", () => {
  assert.deepEqual(filterTable(notes, "task", "").map((n) => n.title), ["Ship", "Plan", "Draft", "Loose", "Legacy"]);
  assert.deepEqual(filterTable(notes, "", "Work").map((n) => n.title), ["Draft", "Idea"]);
  assert.deepEqual(filterTable(notes, "task", "Projects").map((n) => n.title), ["Ship", "Plan"]);
});

test("groups follow Status choice order, then off-list, then No status; dated first", () => {
  const groups = groupByStatus(filterTable(notes, "task", ""), ["Not started", "In progress", "Done"]);
  assert.deepEqual(groups.map((g) => [g.status, g.notes.map((n) => n.title)]), [
    ["Not started", ["Draft", "Plan"]],
    ["Done", ["Ship"]],
    ["active", ["Legacy"]],
    ["", ["Loose"]],
  ]);
});
