import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../../src/lib/db";
import { createAccount, getAccount, updateAccount } from "../../src/features/finance/accounts";
import { postTransaction } from "../../src/features/finance/activity";
import { postTransfer } from "../../src/features/finance/movements";
import { revertActivity } from "../../src/features/finance/corrections";
import { getFinanceAttention } from "../../src/features/finance/overview";
import { statementDate, statementDueDate } from "../../src/features/finance/credit-statement";
import type { FinanceActor } from "../../src/features/finance/types";

// Test decision: add — statement date math and the credit-due Attention item are new behavior through the shared capabilities.
const vault = mkdtempSync(join(tmpdir(), "chibako-finance-credit-statement-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec(`
  DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_refunds; DELETE FROM finance_movements;
  DELETE FROM finance_cashbacks; DELETE FROM finance_transactions; DELETE FROM finance_accounts;
`));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

const request = () => randomUUID();
const card = (settings: object, opening = "0") => createAccount(owner, {
  request_id: request(), name: "Visa", kind: "credit", currency: "PHP", opening_balance: opening, credit_limit: "10000", ...settings,
}).account;
const cash = () => createAccount(owner, { request_id: request(), name: "Cash", kind: "money", currency: "PHP", opening_balance: "5000" }).account;
const charge = (account_id: string, amount: string, transaction_date: string) =>
  postTransaction(owner, { request_id: request(), type: "expense", account_id, amount, transaction_date });
const pay = (destination_account_id: string, source: string, amount: string, transaction_date: string) =>
  postTransfer(owner, { request_id: request(), source_account_id: source, destination_account_id, amount, transaction_date });
const cardItems = (as_of: string) => getFinanceAttention(owner, { as_of }).items.filter(item => item.kind === "credit_due");

test("statement date is the latest statement day on or before today, clamped to month end", () => {
  assert.equal(statementDate(25, "2026-11-01"), "2026-10-25");
  assert.equal(statementDate(25, "2026-11-25"), "2026-11-25");
  assert.equal(statementDate(31, "2026-02-28"), "2026-02-28");
  assert.equal(statementDate(31, "2026-02-27"), "2026-01-31");
  assert.equal(statementDate(31, "2028-02-29"), "2028-02-29");
  assert.equal(statementDate(30, "2026-03-15"), "2026-02-28");
  assert.equal(statementDate(15, "2026-01-10"), "2025-12-15");
});

test("due date is a clamped fixed day in the following month, or N days after the statement", () => {
  assert.equal(statementDueDate("2026-10-25", "fixed_day", 15), "2026-11-15");
  assert.equal(statementDueDate("2026-01-31", "fixed_day", 31), "2026-02-28");
  assert.equal(statementDueDate("2026-12-05", "fixed_day", 3), "2027-01-03");
  assert.equal(statementDueDate("2026-10-25", "after_statement", 21), "2026-11-15");
  assert.equal(statementDueDate("2026-12-20", "after_statement", 60), "2027-02-18");
});

test("remaining due is the statement balance less later payments and credits, floored at zero", () => {
  const visa = card({ statement_day: 25, due_mode: "fixed_day", due_value: 15 }, "-200");
  const payer = cash();
  charge(visa.id, "300", "2026-10-25");
  charge(visa.id, "1000", "2026-10-26"); // next cycle; not on this statement
  assert.deepEqual(cardItems("2026-11-01").map(item => [item.title, item.amount_cents, item.due_date, item.urgency, item.target]),
    [["Visa", 50000, "2026-11-15", "upcoming", "accounts"]]);

  const partial = pay(visa.id, payer.id, "120", "2026-10-30");
  postTransaction(owner, { request_id: request(), type: "income", account_id: payer.id, amount: "1", transaction_date: "2026-10-30" });
  assert.equal(cardItems("2026-11-01")[0].amount_cents, 38000);
  assert.equal(cardItems("2026-11-16")[0].urgency, "overdue");
  assert.equal(cardItems("2026-11-15")[0].urgency, "due");

  pay(visa.id, payer.id, "1000", "2026-10-31");
  assert.deepEqual(cardItems("2026-11-01"), []);
  revertActivity(owner, partial.transaction.id, { request_id: request(), version: partial.transaction.version });
  assert.deepEqual(cardItems("2026-11-01"), [], "overpayment after the statement still covers it");
});

test("cards without statement settings, archived, or with nothing owed show no reminder", () => {
  const noSettings = card({}, "-500");
  assert.deepEqual([noSettings.statement_date, noSettings.statement_balance_cents, noSettings.remaining_due_cents, noSettings.next_due_date], [null, null, null, null]);
  const noDueRule = card({ statement_day: 25 }, "-500");
  assert.equal(noDueRule.statement_balance_cents, 50000);
  assert.equal(noDueRule.next_due_date, null);
  card({ statement_day: 25, due_mode: "after_statement", due_value: 20 });
  const archived = card({ statement_day: 25, due_mode: "fixed_day", due_value: 15 }, "-500");
  updateAccount(owner, archived.id, { request_id: request(), version: archived.version, archived: true });
  const money = cash();
  assert.equal(getAccount(owner, money.id).next_due_date, null);
  assert.deepEqual(cardItems("2026-11-01"), []);
});
