"use client";

import { useMemo, useState } from "react";
import type { FinanceClassification } from "./activity-types";
import type { FinanceActivityController } from "./use-finance-activity";
import { classificationCreatePayload, groupClassifications, visibleGroups } from "./classification-management";

export type ClassificationView =
  | { kind: "closed" }
  | { kind: "create-category" }
  | { kind: "create-tag" }
  | { kind: "create-subcategory"; parent: FinanceClassification }
  | { kind: "manage-category"; item: FinanceClassification }
  | { kind: "manage-tag"; item: FinanceClassification }
  | { kind: "manage-subcategory"; item: FinanceClassification };

const closed: ClassificationView = { kind: "closed" };

export function useFinanceClassifications(activity: FinanceActivityController) {
  const [view, setView] = useState<ClassificationView>(closed);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<"expense" | "income">("expense");
  const [showArchived, setShowArchived] = useState(false);

  const groups = useMemo(() => groupClassifications(activity.classifications), [activity.classifications]);
  const visible = useMemo(() => visibleGroups(groups, showArchived), [groups, showArchived]);

  const managed = view.kind === "manage-category" || view.kind === "manage-tag" || view.kind === "manage-subcategory" ? view.item : null;
  const childParent = view.kind === "manage-subcategory" ? activity.classifications.find(row => row.id === view.item.parent_id) ?? null : null;
  const dirty = managed ? draftName !== managed.name : false;
  const partial = activity.classificationTotal > activity.classifications.length;
  const sheetOpen = view.kind !== "closed";

  function openCreateCategory() {
    activity.resetSave();
    setView({ kind: "create-category" });
    setDraftName("");
    setDraftType("expense");
  }
  function openCreateTag() {
    activity.resetSave();
    setView({ kind: "create-tag" });
    setDraftName("");
  }
  function openCreateSubcategory(parent: FinanceClassification) {
    if (activity.busy || dirty || parent.archived || parent.kind !== "category" || parent.parent_id || !parent.type) return;
    activity.resetSave();
    setView({ kind: "create-subcategory", parent });
    setDraftName("");
  }
  function openCategory(item: FinanceClassification) {
    activity.resetSave();
    setView({ kind: "manage-category", item });
    setDraftName(item.name);
  }
  function openTag(item: FinanceClassification) {
    activity.resetSave();
    setView({ kind: "manage-tag", item });
    setDraftName(item.name);
  }
  function openSubcategory(item: FinanceClassification) {
    if (activity.busy || dirty) return;
    activity.resetSave();
    setView({ kind: "manage-subcategory", item });
    setDraftName(item.name);
  }
  function backToParent() {
    if (!childParent || dirty) return;
    openCategory(childParent);
  }
  function childrenOf(item: FinanceClassification): FinanceClassification[] {
    return activity.classifications.filter(row => row.parent_id === item.id && (showArchived || !row.archived));
  }
  function close() {
    if (!activity.busy) setView(closed);
  }
  async function submit() {
    if (view.kind === "create-category") {
      if (await activity.saveClassification(null, classificationCreatePayload({ flow: "category", type: draftType, name: draftName }))) setView(closed);
    } else if (view.kind === "create-tag") {
      if (await activity.saveClassification(null, classificationCreatePayload({ flow: "tag", name: draftName }))) setView(closed);
    } else if (view.kind === "create-subcategory") {
      if (await activity.saveClassification(null, classificationCreatePayload({ flow: "subcategory", parent: view.parent, name: draftName }))) setView(closed);
    } else if (managed) {
      if (await activity.saveClassification(managed.id, { name: draftName, version: managed.version })) setView(closed);
    }
  }
  async function toggleArchived() {
    if (!managed || activity.busy || dirty) return;
    if (await activity.saveClassification(managed.id, { version: managed.version, archived: !managed.archived })) setView(closed);
  }

  return { view, sheetOpen, dirty, partial, childParent, showArchived, setShowArchived, draftName, setDraftName, draftType, setDraftType, visible, childrenOf, close, openCreateCategory, openCreateTag, openCreateSubcategory, openCategory, openTag, openSubcategory, backToParent, submit, toggleArchived };
}
