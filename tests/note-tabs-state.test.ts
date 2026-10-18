import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreNoteTabs } from "../src/features/notes/note-tabs-state";

test("restoring tabs preserves title events received during hydration and avoids duplicates", () => {
  const stored = [{ id: "a", title: "Old title" }, { id: "b", title: "Other note" }];
  const received = [{ id: "a", title: "Current title" }, { id: "c", title: "New note" }];
  assert.deepEqual(restoreNoteTabs(stored, received), [
    { id: "a", title: "Current title" },
    { id: "b", title: "Other note" },
    { id: "c", title: "New note" },
  ]);
  assert.equal(stored[0].title, "Old title");
});
