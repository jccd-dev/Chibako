import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createAccount, getAccount, getFinanceSummary } from "../src/features/finance/accounts";
import { getActivityTotals, getTransaction, listTransactions, postTransaction } from "../src/features/finance/activity";
import { createClassification } from "../src/features/finance/classifications";
import { postTransfer, reconcileAccount, valueAsset } from "../src/features/finance/movements";
import { correctActivity, hideActivity, recordRefund, revertActivity } from "../src/features/finance/corrections";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-corrections-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_refunds; DELETE FROM finance_movements; DELETE FROM finance_transactions; DELETE FROM finance_classifications; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
function account(name: string, kind = "money") {
  return createAccount(owner, { request_id: randomUUID(), name, kind, currency: "PHP", opening_balance: "100" }).account;
}
function expense(account_id: string, extra: object = {}) {
  return postTransaction(owner, { request_id: randomUUID(), account_id, amount: "20", transaction_date: "2026-09-30", ...extra }).transaction;
}
function action(version: number) { return { request_id: randomUUID(), version }; }

test("amount/account corrections replace effects atomically; hidden activity still counts and Revert cancels once", () => {
  const old = account("Old"), next = account("Next");
  const original = expense(old.id, { text: "Keep this receipt" });
  const patch = { ...action(original.version), amount: "30.01", account_id: next.id };
  const corrected = correctActivity(owner, original.id, patch);
  assert.equal(getAccount(owner, old.id).balance_cents, 10000);
  assert.equal(getAccount(owner, next.id).balance_cents, 6999);
  assert.equal(getTransaction(owner, original.id, { include_details: true }).text, "Keep this receipt");
  assert.deepEqual(corrected.balances, [{ account_id: old.id, balance_cents: 10000 }, { account_id: next.id, balance_cents: 6999 }]);
  assert.deepEqual(correctActivity(owner, original.id, patch), corrected);
  assert.throws(() => correctActivity(owner, original.id, { ...patch, amount: "31" }), { code: "request_conflict" });
  assert.throws(() => correctActivity(owner, original.id, { ...action(1), text: "stale" }), { code: "version_conflict" });
  const hidden = hideActivity(owner, original.id, action(corrected.transaction.version));
  assert.equal(listTransactions(owner).total, 0);
  assert.equal(listTransactions(owner, { hidden: "true" }).total, 1);
  assert.equal(hidden.balances[0].balance_cents, 6999);
  assert.equal(getActivityTotals(owner, { month: "2026-09" }).expense_cents, 3001);
  const payload = action(hidden.transaction.version);
  const reverted = revertActivity(owner, original.id, payload);
  assert.equal(getAccount(owner, next.id).balance_cents, 10000);
  assert.equal(getActivityTotals(owner, { month: "2026-09" }).expense_cents, 0);
  assert.equal(listTransactions(owner, { hidden: "all", reverted: "true" }).total, 1);
  assert.deepEqual(revertActivity(owner, original.id, payload), reverted);
  assert.throws(() => revertActivity(owner, original.id, action(reverted.transaction.version)), { code: "already_reverted" });
  const audit = getDb().prepare("SELECT before_json, after_json FROM finance_audit WHERE request_id = ?").get(patch.request_id) as { before_json: string; after_json: string };
  assert.equal(JSON.parse(audit.before_json).transaction.account_id, old.id);
  assert.equal(JSON.parse(audit.after_json).transaction.amount_cents, 3001);
});

test("September expense and October refunds retain dates/category, enforce partial limits, and revert refunds first", () => {
  const cash = account("Cash"), bank = account("Bank");
  const category = createClassification(owner, { request_id: "category", kind: "category", type: "expense", name: "Food" }).classification;
  const original = expense(cash.id, { category_id: category.id });
  const payload = { ...action(original.version), account_id: bank.id, amount: "12.50", transaction_date: "2026-10-02" };
  const refund = recordRefund(owner, original.id, payload);
  assert.equal(refund.transaction.category_id, category.id);
  assert.equal(refund.transaction.expense_id, original.id);
  assert.deepEqual(refund.expense, { id: original.id, version: 2, amount_cents: 2000, refunded_cents: 1250 });
  assert.equal(getAccount(owner, cash.id).balance_cents, 8000);
  assert.equal(getAccount(owner, bank.id).balance_cents, 11250);
  assert.equal(getFinanceSummary(owner).money.balance_cents, 19250);
  assert.equal(getActivityTotals(owner, { month: "2026-09" }).expense_cents, 2000);
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), { currency: "PHP", month: "2026-10", income_cents: 0, expense_cents: -1250 });
  assert.equal(listTransactions(owner, { type: "refund", category_id: category.id }).total, 1);
  assert.deepEqual(recordRefund(owner, original.id, payload), refund);
  assert.throws(() => recordRefund(owner, original.id, { ...payload, request_id: "stale" }), { code: "version_conflict" });
  const current = getTransaction(owner, original.id);
  assert.equal(current.refunded_cents, 1250);
  assert.throws(() => recordRefund(owner, original.id, { ...payload, ...action(current.version), amount: "7.51" }), { code: "refund_limit" });
  assert.throws(() => correctActivity(owner, original.id, { ...action(current.version), amount: "12.49" }), { code: "refund_limit" });
  assert.throws(() => revertActivity(owner, original.id, action(current.version)), { code: "active_refunds" });
  const remaining = recordRefund(owner, original.id, { ...payload, ...action(current.version), amount: "7.50" });
  hideActivity(owner, remaining.transaction.id, action(remaining.transaction.version));
  assert.equal(getTransaction(owner, original.id).refunded_cents, 2000);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).expense_cents, -2000);
  const reverted = revertActivity(owner, refund.transaction.id, action(refund.transaction.version));
  assert.equal(reverted.balances[0].balance_cents, 10750);
  const hidden = getTransaction(owner, remaining.transaction.id);
  revertActivity(owner, hidden.id, action(hidden.version));
  assert.equal(getAccount(owner, bank.id).balance_cents, 10000);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).expense_cents, 0);
  revertActivity(owner, original.id, action(getTransaction(owner, original.id).version));
  assert.equal(getAccount(owner, cash.id).balance_cents, 10000);
});

test("refund corrections preserve limits and old/new accounts; category corrections follow the original expense", () => {
  const cash = account("Cash"), bank = account("Bank");
  const original = expense(cash.id);
  const refund = recordRefund(owner, original.id, { ...action(1), account_id: cash.id, amount: "10", transaction_date: "2026-10-01" }).transaction;
  assert.throws(() => correctActivity(owner, refund.id, { ...action(refund.version), amount: "20.01" }), { code: "refund_limit" });
  correctActivity(owner, refund.id, { ...action(refund.version), amount: "5", account_id: bank.id, transaction_date: "2026-11-01" });
  assert.equal(getAccount(owner, cash.id).balance_cents, 8000);
  assert.equal(getAccount(owner, bank.id).balance_cents, 10500);
  assert.equal(getTransaction(owner, original.id).refunded_cents, 500);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).expense_cents, 0);
  assert.equal(getActivityTotals(owner, { month: "2026-11" }).expense_cents, -500);
  const category = createClassification(owner, { request_id: "new-category", kind: "category", type: "expense", name: "Supplies" }).classification;
  correctActivity(owner, original.id, { ...action(getTransaction(owner, original.id).version), category_id: category.id });
  assert.equal(getTransaction(owner, refund.id).category_id, category.id);
});

test("linked transfer corrections roll back both accounts and fee on failure, and reversion cancels the group", () => {
  const source = account("Source"), destination = account("Destination"), other = account("Other");
  const category = createClassification(owner, { request_id: "fees", kind: "category", type: "expense", name: "Fees" }).classification;
  const transfer = postTransfer(owner, { request_id: "transfer", source_account_id: source.id, destination_account_id: destination.id, amount: "20", transaction_date: "2026-10-01", fee: { amount: "1", category_id: category.id } });
  const patch = { ...action(1), account_id: other.id, destination_account_id: source.id, amount: "30", fee: { version: 1, amount: "2", category_id: null, subcategory_id: null } };
  const db = getDb();
  db.exec("CREATE TEMP TRIGGER reject_correction BEFORE UPDATE ON finance_transactions BEGIN SELECT RAISE(ABORT, 'fee unavailable'); END;");
  try { assert.throws(() => correctActivity(owner, transfer.transaction.id, patch), /fee unavailable/); }
  finally { db.exec("DROP TRIGGER reject_correction"); }
  assert.equal(getAccount(owner, source.id).balance_cents, 7900);
  assert.equal(getAccount(owner, destination.id).balance_cents, 12000);
  assert.equal(getTransaction(owner, transfer.transaction.id).version, 1);
  const corrected = correctActivity(owner, transfer.transaction.id, patch);
  assert.equal(getAccount(owner, source.id).balance_cents, 13000);
  assert.equal(getAccount(owner, destination.id).balance_cents, 10000);
  assert.equal(getAccount(owner, other.id).balance_cents, 6800);
  assert.equal(corrected.fee?.account_id, other.id);
  assert.equal(corrected.fee?.category_id, null);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).expense_cents, 200);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).income_cents, 0);
  assert.throws(() => revertActivity(owner, corrected.fee!.id, action(corrected.fee!.version)), { code: "linked_activity" });
  const hidden = hideActivity(owner, corrected.transaction.id, action(corrected.transaction.version));
  assert.equal(getTransaction(owner, corrected.fee!.id).hidden, true);
  revertActivity(owner, hidden.transaction.id, action(hidden.transaction.version));
  for (const id of [source.id, destination.id, other.id]) assert.equal(getAccount(owner, id).balance_cents, 10000);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).expense_cents, 0);
});

test("adjustment corrections replace signed differences, preserve exclusions and atomically roll back audit failures", () => {
  const cash = account("Cash"), other = account("Other"), asset = account("Asset", "asset");
  const adjustment = reconcileAccount(owner, { request_id: "reconcile", account_id: cash.id, expected_balance_cents: 10000, actual_balance: "90", transaction_date: "2026-10-01" }).transaction;
  const patch = { ...action(1), account_id: other.id, amount: "-15" };
  const db = getDb();
  db.exec("CREATE TEMP TRIGGER reject_correction_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try { assert.throws(() => correctActivity(owner, adjustment.id, patch), /audit unavailable/); }
  finally { db.exec("DROP TRIGGER reject_correction_audit"); }
  assert.equal(getAccount(owner, cash.id).balance_cents, 9000);
  assert.equal(getAccount(owner, other.id).balance_cents, 10000);
  const corrected = correctActivity(owner, adjustment.id, patch);
  assert.equal(getAccount(owner, cash.id).balance_cents, 10000);
  assert.equal(getAccount(owner, other.id).balance_cents, 8500);
  assert.equal(corrected.transaction.actual_balance_cents, 8500);
  assert.throws(() => correctActivity(owner, corrected.transaction.id, { ...action(corrected.transaction.version), destination_account_id: cash.id }), { code: "invalid_input" });
  const valuation = valueAsset(owner, { request_id: "valuation", account_id: asset.id, expected_balance_cents: 10000, actual_balance: "110", transaction_date: "2026-10-01" }).transaction;
  const valued = correctActivity(owner, valuation.id, { ...action(1), amount: "5" });
  assert.equal(getFinanceSummary(owner).assets.balance_cents, 10500);
  revertActivity(owner, valued.transaction.id, action(valued.transaction.version));
  assert.equal(getFinanceSummary(owner).assets.balance_cents, 10000);
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), { currency: "PHP", month: "2026-10", income_cents: 0, expense_cents: 0 });
});
