import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../../src/lib/db";
import { createAccount, getAccount } from "../../src/features/finance/accounts";
import { postTransaction, listTransactions } from "../../src/features/finance/activity";
import { createClassification } from "../../src/features/finance/classifications";
import { createObligation, postObligationMovement, postObligationPayment } from "../../src/features/finance/obligations";
import { createPlan, postPlan } from "../../src/features/finance/planning";
import { postTransfer } from "../../src/features/finance/movements";
import type { FinanceActor } from "../../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-insufficient-funds-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec(`
  DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_obligation_writeoffs;
  DELETE FROM finance_obligation_payments; DELETE FROM finance_obligation_movements; DELETE FROM finance_plans;
  DELETE FROM finance_refunds; DELETE FROM finance_movements; DELETE FROM finance_cashbacks;
  DELETE FROM finance_transactions; DELETE FROM finance_obligations; DELETE FROM finance_classifications;
  DELETE FROM finance_accounts;
`));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

const request = () => randomUUID();
function account(opening: string) {
  return createAccount(owner, { request_id: request(), name: "Cash", kind: "money", opening_balance: opening, currency: "PHP" }).account;
}

test("expense rejection ignores cashback, rolls back, and the same request succeeds when funded", () => {
  createClassification(owner, { request_id: request(), kind: "category", type: "income", name: "Cashback" });
  const cash = account("9.99"), payload = { request_id: request(), account_id: cash.id, amount: "10", transaction_date: "2026-10-03", cashback: { mode: "amount" as const, value: "1" } };
  assert.throws(() => postTransaction(owner, payload), { code: "insufficient_funds" });
  assert.equal(getAccount(owner, cash.id).balance_cents, 999);
  assert.equal(listTransactions(owner, { hidden: "all", reverted: "all" }).total, 0);
  assert.equal(getDb().prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM finance_requests WHERE request_id=?").get(payload.request_id)?.count, 0);

  postTransaction(owner, { request_id: request(), type: "income", account_id: cash.id, amount: "0.01", transaction_date: "2026-10-03" });
  const posted = postTransaction(owner, payload);
  assert.equal(posted.balance_cents, 100);
  assert.deepEqual(postTransaction(owner, payload), posted);
});

test("a planned expense remains payable against raw balance despite reserved plans", () => {
  const cash = account("10"), plan = createPlan(owner, { request_id: request(), type: "expense", account_id: cash.id, amount: "10", due_date: "2026-10-03" }).plan;
  assert.equal(getAccount(owner, cash.id).spendable_cents, 0);
  const payload = { request_id: request(), version: plan.version, account_id: cash.id, amount: "11", transaction_date: "2026-10-03" };
  assert.throws(() => postPlan(owner, plan.id, payload), { code: "insufficient_funds" });
  assert.equal(getAccount(owner, cash.id).balance_cents, 1000);
  assert.equal(listTransactions(owner, { hidden: "all", reverted: "all" }).total, 0);
  assert.equal(getDb().prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM finance_requests WHERE request_id=?").get(payload.request_id)?.count, 0);
  assert.deepEqual(getDb().prepare<[string], { status: string; version: number }>("SELECT status, version FROM finance_plans WHERE id=?").get(plan.id), { status: "pending", version: plan.version });
  assert.equal(getDb().prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM finance_audit WHERE request_id=?").get(payload.request_id)?.count, 0);
  const posted = postPlan(owner, plan.id, { ...payload, amount: "10" });
  assert.equal(posted.balance_cents, 0);
  assert.equal(getAccount(owner, cash.id).balance_cents, 0);
});

test("transfers and lending reject gross outgoing amounts beyond raw balance", () => {
  const cash = account("1"), target = account("0");
  assert.throws(() => postTransfer(owner, { request_id: request(), source_account_id: cash.id, destination_account_id: target.id, amount: "1.01", transaction_date: "2026-10-03" }), { code: "insufficient_funds" });
  assert.throws(() => postObligationMovement(owner, { request_id: request(), type: "lending", name: "Receivable", account_id: cash.id, amount: "1.01", transaction_date: "2026-10-03" }), { code: "insufficient_funds" });
  assert.equal(getAccount(owner, cash.id).balance_cents, 100);
  assert.equal(getAccount(owner, target.id).balance_cents, 0);
  assert.equal(listTransactions(owner, { hidden: "all", reverted: "all" }).total, 0);
  assert.equal(getDb().prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM finance_obligations").get()?.count, 0);
});

test("debt payment plus expense fee is atomic and exact-balance payment succeeds", () => {
  const cash = account("5"), obligation = createObligation(owner, { request_id: request(), kind: "debt", name: "Debt", principal: "3" }).obligation;
  const payload = { request_id: request(), obligation_id: obligation.id, obligation_version: obligation.version, account_id: cash.id, amount: "3", transaction_date: "2026-10-03", fee: { type: "expense" as const, amount: "2.01", category_id: null, subcategory_id: null } };
  assert.throws(() => postObligationPayment(owner, payload), { code: "insufficient_funds" });
  assert.equal(getAccount(owner, cash.id).balance_cents, 500);
  assert.equal(listTransactions(owner, { hidden: "all", reverted: "all" }).total, 0);
  assert.equal(getDb().prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM finance_obligation_payments").get()?.count, 0);
  assert.equal(getDb().prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM finance_audit WHERE request_id=?").get(payload.request_id)?.count, 0);
  assert.deepEqual(getDb().prepare<[string], { version: number }>("SELECT version FROM finance_obligations WHERE id=?").get(obligation.id), { version: obligation.version });

  const funded = { ...payload, request_id: request(), fee: { ...payload.fee, amount: "2" } };
  const payment = postObligationPayment(owner, funded);
  assert.equal(payment.balances[0].balance_cents, 0);
  assert.equal(payment.obligation.outstanding_cents, 0);
  assert.deepEqual(postObligationPayment(owner, funded), payment);
});

test("matched debt activity is not charged twice, and incoming principal can fund its fee", () => {
  const cash = account("1"), debt = createObligation(owner, { request_id: request(), kind: "debt", name: "Matched debt", principal: "1" }).obligation;
  const expense = postTransaction(owner, { request_id: request(), type: "expense", account_id: cash.id, amount: "1", transaction_date: "2026-10-03" }).transaction;
  assert.equal(getAccount(owner, cash.id).balance_cents, 0);
  const matched = postObligationPayment(owner, { request_id: request(), obligation_id: debt.id, obligation_version: debt.version, account_id: cash.id, amount: "1", transaction_date: expense.transaction_date, text: "", cash_activity_id: expense.id, cash_activity_version: expense.version });
  assert.equal(matched.balances[0].balance_cents, 0);

  const receivable = createObligation(owner, { request_id: request(), kind: "receivable", name: "Receivable", principal: "3" }).obligation;
  const collected = postObligationPayment(owner, { request_id: request(), obligation_id: receivable.id, obligation_version: receivable.version, account_id: cash.id, amount: "3", transaction_date: "2026-10-03", text: "", fee: { type: "expense", amount: "3", category_id: null, subcategory_id: null } });
  assert.equal(collected.balances[0].balance_cents, 0);
});
