import assert from "node:assert/strict";
import { test } from "node:test";
import type { FinanceClassification } from "../../src/features/finance/activity-types";
import { classificationCreatePayload, groupClassifications, visibleGroups } from "../../src/features/finance/classification-management";

function classification(id: string, overrides: Partial<FinanceClassification> = {}): FinanceClassification {
  return {
    id, name: id, kind: "category", type: "expense", parent_id: null,
    archived: false, version: 1, created_at: 1, updated_at: 1,
    ...overrides,
  };
}

test("groups expense and income parents, independent tags, and children loaded before their parent", () => {
  const parent = classification("Travel");
  const child = classification("Rail", { parent_id: parent.id });
  const income = classification("Salary", { type: "income" });
  const tag = classification("Receipt", { kind: "tag", type: null });
  const groups = groupClassifications([child, income, tag, parent]);
  assert.deepEqual(groups.expense, [{ category: parent, children: [child] }]);
  assert.deepEqual(groups.income, [{ category: income, children: [] }]);
  assert.deepEqual(groups.tags, [tag]);
  assert.deepEqual(groups.pendingChildren, []);
});

test("hiding archived classifications retains an archived parent with an active child", () => {
  const parent = classification("Travel", { archived: true });
  const activeChild = classification("Rail", { parent_id: parent.id });
  const archivedChild = classification("Taxi", { parent_id: parent.id, archived: true });
  const archivedParent = classification("Retired", { archived: true });
  const archivedTag = classification("Old tag", { kind: "tag", type: null, archived: true });
  const groups = groupClassifications([parent, activeChild, archivedChild, archivedParent, archivedTag]);
  const visible = visibleGroups(groups, false);
  assert.deepEqual(visible.expense, [{ category: parent, children: [activeChild] }]);
  assert.deepEqual(visible.tags, []);
  assert.deepEqual(visibleGroups(groups, true), groups);
});

test("partial pages retain children with unloaded parents until the parent arrives", () => {
  const parent = classification("Travel");
  const child = classification("Rail", { parent_id: parent.id });
  const archivedChild = classification("Taxi", { parent_id: parent.id, archived: true });
  const partial = visibleGroups(groupClassifications([child, archivedChild]), false);
  assert.deepEqual(partial.pendingChildren, [child]);
  assert.deepEqual(partial.expense, []);
  const completed = visibleGroups(groupClassifications([child, archivedChild, parent]), false);
  assert.deepEqual(completed.pendingChildren, []);
  assert.deepEqual(completed.expense, [{ category: parent, children: [child] }]);
});

test("creation flows keep tags independent and bind subcategories to their parent's type and identity", () => {
  assert.deepEqual(classificationCreatePayload({ flow: "tag", name: "Receipt" }), {
    kind: "tag", name: "Receipt", parent_id: null,
  });
  for (const type of ["expense", "income"] as const) {
    assert.deepEqual(classificationCreatePayload({ flow: "category", type, name: "Travel" }), {
      kind: "category", type, name: "Travel", parent_id: null,
    });
    const parent = classification("parent", { type });
    assert.deepEqual(classificationCreatePayload({ flow: "subcategory", parent, name: "Rail" }), {
      kind: "category", type, name: "Rail", parent_id: parent.id,
    });
  }
});
