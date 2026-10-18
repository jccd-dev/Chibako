"use client";

import { useMemo, useState } from "react";
import type { FinanceClassification } from "./activity-types";
import type { FinanceActivityController } from "./use-finance-activity";
import { classificationCreatePayload, groupClassifications, visibleGroups } from "./classification-management";

export type ClassificationView =
  | { kind: "closed" }
  | { kind: "create-category" }
  | { kind: "create-tag" }
  | { kind: "manage-category"; item: FinanceClassification }
  | { kind: "manage-tag"; item: FinanceClassification };

// Inline subcategory editor: id null adds a new subcategory under the managed category.
type ChildDraft = { id: string | null; name: string };

const closed: ClassificationView = { kind: "closed" };

export function useFinanceClassifications(activity: FinanceActivityController) {
  const [view, setView] = useState<ClassificationView>(closed);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<"expense" | "income">("expense");
  const [showArchived, setShowArchived] = useState(false);
  const [childDraft, setChildDraft] = useState<ChildDraft | null>(null);

  const groups = useMemo(() => groupClassifications(activity.classifications), [activity.classifications]);
  const visible = useMemo(() => visibleGroups(groups, showArchived), [groups, showArchived]);

  const managed = view.kind === "manage-category" || view.kind === "manage-tag" ? view.item : null;
  const dirty = managed ? draftName !== managed.name : false;
  const partial = activity.classificationTotal > activity.classifications.length;
  const sheetOpen = view.kind !== "closed";
  function childrenOf(item: FinanceClassification): FinanceClassification[] {
    return activity.classifications.filter(row => row.parent_id === item.id && (showArchived || !row.archived));
  }

  function openView(next: ClassificationView) {
    activity.resetSave();
    setView(next);
    setChildDraft(null);
  }
  function openCreateCategory() {
    openView({ kind: "create-category" });
    setDraftName("");
    setDraftType("expense");
  }
  function openCreateTag() {
    openView({ kind: "create-tag" });
    setDraftName("");
  }
  function openCategory(item: FinanceClassification) {
    openView({ kind: "manage-category", item });
    setDraftName(item.name);
  }
  function openTag(item: FinanceClassification) {
    openView({ kind: "manage-tag", item });
    setDraftName(item.name);
  }
  function close() {
    if (!activity.busy) openView(closed);
  }
  function startChildAdd() {
    if (view.kind !== "manage-category" || activity.busy || dirty || view.item.archived || view.item.kind !== "category" || view.item.parent_id || !view.item.type) return;
    activity.resetSave();
    setChildDraft({ id: null, name: "" });
  }
  function openChildEditor(item: FinanceClassification) {
    if (activity.busy || dirty || item.kind !== "category" || !item.parent_id) return;
    activity.resetSave();
    setChildDraft({ id: item.id, name: item.name });
  }
  function setChildDraftName(name: string) {
    setChildDraft(draft => draft ? { ...draft, name } : draft);
  }
  function closeChild() {
    setChildDraft(null);
  }
  async function saveChild() {
    if (!childDraft || activity.busy || dirty || !childDraft.name.trim()) return;
    if (childDraft.id === null) {
      if (view.kind !== "manage-category") return;
      if (await activity.saveClassification(null, classificationCreatePayload({ flow: "subcategory", parent: view.item, name: childDraft.name.trim() }))) setChildDraft(null);
      return;
    }
    const item = activity.classifications.find(row => row.id === childDraft.id);
    if (!item) { setChildDraft(null); return; }
    if (await activity.saveClassification(childDraft.id, { name: childDraft.name, version: item.version })) setChildDraft(null);
  }
  async function toggleChildArchived(item: FinanceClassification) {
    if (activity.busy || dirty) return;
    if (await activity.saveClassification(item.id, { version: item.version, archived: !item.archived })) setChildDraft(null);
  }
  function finish() {
    setView(closed);
    setChildDraft(null);
  }
  async function submit() {
    if (view.kind === "create-category") {
      if (await activity.saveClassification(null, classificationCreatePayload({ flow: "category", type: draftType, name: draftName }))) finish();
    } else if (view.kind === "create-tag") {
      if (await activity.saveClassification(null, classificationCreatePayload({ flow: "tag", name: draftName }))) finish();
    } else if (managed) {
      if (await activity.saveClassification(managed.id, { name: draftName, version: managed.version })) finish();
    }
  }
  async function toggleArchived() {
    if (!managed || activity.busy || dirty) return;
    if (await activity.saveClassification(managed.id, { version: managed.version, archived: !managed.archived })) finish();
  }

  return { view, sheetOpen, dirty, partial, showArchived, setShowArchived, draftName, setDraftName, draftType, setDraftType, visible, childrenOf, childDraft, setChildDraftName, closeChild, startChildAdd, openChildEditor, saveChild, toggleChildArchived, close, openCreateCategory, openCreateTag, openCategory, openTag, submit, toggleArchived };
}
