import { applyCashback } from "../../src/features/finance/cashbacks";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../../src/lib/db";
import { createAccount, getAccount, getFinanceSummary } from "../../src/features/finance/accounts";
import { getTransaction, listTransactions, postTransaction } from "../../src/features/finance/activity";
import { createClassification } from "../../src/features/finance/classifications";
import { postTransfer } from "../../src/features/finance/movements";
import { correctActivity, recordRefund, revertActivity } from "../../src/features/finance/corrections";
import type { FinanceActor } from "../../src/features/finance/types";

// Test decision: add, integration — card spending, payments and corrections are new money paths through shared capabilities.
const vault = mkdtempSync(join(tmpdir(), "chibako-finance-credit-spending-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec(`
  DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_refunds; DELETE FROM finance_movements;
  DELETE FROM finance_cashbacks; DELETE FROM finance_transactions; DELETE FROM finance_classifications; DELETE FROM finance_accounts;
`));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

const request = () => randomUUID();
const money = (opening: string) => createAccount(owner, { request_id: request(), name: "Cash", kind: "money", currency: "PHP", opening_balance: opening }).account;
const card = (limit: string, opening = "0") => createAccount(owner, { request_id: request(), name: "Visa", kind: "credit", currency: "PHP", opening_balance: opening, credit_limit: limit }).account;
const expense = (account_id: string, amount: string, extra: object = {}) =>
  postTransaction(owner, { request_id: request(), type: "expense", account_id, amount, transaction_date: "2026-10-03", ...extra });
const balance = (id: string) => getAccount(owner, id).balance_cents;

test("card expenses spend available credit, and an overrun is rejected with the limit message and no write", () => {
  const visa = card("100", "-30");
  const rejected = { request_id: request(), type: "expense", account_id: visa.id, amount: "70.01", transaction_date: "2026-10-03" };
  assert.throws(() => postTransaction(owner, rejected), { status: 409, code: "credit_limit_exceeded", message: "This exceeds the available credit on this card" });
  assert.equal(listTransactions(owner, { hidden: "all", reverted: "all" }).total, 0);
  assert.deepEqual(getDb().prepare("SELECT COUNT(*) AS count FROM finance_requests WHERE request_id = ?").get(rejected.request_id), { count: 0 });

  const posted = expense(visa.id, "70");
  assert.equal(posted.balance_cents, -10000);
  assert.deepEqual(posted.warnings, []);
  const after = getAccount(owner, visa.id);
  assert.deepEqual([after.used_credit_cents, after.available_credit_cents], [10000, 0]);
  assert.throws(() => expense(visa.id, "0.01"), { code: "credit_limit_exceeded" });
  assert.throws(() => postTransaction(owner, { request_id: request(), type: "income", account_id: visa.id, amount: "5", transaction_date: "2026-10-03" }), { status: 400, code: "invalid_account" });
});

test("paying a card by transfer reduces what is owed without counting spending twice, and overpaying leaves a credit", () => {
  const cash = money("100"), visa = card("500");
  expense(visa.id, "80");
  const spentBefore = listTransactions(owner, { type: "expense" }).total;
  const summaryBefore = getFinanceSummary(owner);
  assert.deepEqual([summaryBefore.money.balance_cents, summaryBefore.credit.balance_cents], [10000, -8000]);

  const payment = postTransfer(owner, { request_id: request(), source_account_id: cash.id, destination_account_id: visa.id, amount: "50", transaction_date: "2026-10-04" });
  assert.deepEqual(payment.balances, [{ account_id: cash.id, balance_cents: 5000 }, { account_id: visa.id, balance_cents: -3000 }]);
  assert.equal(listTransactions(owner, { type: "expense" }).total, spentBefore);
  const summary = getFinanceSummary(owner);
  assert.deepEqual([summary.money.balance_cents, summary.credit.balance_cents], [5000, -3000]);

  assert.throws(() => postTransfer(owner, { request_id: request(), source_account_id: cash.id, destination_account_id: visa.id, amount: "50.01", transaction_date: "2026-10-04" }), { code: "insufficient_funds" });
  assert.throws(() => postTransfer(owner, { request_id: request(), source_account_id: visa.id, destination_account_id: cash.id, amount: "1", transaction_date: "2026-10-04" }), { status: 400, code: "invalid_account" });
  assert.deepEqual([balance(cash.id), balance(visa.id)], [5000, -3000]);

  postTransfer(owner, { request_id: request(), source_account_id: cash.id, destination_account_id: visa.id, amount: "50", transaction_date: "2026-10-05" });
  const overpaid = getAccount(owner, visa.id);
  assert.deepEqual([overpaid.balance_cents, overpaid.used_credit_cents, overpaid.available_credit_cents], [2000, 0, 52000]);
});

test("refunds and reverts of card expenses and payments restore both balances exactly", () => {
  const cash = money("200"), visa = card("500");
  const purchase = expense(visa.id, "120").transaction;
  const refund = recordRefund(owner, purchase.id, { request_id: request(), version: purchase.version, amount: "20", account_id: visa.id, transaction_date: "2026-10-06" });
  assert.equal(balance(visa.id), -10000);
  const payment = postTransfer(owner, { request_id: request(), source_account_id: cash.id, destination_account_id: visa.id, amount: "100", transaction_date: "2026-10-07" }).transaction;
  assert.deepEqual([balance(cash.id), balance(visa.id)], [10000, 0]);

  revertActivity(owner, payment.id, { request_id: request(), version: payment.version });
  assert.deepEqual([balance(cash.id), balance(visa.id)], [20000, -10000]);
  revertActivity(owner, refund.transaction.id, { request_id: request(), version: refund.transaction.version });
  assert.equal(balance(visa.id), -12000);
  const current = listTransactions(owner, { type: "expense" }).transactions[0];
  revertActivity(owner, purchase.id, { request_id: request(), version: current.version });
  assert.deepEqual([balance(cash.id), balance(visa.id)], [20000, 0]);
});

test("cashback on a card expense credits the card and keeps its own corrected credited date", () => {
  createClassification(owner, { request_id: request(), kind: "category", type: "income", name: "Cashback" });
  const visa = card("1000");
  const posted = expense(visa.id, "200", { cashback: { mode: "amount", value: "5" } });
  const applied = applyCashback(owner, posted.transaction.id, { request_id: request(), version: posted.transaction.version, transaction_date: "2026-11-01" });
  posted.transaction = applied.transaction;
  const cashback = applied.cashback;
  assert.ok(cashback);
  assert.equal(cashback.account_id, visa.id);
  assert.equal(posted.balance_cents, -20000);
  assert.equal(getAccount(owner, visa.id).used_credit_cents, 19500);

  const moved = correctActivity(owner, cashback.id, { request_id: request(), version: cashback.version, transaction_date: "2026-11-02" });
  assert.equal(moved.transaction.transaction_date, "2026-11-02");
  assert.throws(() => correctActivity(owner, cashback.id, { request_id: request(), version: moved.transaction.version, amount: "9" }), { status: 409, code: "linked_activity" });

  const corrected = correctActivity(owner, posted.transaction.id, { request_id: request(), version: getTransaction(owner, posted.transaction.id).version, text: "Groceries" });
  assert.equal(corrected.cashback?.transaction_date, "2026-11-02");
  assert.equal(balance(visa.id), -19500);
});
