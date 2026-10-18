import assert from "node:assert/strict";
import { test } from "node:test";
import type { Note } from "../src/lib/notes";
import { noteSaveRefreshChanges } from "../src/features/notes/note-save-refresh";

const note: Note = {
  id: "a", title: "A", folder: "", kind: "note", content: "[[B]] first body",
  properties: {}, created_at: 1, updated_at: 1, deleted_at: null, is_pinned: 0,
};

test("plain text saves skip tree and panel requests but invalidate other notes' snippets", () => {
  assert.deepEqual(noteSaveRefreshChanges(note, { ...note, content: "[[B]] second body", updated_at: 2 }),
    { tree: false, details: false, invalidateDetails: true });
});

test("folder, pin and property saves still update the tree without refetching links", () => {
  assert.deepEqual(noteSaveRefreshChanges(note, { ...note, folder: "moved" }),
    { tree: true, details: false, invalidateDetails: true });
  for (const saved of [{ ...note, is_pinned: 1 }, { ...note, properties: { tag: "new" } }]) {
    assert.equal(noteSaveRefreshChanges(note, saved).tree, true);
    assert.equal(noteSaveRefreshChanges(note, saved).details, false);
  }
});

test("link order, repetitions and display aliases do not trigger panel requests", () => {
  const previous = { ...note, content: "[[B]] [[C]]" };
  assert.equal(noteSaveRefreshChanges(previous, { ...note, content: "[[C|alias]] [[B]] [[B]]" }).details, false);
  assert.equal(noteSaveRefreshChanges(previous, { ...note, content: "[[B]] [[D]]" }).details, true);
});

test("creation and title changes refresh both tree and panel", () => {
  assert.deepEqual(noteSaveRefreshChanges(null, note), { tree: true, details: true, invalidateDetails: true });
  assert.deepEqual(noteSaveRefreshChanges(note, { ...note, title: "Renamed" }),
    { tree: true, details: true, invalidateDetails: true });
});
