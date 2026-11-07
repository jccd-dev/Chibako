import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../../src/lib/db";
import { createAccount, getAccount } from "../../src/features/finance/accounts";
import { postTransaction, getTransaction } from "../../src/features/finance/activity";
import { postTransfer } from "../../src/features/finance/movements";
import { getCreditCycles } from "../../src/features/finance/credit-cycles";
import { getCardPaymentOptions, recordCardPayment } from "../../src/features/finance/card-payments";
import { getFinanceAttention } from "../../src/features/finance/overview";
import { confirmStatement } from "../../src/features/finance/statements";
import type { FinanceActor } from "../../src/features/finance/types";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { POST as paymentRest } from "../../src/app/api/finance/accounts/[id]/payment/route";
import { GET as cyclesRest } from "../../src/app/api/finance/accounts/[id]/cycles/route";
import { POST as remote } from "../../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-card-payments-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
const req = () => randomUUID();
beforeEach(() => getDb().exec(`DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_cashback_applications;
DELETE FROM finance_cashbacks; DELETE FROM finance_refunds; DELETE FROM finance_movements; DELETE FROM finance_transactions;
DELETE FROM finance_credit_statements; UPDATE finance_accounts SET payment_account_id=NULL; DELETE FROM finance_accounts;`));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
function setup() {
  const cash = createAccount(owner, { request_id: req(), name: "Payment test cash", kind: "money", currency: "PHP", opening_balance: "20000" }).account;
  const card = createAccount(owner, { request_id: req(), name: "Payment test card", kind: "credit", currency: "PHP", opening_balance: "0", credit_limit: "30000", statement_day: 15, due_mode: "fixed_day", due_value: 5, payment_account_id: cash.id }).account;
  return { cash, card };
}
const charge = (id: string, amount: string, date: string, reward = false) => postTransaction(owner, { request_id: req(), account_id: id, amount, transaction_date: date, ...(reward ? { cashback: { mode: "percent", value: "2" } } : {}) }).transaction;

test("expenses sum by inclusive cutoff with upcoming due and distinct reminders", () => {
  const { card } = setup();
  charge(card.id, "100", "2026-09-15");
  charge(card.id, "5000", "2026-09-16");
  charge(card.id, "2000", "2026-10-05");
  charge(card.id, "3000", "2026-10-15");
  charge(card.id, "700", "2026-10-16");
  const cycles = getCreditCycles(owner, card.id, "2026-10-30");
  const october = cycles.find(c => c.statement_date === "2026-10-15")!;
  const november = cycles.find(c => c.statement_date === "2026-11-15")!;
  assert.equal(october.remaining_due_cents, 1000000);
  assert.equal(october.due_date, "2026-11-05");
  assert.deepEqual([november.cycle_start, november.soa_date, november.due_date, november.remaining_due_cents, november.status], ["2026-10-16", "2026-11-16", "2026-12-05", 70000, "upcoming"]);
  const reminders = getFinanceAttention(owner, { as_of: "2026-10-30" }).items.filter(item => item.reference_id === card.id);
  assert.equal(reminders.length, 3);
  assert.equal(new Set(reminders.map(item => item.id)).size, 3);
});

test("early full payment leaves cashback pending and removes paid reminder", () => {
  const { cash, card } = setup();
  const expense = charge(card.id, "5000", "2026-09-30", true);
  const input = { request_id: req(), version: card.version, statement_date: "2026-10-15", source_account_id: cash.id, amount: "5000", transaction_date: "2026-10-10" };
  const paid = recordCardPayment(owner, card.id, input);
  assert.equal(paid.account.balance_cents, 0);
  assert.equal(getTransaction(owner, expense.id).cashback_pending_cents, 10000);
  assert.deepEqual(recordCardPayment(owner, card.id, input), paid);
  assert.equal(getAccount(owner, cash.id).balance_cents, 1500000);
  assert.equal(getFinanceAttention(owner, { as_of: "2026-10-20" }).items.some(item => item.reference_id === card.id), false);
});

test("partial cashback plus cash posts once, and later cashback-only settlement works", () => {
  const { cash, card } = setup();
  const expense = charge(card.id, "5000", "2026-09-30", true);
  const result = recordCardPayment(owner, card.id, { request_id: req(), version: card.version, statement_date: "2026-10-15", source_account_id: cash.id, amount: "4900", transaction_date: "2026-10-20", cashbacks: [{ expense_id: expense.id, version: expense.version, amount: "40", transaction_date: "2026-10-20" }] });
  assert.equal(result.account.balance_cents, -6000);
  assert.equal(getTransaction(owner, expense.id).cashback_pending_cents, 6000);
  const final = recordCardPayment(owner, card.id, { request_id: req(), version: result.account.version, statement_date: "2026-10-15", amount: "0", transaction_date: "2026-10-21", cashbacks: [{ expense_id: expense.id, version: getTransaction(owner, expense.id).version, amount: "60", transaction_date: "2026-10-21" }] });
  assert.equal(final.account.balance_cents, 0);
  assert.equal(getAccount(owner, cash.id).balance_cents, 1510000);
  assert.equal(getCardPaymentOptions(owner, card.id).rewards.length, 0);
});

test("failure rolls back selected cashback, audit and payment, and denied/stale/future inputs cannot write", () => {
  const { cash, card } = setup();
  const expense = charge(card.id, "5000", "2026-09-30", true);
  const input = { request_id: req(), version: card.version, statement_date: "2026-10-15", source_account_id: cash.id, amount: "30000", transaction_date: "2026-10-20", cashbacks: [{ expense_id: expense.id, version: expense.version, amount: "40", transaction_date: "2026-10-20" }] };
  const count = getDb().prepare("SELECT COUNT(*) count FROM finance_audit").get();
  assert.throws(() => recordCardPayment(owner, card.id, input), { code: "insufficient_funds" });
  assert.deepEqual(getDb().prepare("SELECT COUNT(*) count FROM finance_audit").get(), count);
  assert.equal(getTransaction(owner, expense.id).cashback_pending_cents, 10000);
  assert.equal(getAccount(owner, card.id).version, card.version);
  assert.throws(() => recordCardPayment({ kind: "api-key", id: "reader", scopes: ["finance:read"] }, card.id, input), { status: 403 });
  assert.throws(() => recordCardPayment(owner, card.id, { ...input, version: 99 }), { code: "version_conflict" });
  assert.throws(() => postTransfer(owner, { request_id: req(), source_account_id: cash.id, destination_account_id: card.id, amount: "1", transaction_date: "2099-01-01" }), { code: "invalid_date" });
});

test("confirmed carry-forward does not duplicate old unpaid cycles; payments settle oldest first", () => {
  const { cash, card } = setup();
  charge(card.id, "1000", "2026-08-30");
  charge(card.id, "2000", "2026-09-30");
  confirmStatement(owner, card.id, { request_id: req(), version: 1, statement_date: "2026-10-15", balance: "3100", minimum_due: "300", due_date: "2026-11-05" });
  postTransfer(owner, { request_id: req(), source_account_id: cash.id, destination_account_id: card.id, amount: "1500", transaction_date: "2026-10-20" });
  const cycles = getCreditCycles(owner, card.id, "2026-10-25");
  assert.equal(cycles.find(c => c.statement_date === "2026-09-15")!.remaining_due_cents, 0);
  assert.equal(cycles.find(c => c.statement_date === "2026-10-15")!.remaining_due_cents, 160000);
  assert.equal(cycles.reduce((sum, c) => sum + c.remaining_due_cents, 0), 160000);
});

test("REST and MCP share payment replay and independent read/write scopes", async () => {
  const { cash, card } = setup();
  charge(card.id, "5000", "2026-09-30", true);
  const writer = createApiKey("Card payment writer", ["finance:write"]);
  const reader = createApiKey("Card payment reader", ["finance:read"]);
  const input = { request_id: req(), version: card.version, statement_date: "2026-10-15", source_account_id: cash.id, amount: "1000", transaction_date: "2026-10-20" };
  const context = { params: Promise.resolve({ id: card.id }) };
  const request = (key: string, body?: object) => new Request("https://chibako.test/api/finance", { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const rest = await paymentRest(request(writer.key, input), context);
  assert.equal(rest.status, 200);
  const response = await remote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${writer.key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: req(), method: "tools/call", params: { name: "record_finance_card_payment", arguments: { id: card.id, ...input } } }) }));
  assert.deepEqual((await response.json()).result.structuredContent, await rest.json());
  assert.equal((await paymentRest(request(reader.key, input), context)).status, 403);
  assert.equal((await cyclesRest(request(writer.key), context)).status, 403);
  assert.equal((await cyclesRest(request(reader.key), context)).status, 200);
  assert.equal(getAccount(owner, cash.id).balance_cents, 1900000);
});

test("a payment toward older debt also covers the newer confirmed cumulative minimum", () => {
  const { cash, card } = setup();
  charge(card.id, "1000", "2026-08-30");
  charge(card.id, "2000", "2026-09-30");
  confirmStatement(owner, card.id, { request_id: req(), version: 1, statement_date: "2026-10-15", balance: "3000", minimum_due: "300", due_date: "2026-11-05" });
  postTransfer(owner, { request_id: req(), source_account_id: cash.id, destination_account_id: card.id, amount: "300", transaction_date: "2026-10-20" });
  const cycle = getCreditCycles(owner, card.id, "2026-11-06").find(c => c.statement_date === "2026-10-15")!;
  assert.equal(cycle.remaining_minimum_cents, 0);
});

test("actual bank cutoff replaces the monthly estimated cycle and due date", () => {
  const { card } = setup();
  charge(card.id, "5000", "2026-09-30");
  charge(card.id, "100", "2026-10-16");
  confirmStatement(owner, card.id, { request_id: req(), version: 1, statement_date: "2026-10-16", balance: "5100", minimum_due: "500", due_date: "2026-11-08" });
  const cycles = getCreditCycles(owner, card.id, "2026-11-06");
  assert.equal(cycles.some(c => c.statement_date === "2026-10-15"), false);
  const bank = cycles.find(c => c.statement_date === "2026-10-16")!;
  assert.equal(bank.cycle_start, "2026-09-16");
  assert.equal(bank.remaining_due_cents, 510000);
  assert.equal(bank.due_date, "2026-11-08");
  assert.equal(cycles.find(c => c.statement_date === "2026-11-15")!.cycle_start, "2026-10-17");
});

test("bank cutoff shifted across month end replaces its nearest nominal cutoff", () => {
  const { card } = setup();
  getDb().prepare("UPDATE finance_accounts SET statement_day=31 WHERE id=?").run(card.id);
  charge(card.id, "5000", "2026-02-10");
  confirmStatement(owner, card.id, { request_id: req(), version: 1, statement_date: "2026-03-01", balance: "5000", minimum_due: "500", due_date: "2026-03-25" });
  const cycles = getCreditCycles(owner, card.id, "2026-03-10");
  assert.equal(cycles.some(c => c.statement_date === "2026-02-28"), false);
  assert.equal(cycles.find(c => c.statement_date === "2026-03-01")!.remaining_due_cents, 500000);
  assert.equal(cycles.find(c => c.status === "upcoming")!.statement_date, "2026-03-31");
  assert.equal(cycles.find(c => c.status === "upcoming")!.cycle_start, "2026-03-02");
});

test("a corrected cutoff explicitly supersedes the prior confirmation in its nominal cycle", () => {
  const { card } = setup();
  charge(card.id, "5000", "2026-09-30");
  const first = confirmStatement(owner, card.id, { request_id: req(), version: 1, statement_date: "2026-10-16", balance: "5000", minimum_due: "500", due_date: "2026-11-08" });
  confirmStatement(owner, card.id, { request_id: req(), version: first.account.version, statement_date: "2026-10-14", balance: "5000", minimum_due: "500", due_date: "2026-11-06" });
  const saved = getDb().prepare("SELECT COUNT(*) count FROM finance_credit_statements WHERE account_id=?").get(card.id) as { count: number };
  assert.equal(saved.count, 1);
  const bank = getCreditCycles(owner, card.id, "2026-11-06").find(c => c.confirmed)!;
  assert.equal(bank.statement_date, "2026-10-14");
  assert.equal(bank.due_date, "2026-11-06");
});

test("cashback credited by a confirmed cutoff is already included in the bank figure", () => {
  const { cash, card } = setup();
  const expense = charge(card.id, "5000", "2026-09-30", true);
  const confirmed = confirmStatement(owner, card.id, { request_id: req(), version: 1, statement_date: "2026-10-15", balance: "4900", minimum_due: "500", due_date: "2026-11-05" });
  const result = recordCardPayment(owner, card.id, { request_id: req(), version: confirmed.account.version, statement_date: "2026-10-15", source_account_id: cash.id, amount: "4900", transaction_date: "2026-10-20", cashbacks: [{ expense_id: expense.id, version: 1, amount: "100", transaction_date: "2026-10-15" }] });
  assert.equal(result.account.balance_cents, 0);
  assert.equal(getCreditCycles(owner, card.id).find(c => c.statement_date === "2026-10-15")!.remaining_due_cents, 0);
});
