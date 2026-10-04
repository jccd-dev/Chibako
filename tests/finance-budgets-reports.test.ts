import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createClassification } from "../src/features/finance/classifications";
import { setBudget, getBudget, getFinanceReport } from "../src/features/finance/budgets";
import { createAccount } from "../src/features/finance/accounts";
import { postTransaction } from "../src/features/finance/activity";
import { hideActivity, revertActivity, recordRefund } from "../src/features/finance/corrections";
import { postTransfer, reconcileAccount } from "../src/features/finance/movements";
import type { FinanceActor } from "../src/features/finance/types";
const vault = mkdtempSync(join(tmpdir(), "chibako-budgets-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_budget_limits; DELETE FROM finance_budget_plans; DELETE FROM finance_refunds; DELETE FROM finance_movements; DELETE FROM finance_transactions; DELETE FROM finance_classifications; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
function category(name = "Food", extra: object = {}) { return createClassification(owner, { request_id: randomUUID(), kind: "category", type: "expense", name, ...extra }).classification; }
function budget(category_id: string, month: string, amount: string, version = 0, mode = "forward") { return { request_id: randomUUID(), category_id, month, amount, version, mode }; }

test("future-effective limits preserve history and explicit corrections affect one calendar month", () => {
  const food = category();
  const first = budget(food.id, "2026-09", "100");
  const saved = setBudget(owner, first);
  assert.equal(saved.budget.version, 1);
  assert.deepEqual(setBudget(owner, first), saved);
  setBudget(owner, budget(food.id, "2026-11", "200", 1));
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-10" }).limit_cents, 10000);
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-11" }).limit_cents, 20000);
  setBudget(owner, budget(food.id, "2026-10", "50", 2, "correction"));
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-09" }).limit_cents, 10000);
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-10" }).limit_cents, 5000);
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-11" }).limit_cents, 20000);
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-08" }).limit_cents, null);
  assert.throws(() => setBudget(owner, { ...first, amount: "101" }), { code: "request_conflict" });
  assert.throws(() => setBudget(owner, budget(food.id, "2026-12", "10", 2)), { code: "version_conflict" });
  assert.throws(() => setBudget(owner, budget(food.id, "2026-13", "10", 3)), { code: "invalid_input" });
  assert.throws(() => setBudget(owner, budget(category("Income", { type: "income" }).id, "2026-10", "10")), { code: "invalid_category" });
  assert.throws(() => setBudget(owner, budget(category("Child", { parent_id: food.id }).id, "2026-10", "10")), { code: "invalid_category" });
  const db = getDb();
  db.exec("CREATE TEMP TRIGGER reject_budget_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try { assert.throws(() => setBudget(owner, budget(food.id, "2026-12", "300", 3)), /audit unavailable/); }
  finally { db.exec("DROP TRIGGER reject_budget_audit"); }
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-12" }).version, 3);
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-12" }).limit_cents, 20000);
  setBudget(owner, budget(food.id, "2026-10", "75", 3));
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-09" }).limit_cents, 10000);
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-10" }).limit_cents, 7500);
  assert.equal(getBudget(owner, { category_id: food.id, month: "2026-12" }).limit_cents, 7500);
});

test("reports aggregate subcategories across accounts, retain hidden spending and dated refunds, and exclude mistakes and movements", () => {
  const food = category(), child = category("Groceries", { parent_id: food.id }), other = category("other");
  const cash = createAccount(owner, { request_id: "cash", name: "Cash", kind: "money", currency: "PHP", opening_balance: "1000" }).account;
  const bank = createAccount(owner, { request_id: "bank", name: "Bank", kind: "money", currency: "PHP", opening_balance: "1000" }).account;
  setBudget(owner, budget(food.id, "2026-09", "25"));
  const post = (account_id: string, amount: string, transaction_date: string, extra: object = {}) => postTransaction(owner, { request_id: randomUUID(), account_id, amount, transaction_date, category_id: food.id, ...extra }).transaction;
  const original = post(cash.id, "20", "2026-09-30", { subcategory_id: child.id });
  hideActivity(owner, original.id, { request_id: "hide", version: 1 });
  post(bank.id, "10", "2026-09-15");
  const mistake = post(bank.id, "90", "2026-09-20");
  revertActivity(owner, mistake.id, { request_id: "revert", version: 1 });
  post(bank.id, "5", "2026-09-20", { category_id: other.id });
  post(bank.id, "2", "2026-09-20", { category_id: null });
  post(bank.id, "50", "2026-09-20", { category_id: null, type: "income" });
  recordRefund(owner, original.id, { request_id: "refund", version: 2, account_id: bank.id, amount: "12.50", transaction_date: "2026-10-02" });
  postTransfer(owner, { request_id: "transfer", source_account_id: cash.id, destination_account_id: bank.id, amount: "10", transaction_date: "2026-09-22" });
  reconcileAccount(owner, { request_id: "reconcile", account_id: cash.id, expected_balance_cents: 97000, actual_balance: "950", transaction_date: "2026-09-23" });
  const september = getFinanceReport(owner, { date_from: "2026-09-01", date_to: "2026-09-30" });
  assert.equal(september.income_cents, 5000);
  assert.equal(september.spending_cents, 3700);
  assert.equal(september.unbudgeted_cents, 700);
  assert.deepEqual(september.categories.find(row => row.category_id === food.id), { category_id: food.id, name: "Food", spending_cents: 3000, budget_cents: 2500, budget_version: 1, unbudgeted_cents: 0, overspent: true });
  assert.equal(september.categories.find(row => row.category_id === other.id)?.spending_cents, 500);
  const october = getFinanceReport(owner, { date_from: "2026-10-01", date_to: "2026-10-31" });
  assert.equal(october.spending_cents, -1250);
  assert.equal(october.categories.find(row => row.category_id === food.id)?.overspent, false);
  assert.deepEqual(october.forecast, { available: false, spending_cents: null });
  const range = getFinanceReport(owner, { date_from: "2026-09-01", date_to: "2026-10-31", limit: 1 });
  assert.equal(range.categories.length, 1);
  assert.equal(range.total, 3);
  assert.deepEqual(range.months, [{ month: "2026-09", income_cents: 5000, spending_cents: 3700 }, { month: "2026-10", income_cents: 0, spending_cents: -1250 }]);
  assert.throws(() => getFinanceReport(owner, { date_from: "2025-09-01", date_to: "2026-10-31" }), { code: "invalid_input" });
  assert.throws(() => getFinanceReport(owner, { date_from: "2026-02-30" }), { code: "invalid_input" });
  assert.throws(() => getFinanceReport({ kind: "api-key", id: "write", scopes: ["finance:write"] }), { code: "forbidden" });
});
