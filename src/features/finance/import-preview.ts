import { z } from "zod";
import { inspectTarsiBackup } from "./import-inspection";
import { mapTarsiRecord } from "./import-preview-mapping";
import { isSourceObject, sourceFields } from "./import-source-format";
import { exactCents } from "./money";
import { FinanceError, type FinanceActor } from "./types";
import type { TarsiPreview } from "./import-preview-types";

const optionsSchema = z.object({
  exclusions: z.array(z.string().min(1).max(512)).max(10000).default([]),
  acknowledged_exclusions: z.array(z.string().min(1).max(512)).max(10000).default([]),
}).strict();
const commitNotice = "Preview writes nothing. Commit requires a recoverable backup and separate owner confirmation in the next migration step.";
const categoryOrders: Record<string, string> = { categoryOrderIds: "expense", incomeCategoryOrderIds: "income" };

function within(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}.`) || path.startsWith(`${parent}[`);
}

function sourceValue(root: unknown, path: string, remove = false): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let value = root;
  for (const [index, part] of parts.entries()) {
    if ((!isSourceObject(value) && !Array.isArray(value)) || !Object.hasOwn(value, part)) return undefined;
    const next: unknown = Reflect.get(value, part);
    if (remove && index === parts.length - 1) Reflect.deleteProperty(value, part);
    value = next;
  }
  return value;
}

export function previewTarsiBackup(actor: FinanceActor, input: unknown, options: unknown = {}): TarsiPreview {
  const inspection = inspectTarsiBackup(actor, input);
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success) throw new FinanceError("Invalid preview review options", 400, "invalid_input");
  // Inspection has already validated the envelope and selected representation.
  if (!isSourceObject(input) || !isSourceObject(input.data)) throw new FinanceError("Invalid backup", 400, "invalid_input");
  const data = input.data;
  const selected = inspection.representation === "profile" && isSourceObject(data.profiles)
    ? data.profiles[inspection.profile_id!] : data;
  if (!isSourceObject(selected)) throw new FinanceError("Invalid profile", 400, "invalid_input");
  const choices = new Map<string, string>();
  for (const issue of inspection.issues) {
    if (issue.code === "unsupported_section" && Object.hasOwn(categoryOrders, issue.path) && Array.isArray(selected[issue.path])) continue;
    if (issue.code === "unsupported_section" || issue.code === "unsupported_field") choices.set(issue.path, `Exclude unsupported data at ${issue.path}`);
  }
  for (const [collection, value] of Object.entries(selected)) {
    if (!Object.hasOwn(sourceFields, collection) || !Array.isArray(value)) continue;
    for (const [index, row] of value.entries()) choices.set(`${collection}[${index}]`, `Exclude ${collection} ${isSourceObject(row) && typeof row.id === "string" ? row.id : index}`);
  }
  const requested = new Set(parsed.data.exclusions);
  for (const path of requested) if (!choices.has(path)) throw new FinanceError("Exclusion does not identify a source record or unsupported field/section", 400, "invalid_input");
  const excluded = new Set([...requested].filter(path => ![...requested].some(parent => parent !== path && within(path, parent))));
  const acknowledged = new Set(parsed.data.acknowledged_exclusions);
  const report: TarsiPreview = {
    stage: "reconciled-preview", inspection, can_approve: false, issues: [], counts: [], records: [], balances: [],
    exclusions: [], exclusion_choices: [], commit_notice: commitNotice,
  };
  const issue = (code: string, path: string, message: string) => report.issues.push({ code, path, message, severity: "blocker" });
  const sourceAccounts = new Set(Array.isArray(selected.accounts) ? selected.accounts.filter(isSourceObject).map(row => row.id) : []);
  for (const [collection, rows] of Object.entries(selected)) {
    if (!Object.hasOwn(sourceFields, collection) || !Array.isArray(rows)) continue;
    for (const [index, row] of rows.entries()) {
      const path = `${collection}[${index}]`;
      if (collection === "balanceAdjustments" && isSourceObject(row) && typeof row.accountId === "string" && !sourceAccounts.has(row.accountId)) {
        excluded.add(path);
        report.exclusions.push({ path, reason: "Missing-account adjustment excluded; no account is invented or reassigned.", acknowledged: acknowledged.has(path), source: structuredClone(row) });
      }
    }
  }
  const isExcluded = (path: string) => [...excluded].some(parent => {
    if (within(path, parent)) return true;
    const field = parent.match(/^([^.\[]+)\.([^.\[]+)$/);
    const rowPath = path.match(/^([^.\[]+)\[\d+\]\.(.+)$/);
    return !!field && !!rowPath && field[1] === rowPath[1] && within(rowPath[2], field[2]);
  });
  for (const path of excluded) {
    if (report.exclusions.some(item => item.path === path)) continue;
    let source: unknown = sourceValue(selected, path) ?? sourceValue(input, path);
    const field = path.match(/^([^.\[]+)\.([^.\[]+)$/);
    const fieldRows = field ? selected[field[1]] : undefined;
    if (field && Array.isArray(fieldRows)) source = fieldRows.filter(isSourceObject).map(row => row[field[2]]);
    report.exclusions.push({ path, reason: "Explicit owner exclusion from this proposal.", acknowledged: acknowledged.has(path), source: source === undefined ? null : structuredClone(source) });
  }
  for (const path of acknowledged) if (!report.exclusions.some(item => item.path === path)) throw new FinanceError("Acknowledgment does not identify an exclusion", 400, "invalid_input");
  for (const original of inspection.issues) {
    if (original.code === "unsupported_section" && Object.hasOwn(categoryOrders, original.path) && Array.isArray(selected[original.path])) continue;
    if (isExcluded(original.path)) continue;
    // A collection-level unknown field applies to every row; individual row exclusions can settle it too.
    const field = original.code === "unsupported_field" ? original.path.match(/^([^.\[]+)\.([^.\[]+)$/) : null;
    const fieldRows = field ? selected[field[1]] : undefined;
    if (field && Array.isArray(fieldRows) && fieldRows.every((row, index) => !isSourceObject(row) || !Object.hasOwn(row, field[2]) || isExcluded(`${field[1]}[${index}]`))) continue;
    report.issues.push(original);
  }
  for (const [collection, rows] of Object.entries(selected)) {
    if (!Array.isArray(rows) || ["profiles", "profileMetas"].includes(collection)) continue;
    const count = { collection, accepted: 0, skipped: 0, excluded: 0, blocked: 0 };
    report.counts.push(count);
    for (const [index, row] of rows.entries()) {
      const path = `${collection}[${index}]`;
      if (Object.hasOwn(categoryOrders, collection)) {
        if (typeof row !== "string" || !row || row.length > 128 || rows.indexOf(row) !== index) {
          issue("unresolved_mapping", path, "Category order requires unique category IDs."); count.blocked++; continue;
        }
        const customCollection = categoryOrders[collection] === "income" ? "customIncomeCategories" : "customCategories";
        const custom = selected[customCollection];
        const label = Array.isArray(custom) ? custom.find(item => isSourceObject(item) && item.id === row) : undefined;
        report.records.push({ collection, source_id: row, path, status: "accepted", source: { id: row, order: index }, target: { kind: "category", type: categoryOrders[collection], name: isSourceObject(label) ? label.label : row, order: index }, effects: [] });
        continue;
      }
      if (isExcluded(path)) {
        count.excluded++;
        if (isSourceObject(row)) report.records.push({ collection, source_id: typeof row.id === "string" ? row.id : "", path, status: "excluded", source: structuredClone(row), target: {}, effects: [] });
        continue;
      }
      if (!isSourceObject(row)) { count.blocked++; continue; }
      if (!Object.hasOwn(sourceFields, collection)) {
        report.records.push({ collection, source_id: typeof row.id === "string" ? row.id : "", path, status: "blocked", source: structuredClone(row), target: {}, effects: [] });
        continue;
      }
      const clean = structuredClone(row);
      for (const excludedPath of excluded) {
        const collectionField = excludedPath.match(/^([^.\[]+)\.([^.\[]+)$/);
        if (collectionField?.[1] === collection) delete clean[collectionField[2]];
        else if (within(excludedPath, path)) sourceValue(clean, excludedPath.slice(path.length + 1), true);
      }
      try {
        const mapped = mapTarsiRecord(collection, clean, path);
        report.records.push(mapped);
      } catch (error) {
        if (!(error instanceof FinanceError)) throw error;
        issue(error.code, path, error.message);
        report.records.push({ collection, source_id: typeof row.id === "string" ? row.id : "", path, status: "blocked", source: structuredClone(row), target: {}, effects: [] });
      }
    }
  }
  // Excluded records cannot satisfy relationships of accepted records.
  const removedIds = new Set(report.records.filter(row => row.status === "excluded").flatMap(row => {
    const aliases = row.collection === "customCategories" ? [row.collection, "expenseCategories"]
      : row.collection === "customIncomeCategories" ? [row.collection, "incomeCategories"] : [row.collection];
    return aliases.map(collection => JSON.stringify([collection, row.source_id]));
  }));
  for (const relation of inspection.relationships) {
    if (isExcluded(relation.path)) continue;
    if (removedIds.has(JSON.stringify([relation.target_collection, relation.target_id]))) issue("excluded_reference", relation.path, "Relationship points to an excluded source record. Resolve it or exclude the dependent record.");
  }
  const subcategories = Array.isArray(selected.customSubcategories) ? selected.customSubcategories.filter(isSourceObject) : [];
  for (const record of report.records.filter(row => row.status === "accepted" && row.source.subcategoryId)) {
    const child = subcategories.find(row => row.id === record.source.subcategoryId);
    const kind = ["incomes", "recurringIncomes"].includes(record.collection) ? "income" : "expense";
    if (child && (child.parentCategoryId !== record.source.category || child.parentCategoryKind !== kind)) issue("classification_mismatch", record.path, "Subcategory does not belong to this source category and activity kind.");
  }
  for (const record of report.records) {
    const collectionIssue = report.issues.some(item => item.path.startsWith(`${record.collection}.`) && !item.path.includes("["));
    if (record.status === "accepted" && (collectionIssue || report.issues.some(item => within(item.path, record.path) || item.path === record.collection))) record.status = "blocked";
  }
  const accounts = new Map(report.records.filter(row => row.collection === "accounts" && row.status === "accepted").map(row => [row.source_id, row]));
  const reservations = new Map<string, bigint>();
  for (const record of report.records.filter(row => row.collection === "goals" && row.status === "accepted")) {
    const accountId = record.source.linkedAccountId;
    const progress = record.target.starting_progress_cents;
    if (typeof progress !== "number" || progress === 0) continue;
    const account = typeof accountId === "string" ? accounts.get(accountId) : undefined;
    if (!account || account.target.kind !== "money") { issue("unresolved_allocation", record.path, "Goal allocation requires an accepted money account."); record.status = "blocked"; continue; }
    reservations.set(account.source_id, (reservations.get(account.source_id) ?? 0n) + BigInt(progress));
  }
  for (const [accountId, reserved] of reservations) {
    const account = accounts.get(accountId)!;
    if (typeof account.target.snapshot_cents === "number" && reserved > BigInt(Math.max(0, account.target.snapshot_cents))) {
      for (const goal of report.records.filter(row => row.collection === "goals" && row.source.linkedAccountId === accountId && row.status === "accepted")) {
        issue("allocation_overflow", goal.path, "Goal allocations exceed this account snapshot; settle allocations before approval.");
        goal.status = "blocked";
      }
    }
  }
  for (const account of accounts.values()) {
    try {
      const sum = report.records.filter(row => row.status === "accepted").flatMap(row => row.effects).filter(effect => effect.account_id === account.source_id).reduce((total, effect) => total + BigInt(effect.amount_cents), 0n);
      const snapshot = account.target.snapshot_cents;
      if (typeof snapshot !== "number") continue;
      const effects = exactCents(sum);
      const opening = exactCents(BigInt(snapshot) - sum);
      account.target.opening_balance_cents = opening;
      account.target.opening_inferred = true;
      report.balances.push({ account_id: account.source_id, name: String(account.target.name), source_cents: snapshot, effects_cents: effects, opening_cents: opening, reconciled_cents: exactCents(BigInt(opening) + sum), opening_inferred: true, historical_balances_verified: false });
    } catch (error) {
      if (!(error instanceof FinanceError)) throw error;
      issue(error.code, account.path, error.message);
    }
  }
  for (const count of report.counts) for (const record of report.records.filter(row => row.collection === count.collection && row.status !== "excluded")) count[record.status]++;
  report.exclusion_choices = [...choices].map(([path, label]) => ({ path, label }));
  report.can_approve = inspection.eligible && report.issues.length === 0 && report.counts.every(count => count.blocked === 0) && report.exclusions.every(item => item.acknowledged);
  return report;
}
