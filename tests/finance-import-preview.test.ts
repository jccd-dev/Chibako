import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createNote, getNote } from "../src/lib/notes";
import { previewTarsiBackup } from "../src/features/finance/import-preview";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-preview-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const owner = { kind: "owner" } as const;

function source() {
  const data = {
    accounts: [
      { id: "cash", name: "TEST cash", currency: "PHP", type: "debit", balance: 100.01 },
      { id: "asset", name: "TEST asset", currency: "PHP", type: "asset", balance: 30, archivedAt: "2020-04-01T00:00:00Z" },
    ],
    expenses: [{ id: "same-id", amount: 10.25, accountId: "cash", date: "2020-02-29", category: "other", note: "TEST text", recurringExpenseId: "monthly" }],
    incomes: [{ id: "same-id", amount: 20.1, accountId: "cash", date: "2020-02-29", category: "other", tagId: "tag", recurringIncomeId: "salary" }],
    transfers: [{ id: "transfer", amount: 5, fromAccountId: "cash", toAccountId: "asset", date: "2020-03-01" }],
    balanceAdjustments: [{ id: "adjust", accountId: "cash", currency: "PHP", previousBalance: 10, nextBalance: 12, date: "2020-03-01", kind: "reconciliation" }],
    recurringExpenses: [{ id: "monthly", amount: 10.25, accountId: "cash", category: "other", interval: "monthly", nextDueDate: "2020-04-01", paymentMode: "manual" }],
    recurringIncomes: [{ id: "salary", amount: 20.1, accountId: "cash", category: "other", interval: "monthly", nextDueDate: "2020-04-01" }],
    goals: [{ id: "goal", title: "TEST goal", currency: "PHP", targetAmount: 50, currentAmount: 15, linkedAccountId: "cash", contributions: [{ id: "saved", amount: 15, accountId: "cash", date: "2020-03-01" }] }],
    debts: [{ id: "debt", name: "TEST debt", currency: "PHP", totalAmount: 100, paidAmount: 20, creditorType: "person", payments: [{ id: "paid", amount: 20, accountId: "cash", date: "2020-03-01" }] }],
    receivables: [{ id: "receivable", name: "TEST receivable", currency: "PHP", totalAmount: 30, collectedAmount: 10, collections: [] }],
    tags: [{ id: "tag", name: "TEST tag" }],
    customCategories: [{ id: "custom", label: "TEST category" }],
    customIncomeCategories: [], customSubcategories: [{ id: "sub", parentCategoryId: "custom", parentCategoryKind: "expense", label: "TEST subcategory" }],
  };
  return { app: "Tarsi", data: { ...data, activeProfileId: "mirror", profiles: { mirror: structuredClone(data) } } };
}

test("complete proposal reconciles one mirrored history exactly and preserves paused schedules and non-cash starting progress", () => {
  const note = createNote({ title: "TEST preview Note", content: "Keep [[Links]]" });
  const before = getDb().serialize();
  const backup = source();
  const report = previewTarsiBackup(owner, backup);
  assert.equal(report.stage, "reconciled-preview");
  assert.equal(report.can_approve, true, JSON.stringify(report.issues));
  assert.deepEqual(report.balances.map(row => [row.account_id, row.source_cents, row.effects_cents, row.opening_cents, row.reconciled_cents]), [
    ["cash", 10001, 685, 9316, 10001], ["asset", 3000, 500, 2500, 3000],
  ]);
  assert.ok(report.balances.every(row => row.opening_inferred && !row.historical_balances_verified));
  assert.equal(report.counts.find(row => row.collection === "expenses")?.accepted, 1);
  assert.equal(report.records.filter(row => row.source_id === "same-id").length, 2);
  assert.ok(report.records.filter(row => ["recurringExpenses", "recurringIncomes"].includes(row.collection)).every(row => row.target.paused === true));
  assert.equal(report.records.find(row => row.collection === "incomes")?.target.schedule_id, "salary");
  assert.equal(report.records.find(row => row.collection === "expenses")?.target.text, "TEST text");
  assert.equal(report.records.find(row => row.collection === "goals")?.target.starting_progress_cents, 1500);
  assert.equal(report.records.find(row => row.collection === "debts")?.target.starting_progress_cents, 2000);
  assert.equal(report.records.find(row => row.collection === "debts")?.target.creditorType, "person");
  assert.equal(report.records.find(row => row.source_id === "asset")?.target.archivedAt, "2020-04-01T00:00:00Z");
  assert.equal(report.records.find(row => row.collection === "receivables")?.target.starting_progress_cents, 1000);
  assert.ok(report.records.filter(row => ["goals", "debts", "receivables"].includes(row.collection)).every(row => row.effects.length === 0));
  assert.deepEqual(report.records.find(row => row.collection === "debts")?.source.payments, backup.data.debts[0].payments);
  assert.match(report.commit_notice, /recoverable backup/i);
  assert.deepEqual(getDb().serialize(), before);
  assert.deepEqual(getNote(note.id), note);
  assert.deepEqual(backup, source());
});

test("missing-account adjustments are excluded from effects and require exact acknowledgment", () => {
  const backup = source();
  backup.data.balanceAdjustments.push({ id: "orphan", accountId: "missing", currency: "PHP", previousBalance: 0, nextBalance: 999, date: "2020-03-01", kind: "reconciliation" });
  backup.data.profiles.mirror = structuredClone(backup.data.profiles.mirror);
  backup.data.profiles.mirror.balanceAdjustments = structuredClone(backup.data.balanceAdjustments);
  const before = getDb().serialize();
  const report = previewTarsiBackup(owner, backup);
  assert.equal(report.can_approve, false);
  assert.equal(report.exclusions[0].path, "balanceAdjustments[1]");
  assert.equal(report.exclusions[0].acknowledged, false);
  assert.equal(report.balances[0].effects_cents, 685);
  assert.deepEqual(report.counts.find(row => row.collection === "balanceAdjustments"), { collection: "balanceAdjustments", accepted: 1, skipped: 0, excluded: 1, blocked: 0 });
  assert.equal(previewTarsiBackup(owner, backup, { acknowledged_exclusions: ["balanceAdjustments[1]"] }).can_approve, true);
  assert.throws(() => previewTarsiBackup(owner, backup, { acknowledged_exclusions: ["unknown"] }), { code: "invalid_input" });
  assert.deepEqual(getDb().serialize(), before);
});

test("explicit unsupported-field exclusions preserve a private review and never bypass dependent references or mirrored divergence", () => {
  const backup = { app: "Tarsi", data: {
    accounts: [{ id: "cash", name: "TEST cash", type: "debit", currency: "PHP", balance: 100 }],
    expenses: [{ id: "expense", accountId: "cash", amount: 10, date: "2020-01-01", customFlag: "TEST private", unknownDate: "invalid date" }],
  } };
  const blocked = previewTarsiBackup(owner, backup);
  assert.equal(blocked.can_approve, false);
  assert.ok(blocked.issues.some(issue => issue.code === "unsupported_field"));
  const excluded = previewTarsiBackup(owner, backup, { exclusions: ["expenses.customFlag", "expenses.unknownDate"], acknowledged_exclusions: ["expenses.customFlag", "expenses.unknownDate"] });
  assert.equal(excluded.can_approve, true, JSON.stringify(excluded.issues));
  assert.equal(excluded.records.find(row => row.collection === "expenses")?.source.customFlag, undefined);
  assert.deepEqual(excluded.exclusions[0].source, ["TEST private"]);
  const accountExcluded = previewTarsiBackup(owner, backup, { exclusions: ["accounts[0]", "expenses.customFlag", "expenses.unknownDate"], acknowledged_exclusions: ["accounts[0]", "expenses.customFlag", "expenses.unknownDate"] });
  assert.equal(accountExcluded.can_approve, false);
  assert.ok(accountExcluded.issues.some(issue => issue.code === "excluded_reference"));
  const mirror = source();
  mirror.data.profiles.mirror.accounts[0].balance++;
  const mirrorReport = previewTarsiBackup(owner, mirror, { exclusions: ["accounts[0]"] });
  assert.ok(mirrorReport.issues.some(issue => issue.code === "mirrored_divergence"));
  assert.equal(mirrorReport.can_approve, false);
  assert.throws(() => previewTarsiBackup(owner, backup, { exclusions: ["destination"] }), { code: "invalid_input" });
});

test("money, dates, allocation, nested identity and reference blockers cannot be approved", () => {
  const variants: [string, (data: ReturnType<typeof source>["data"]) => void][] = [
    ["unresolved_mapping", data => { data.expenses[0].amount = 1.001; }],
    ["invalid_date", data => { data.expenses[0].date = "2023-02-29"; }],
    ["unresolved_mapping", data => { data.recurringExpenses[0].interval = "unknown"; }],
    ["unresolved_mapping", data => { data.debts[0].paidAmount = 101; }],
    ["unresolved_mapping", data => { data.goals[0].contributions.push(structuredClone(data.goals[0].contributions[0])); }],
    ["allocation_overflow", data => { data.goals[0].currentAmount = 101; }],
    ["unresolved_allocation", data => { data.goals[0].linkedAccountId = "asset"; }],
    ["unresolved_reference", data => { data.incomes[0].tagId = "missing"; }],
  ];
  for (const [expected, mutate] of variants) {
    const backup = source();
    mutate(backup.data);
    const { profiles: _profiles, activeProfileId: _active, ...collections } = backup.data;
    const report = previewTarsiBackup(owner, { app: "Tarsi", data: collections });
    assert.equal(report.can_approve, false, expected);
    assert.ok(report.issues.some(issue => issue.code === expected), `${expected}: ${JSON.stringify(report.issues)}`);
  }
  assert.throws(() => previewTarsiBackup({ kind: "trusted-local" }, null), { code: "owner_required" });
  assert.throws(() => previewTarsiBackup({ kind: "api-key", id: "TEST key", scopes: ["*"] }, source()), { code: "owner_required" });
  assert.throws(() => previewTarsiBackup(owner, source(), { can_approve: true }), { code: "invalid_input" });
});

test("planned history and explicitly excluded cash never contribute effects; nested unsupported data is reviewable", () => {
  const backup = { app: "Tarsi", data: {
    accounts: [{ id: "cash", name: "TEST cash", currency: "PHP", type: "debit", balance: 10 }],
    expenses: [{ id: "pending", amount: 9, accountId: "cash", date: "2020-01-01", planned: true }, { id: "excluded", amount: 3, accountId: "cash", date: "2020-01-01" }],
    goals: [{ id: "goal", title: "TEST goal", currency: "PHP", targetAmount: 10, currentAmount: 1, linkedAccountId: "cash", contributions: [{ id: "history", amount: 1, accountId: "cash", date: "2020-01-01", unknown: "TEST unsupported nested" }] }],
  } };
  const path = "goals[0].contributions[0].unknown";
  const report = previewTarsiBackup(owner, backup, { exclusions: ["expenses[1]", path], acknowledged_exclusions: ["expenses[1]", path] });
  assert.equal(report.can_approve, true, JSON.stringify(report.issues));
  assert.equal(report.balances[0].effects_cents, 0);
  assert.equal(report.balances[0].opening_cents, 1000);
  assert.equal(report.records.find(row => row.source_id === "pending")?.target.status, "pending");
  assert.equal(report.exclusions.find(row => row.path === path)?.source, "TEST unsupported nested");
  assert.equal(JSON.stringify(report.records.find(row => row.source_id === "goal")?.source).includes("TEST unsupported nested"), false);
});

test("built-in category order IDs map without reclassifying history", () => {
  const backup = { app: "Tarsi", data: {
    accounts: [{ id: "cash", name: "TEST cash", currency: "PHP", type: "debit", balance: 10 }],
    categoryOrderIds: ["food", "custom"], incomeCategoryOrderIds: ["salary"],
    customCategories: [{ id: "custom", label: "TEST custom label" }],
    expenses: [{ id: "expense", amount: 1, accountId: "cash", date: "2020-01-01", category: "food" }],
    incomes: [{ id: "income", amount: 2, accountId: "cash", date: "2020-01-01", category: "salary" }],
  } };
  const report = previewTarsiBackup(owner, backup);
  assert.equal(report.can_approve, true, JSON.stringify(report.issues));
  assert.equal(report.records.find(row => row.collection === "categoryOrderIds" && row.source_id === "food")?.target.name, "food");
  assert.equal(report.records.find(row => row.collection === "categoryOrderIds" && row.source_id === "custom")?.target.name, "TEST custom label");
  assert.equal(report.records.find(row => row.collection === "expenses")?.target.category_id, "food");
  assert.equal(report.balances[0].effects_cents, 100);
});
