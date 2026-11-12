import assert from "node:assert/strict";
import { test } from "node:test";
import type { NoteSummary } from "../src/lib/notes";
import { filterTable, groupByStatus, parseChoices } from "../src/features/calendar/task-table";

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

test("choice filters match any chosen value case-insensitively; empty lists match all", () => {
  assert.deepEqual(filterTable(notes, "task", "", { status: ["Not started", "Done"] }).map((n) => n.title), ["Ship", "Plan", "Draft"]);
  assert.deepEqual(filterTable(notes, "task", "", { status: ["NOT STARTED"] }).map((n) => n.title), ["Plan", "Draft"]);
  assert.deepEqual(filterTable(notes, "task", "", { status: [], priority: [] }).map((n) => n.title), ["Ship", "Plan", "Draft", "Loose", "Legacy"]);
  const prioritized = [note("A", "", { priority: "High" }), note("B", "", { priority: "Low" }), note("C", "", {})];
  assert.deepEqual(filterTable(prioritized, "", "", { priority: ["high"] }).map((n) => n.title), ["A"]);
});

test("groups sort by priority (High first, unset and off-list last), then date, then title", () => {
  const list = [
    note("Late low", "", { status: "Done", priority: "Low", date: "2026-01-01" }),
    note("None", "", { status: "Done" }),
    note("Odd", "", { status: "Done", priority: "Urgent-ish" }),
    note("High later", "", { status: "Done", priority: "high", date: "2026-03-01" }),
    note("High sooner", "", { status: "Done", priority: "High", date: "2026-02-01" }),
    note("Medium", "", { status: "Done", priority: "Medium" }),
  ];
  const [group] = groupByStatus(list, ["Done"], ["Low", "Medium", "High"]);
  assert.deepEqual(group.notes.map((n) => n.title), ["High sooner", "High later", "Medium", "Late low", "None", "Odd"]);
});

test("parseChoices splits commas, trims, dedupes and adopts option spelling", () => {
  const options = ["Not started", "In progress", "Done"];
  assert.deepEqual(parseChoices("not started, Done,,done", options), ["Not started", "Done"]);
  assert.deepEqual(parseChoices("Someday", options), ["Someday"]);
  assert.deepEqual(parseChoices(["Done"], options), []);
  assert.deepEqual(parseChoices(undefined, options), []);
});
