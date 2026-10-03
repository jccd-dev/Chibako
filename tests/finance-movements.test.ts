import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createAccount, getAccount, getFinanceSummary, updateAccount } from "../src/features/finance/accounts";
import { getActivityTotals, getTransaction, listTransactions, postTransaction } from "../src/features/finance/activity";
import { createClassification } from "../src/features/finance/classifications";
import { postTransfer, reconcileAccount, valueAsset } from "../src/features/finance/movements";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-movements-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_movements; DELETE FROM finance_transactions; DELETE FROM finance_classifications; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
function account(name: string, opening = "100.00", kind = "money") {
  return createAccount(owner, { request_id: randomUUID(), name, kind, currency: "PHP", opening_balance: opening }).account;
}
function transfer(source: string, destination: string) {
  return { request_id: randomUUID(), source_account_id: source, destination_account_id: destination, amount: "25.01", transaction_date: "2026-10-03" };
}

test("one transfer changes both balances; a linked categorized fee alone counts as spending", () => {
  const cash = account("Cash"), bank = account("Bank", "0");
  const category = createClassification(owner, { request_id: "fees", kind: "category", type: "expense", name: "Bank fees" }).classification;
  const payload = { ...transfer(cash.id, bank.id), text: "Moving savings", fee: { amount: "1.50", category_id: category.id } };
  const result = postTransfer(owner, payload);
  assert.deepEqual(result.balances, [{ account_id: cash.id, balance_cents: 7349 }, { account_id: bank.id, balance_cents: 2501 }]);
  assert.equal(getAccount(owner, cash.id).balance_cents, 7349);
  assert.equal(getAccount(owner, bank.id).balance_cents, 2501);
  assert.equal(getFinanceSummary(owner).money.balance_cents, 9850);
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), { currency: "PHP", month: "2026-10", income_cents: 0, expense_cents: 150 });
  assert.equal(listTransactions(owner, { type: "transfer", account_id: bank.id }).total, 1);
  assert.equal(listTransactions(owner, { type: "expense", category_id: category.id }).total, 1);
  assert.equal(listTransactions(owner).total, 2);
  assert.equal(result.transaction.type, "transfer");
  assert.equal(result.fee?.type, "expense");
  assert.equal(getTransaction(owner, result.fee!.id).linked_record_id, result.transaction.id);
  assert.equal(getTransaction(owner, result.transaction.id).fee_transaction_id, result.fee!.id);
  assert.equal("text" in result.transaction, false);
  assert.equal(getTransaction(owner, result.transaction.id, { include_details: true }).text, "Moving savings");
  assert.deepEqual(postTransfer(owner, payload), result);
  assert.throws(() => postTransfer(owner, { ...payload, amount: "26" }), { code: "request_conflict" });
});

test("reconciliation and asset valuation append dated differences without reporting income or spending", () => {
  const cash = account("Cash"), asset = account("Motorcycle", "500", "asset");
  const payload = { request_id: "reconcile", account_id: cash.id, actual_balance: "90.25", expected_balance_cents: 10000, transaction_date: "2026-09-30", text: "Counted cash" };
  const correction = reconcileAccount(owner, payload);
  assert.equal(correction.transaction.amount_cents, -975);
  assert.equal(correction.balances[0].balance_cents, 9025);
  assert.equal(getAccount(owner, cash.id).opening_balance_cents, 10000);
  assert.equal(getTransaction(owner, correction.transaction.id).compared_balance_cents, 10000);
  assert.equal(getTransaction(owner, correction.transaction.id).actual_balance_cents, 9025);
  const valuation = valueAsset(owner, { ...payload, request_id: "value", account_id: asset.id, expected_balance_cents: 50000, actual_balance: "650.50", transaction_date: "2026-10-01" });
  assert.equal(valuation.transaction.amount_cents, 15050);
  assert.equal(getAccount(owner, asset.id).balance_cents, 65050);
  assert.equal(getFinanceSummary(owner).money.balance_cents, 9025);
  assert.equal(getFinanceSummary(owner).assets.balance_cents, 65050);
  for (const month of ["2026-09", "2026-10"]) assert.deepEqual(getActivityTotals(owner, { month }), { currency: "PHP", month, income_cents: 0, expense_cents: 0 });
  assert.equal(listTransactions(owner, { type: "reconciliation", date_to: "2026-09-30" }).total, 1);
  assert.equal(listTransactions(owner, { type: "valuation", account_id: asset.id }).total, 1);
  assert.deepEqual(reconcileAccount(owner, payload), correction);
  assert.throws(() => reconcileAccount(owner, { ...payload, request_id: "stale" }), { status: 409, code: "balance_conflict" });
  const negative = reconcileAccount(owner, { ...payload, request_id: "negative", expected_balance_cents: 9025, actual_balance: "-1.01" });
  assert.deepEqual(negative.warnings, ["negative_balance"]);
  assert.equal(negative.transaction.amount_cents, -9126);
  assert.equal(getAccount(owner, cash.id).balance_cents, -101);
  const audit = getDb().prepare("SELECT before_json, after_json FROM finance_audit WHERE request_id = 'reconcile'").get() as { before_json: string; after_json: string };
  assert.equal(JSON.parse(audit.before_json).balance_cents, 10000);
  assert.equal(JSON.parse(audit.after_json).transaction.amount_cents, -975);
});

test("linked effects, audit and retry outcome roll back together, then a retry posts once", () => {
  const source = account("Source", "1"), target = account("Target", "0");
  const category = createClassification(owner, { request_id: "fee-category", kind: "category", type: "expense", name: "Fees" }).classification;
  const payload = { ...transfer(source.id, target.id), fee: { amount: "1", category_id: category.id } };
  const db = getDb();
  // Failure after fee insertion must not leave a fee or either transfer effect.
  db.exec("CREATE TEMP TRIGGER reject_movement BEFORE INSERT ON finance_movements BEGIN SELECT RAISE(ABORT, 'movement unavailable'); END;");
  try { assert.throws(() => postTransfer(owner, payload), /movement unavailable/); }
  finally { db.exec("DROP TRIGGER reject_movement"); }
  assert.equal(getAccount(owner, source.id).balance_cents, 100);
  assert.equal(getAccount(owner, target.id).balance_cents, 0);
  assert.equal(listTransactions(owner).total, 0);
  db.exec("CREATE TEMP TRIGGER reject_movement_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try { assert.throws(() => postTransfer(owner, payload), /audit unavailable/); }
  finally { db.exec("DROP TRIGGER reject_movement_audit"); }
  assert.equal(listTransactions(owner).total, 0);
  const original = postTransfer(owner, payload);
  assert.deepEqual(original.warnings, ["negative_balance"]);
  postTransaction(owner, { request_id: "later", type: "income", amount: "10", account_id: target.id, transaction_date: "2026-10-04" });
  assert.deepEqual(postTransfer(owner, payload), original);
  assert.equal(listTransactions(owner).total, 3);
  assert.equal(getAccount(owner, source.id).balance_cents, -2501);
  assert.equal(getAccount(owner, target.id).balance_cents, 3501);
  const audit = db.prepare("SELECT affected_ids, actor_id FROM finance_audit WHERE request_id = ?").get(payload.request_id) as { affected_ids: string; actor_id: string };
  assert.deepEqual(new Set(JSON.parse(audit.affected_ids)), new Set([source.id, target.id, original.transaction.id, original.fee!.id]));
  assert.equal(audit.actor_id, "owner");
});

test("invalid movements reject account kinds, dates, currencies, fees and unsafe cent ranges without effects", () => {
  const source = account("Source"), target = account("Target"), asset = account("Asset", "1", "asset");
  const payload = transfer(source.id, target.id);
  for (const patch of [{ destination_account_id: source.id }, { destination_account_id: asset.id }, { amount: "0" }, { amount: "-1" }, { amount: "0.001" }, { amount: "1e2" }, { amount: "90071992547409.92" }, { currency: "USD" }, { transaction_date: "2025-02-29" }, { fee: { amount: "1" } }]) assert.throws(() => postTransfer(owner, { ...payload, ...patch }), { status: 400 });
  const income = createClassification(owner, { request_id: "income-cat", kind: "category", type: "income", name: "Income" }).classification;
  assert.throws(() => postTransfer(owner, { ...payload, fee: { amount: "1", category_id: income.id } }), { code: "invalid_category" });
  const max = account("Max", "90071992547409.91");
  assert.throws(() => postTransfer(owner, { ...payload, destination_account_id: max.id, amount: "0.01" }), { code: "amount_out_of_range" });
  updateAccount(owner, target.id, { request_id: "archive", version: 1, archived: true });
  assert.throws(() => postTransfer(owner, payload), { code: "invalid_account" });
  const adjustment = { request_id: "adjust", account_id: source.id, actual_balance: "1", expected_balance_cents: 10000, transaction_date: "2026-10-03" };
  assert.throws(() => valueAsset(owner, adjustment), { code: "invalid_account" });
  assert.throws(() => reconcileAccount(owner, { ...adjustment, account_id: asset.id, expected_balance_cents: 100 }), { code: "invalid_account" });
  for (const patch of [{ currency: "USD" }, { transaction_date: "2026-04-31" }, { actual_balance: "1.001" }, { expected_balance_cents: 0.1 }]) assert.throws(() => reconcileAccount(owner, { ...adjustment, ...patch }), { status: 400 });
  assert.throws(() => reconcileAccount(owner, { ...adjustment, account_id: max.id, expected_balance_cents: Number.MAX_SAFE_INTEGER, actual_balance: "-90071992547409.91" }), { code: "amount_out_of_range" });
  assert.equal(listTransactions(owner).total, 0);
  assert.equal(getAccount(owner, source.id).balance_cents, 10000);
});
