import type { FinanceClassification } from "./activity-types";

export interface CategoryGroup {
  category: FinanceClassification;
  children: FinanceClassification[];
}

export interface ClassificationGroups {
  expense: CategoryGroup[];
  income: CategoryGroup[];
  tags: FinanceClassification[];
  pendingChildren: FinanceClassification[];
}

export type ClassificationCreateFlow =
  | { flow: "category"; type: "expense" | "income"; name: string }
  | { flow: "tag"; name: string }
  | { flow: "subcategory"; parent: FinanceClassification; name: string };

export interface ClassificationCreatePayload {
  kind: "category" | "tag";
  name: string;
  type?: "expense" | "income";
  parent_id: string | null;
}

export function groupClassifications(classifications: FinanceClassification[]): ClassificationGroups {
  const groups: ClassificationGroups = { expense: [], income: [], tags: [], pendingChildren: [] };
  const parents = new Map<string, FinanceClassification>();
  const children = new Map<string, FinanceClassification[]>();
  for (const item of classifications) {
    if (item.kind === "tag") groups.tags.push(item);
    else if (item.parent_id) {
      const siblings = children.get(item.parent_id) ?? [];
      siblings.push(item);
      children.set(item.parent_id, siblings);
    } else parents.set(item.id, item);
  }
  for (const type of ["expense", "income"] as const) {
    groups[type] = [...parents.values()]
      .filter(parent => parent.type === type)
      .map(category => ({ category, children: children.get(category.id) ?? [] }));
  }
  for (const [parentId, siblings] of children) {
    if (!parents.has(parentId)) groups.pendingChildren.push(...siblings);
  }
  return groups;
}

export function visibleGroups(groups: ClassificationGroups, showArchived: boolean): ClassificationGroups {
  const keep = (item: FinanceClassification) => showArchived || !item.archived;
  const withChildren = (group: CategoryGroup): CategoryGroup | null => {
    const children = group.children.filter(keep);
    if (!keep(group.category) && !children.length) return null;
    return { ...group, children };
  };
  return {
    expense: groups.expense.map(withChildren).filter((group): group is CategoryGroup => group !== null),
    income: groups.income.map(withChildren).filter((group): group is CategoryGroup => group !== null),
    tags: groups.tags.filter(keep),
    pendingChildren: groups.pendingChildren.filter(keep),
  };
}

export function classificationCreatePayload(input: ClassificationCreateFlow): ClassificationCreatePayload {
  if (input.flow === "tag") return { kind: "tag", name: input.name, parent_id: null };
  if (input.flow === "category") return { kind: "category", type: input.type, name: input.name, parent_id: null };
  return { kind: "category", type: input.parent.type ?? undefined, name: input.name, parent_id: input.parent.id };
}
