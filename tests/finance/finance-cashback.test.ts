import Database from "better-sqlite3";
import { applyCashback, unapplyCashback } from "../../src/features/finance/cashbacks";
import { createObligation, postObligationPayment } from "../../src/features/finance/obligations";
import { postTransfer } from "../../src/features/finance/movements";
import { POST as applyRest, DELETE as unapplyRest } from "../../src/app/api/finance/activity/[id]/cashback/route";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb, SCHEMA_VERSION } from "../../src/lib/db";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { createAccount, getAccount, listCreditDueAccounts, updateAccount } from "../../src/features/finance/accounts";
import { getActivityTotals, getTransaction, listTransactions, postTransaction } from "../../src/features/finance/activity";
import { updateClassification } from "../../src/features/finance/classifications";
import { correctActivity, hideActivity, revertActivity } from "../../src/features/finance/corrections";
import { POST as postRest } from "../../src/app/api/finance/activity/route";
import { POST as postRemote } from "../../src/app/mcp/route";
import type { FinanceActor } from "../../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-cashback-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
const cashbackCategoryId = "default-income:cashback";

beforeEach(() => {
  const db = getDb();
  db.exec(`
    DELETE FROM finance_audit;
    DELETE FROM finance_requests;
    DELETE FROM finance_cashbacks;
    DELETE FROM finance_refunds;
    DELETE FROM finance_movements;
    DELETE FROM finance_transactions;
    DELETE FROM finance_accounts;
  `);
  db.prepare("UPDATE finance_classifications SET archived = 0, version = 1 WHERE id LIKE 'default-%'").run();
});
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

const request = () => randomUUID();
function account(name = "Cash", opening = "1000") {
  return createAccount(owner, { request_id: request(), name, kind: "money", currency: "PHP", opening_balance: opening }).account;
}
function expense(account_id: string, amount: string, cashback?: { mode: "percent" | "amount"; value: string }) {
  return postTransaction(owner, {
    request_id: request(), type: "expense", account_id, amount, transaction_date: "2026-10-03",
    ...(cashback ? { cashback } : {}),
  });
}

const apply = (id: string, version = 1, extra: object = {}) => applyCashback(owner, id, { request_id: request(), version, transaction_date: "2026-10-15", ...extra });
function card() {
  return createAccount(owner, { request_id: request(), name: "MariBank test", kind: "credit", currency: "PHP", opening_balance: "0", credit_limit: "10000", statement_day: 15, due_mode: "after_statement", due_value: 20 }).account;
}

test("5000 purchase keeps 50 pending; credit on statement day makes statement 4950, with replay and stale protection", () => {
  const visa = card();
  const posted = expense(visa.id, "5000", { mode: "percent", value: "1" });
  assert.equal(posted.balance_cents, -500000);
  assert.equal(posted.cashback, undefined);
  assert.equal(posted.transaction.cashback_amount_cents, 5000);
  assert.equal(listTransactions(owner).total, 1);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).income_cents, 0);
  const payload = { request_id: request(), version: 1, transaction_date: "2026-10-15" };
  const applied = applyCashback(owner, posted.transaction.id, payload);
  assert.equal(applied.cashback?.amount_cents, 5000);
  assert.equal(applied.cashback?.transaction_date, "2026-10-15");
  assert.equal(listCreditDueAccounts(owner, "2026-10-15").find(row => row.id === visa.id)?.statement_balance_cents, 495000);
  assert.deepEqual(applyCashback(owner, posted.transaction.id, payload), applied);
  assert.throws(() => apply( posted.transaction.id), { code: "version_conflict" });
  assert.throws(() => unapplyCashback(owner, posted.transaction.id, { request_id: request(), version: 1 }), { code: "version_conflict" });
  const undoPayload = { request_id: request(), version: applied.transaction.version };
  const pending = unapplyCashback(owner, posted.transaction.id, undoPayload);
  assert.equal(pending.balance_cents, -500000);
  assert.equal(pending.transaction.cashback_transaction_id, null);
  assert.deepEqual(unapplyCashback(owner, posted.transaction.id, undoPayload), pending);
  assert.equal(getTransaction(owner, applied.cashback!.id).reverted, true);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).income_cents, 0);
});

test("partial applications retain pending rewards and undo all dated credits atomically", () => {
  const visa = card(), posted = expense(visa.id, "5000", { mode: "amount", value: "100" });
  const first = apply(posted.transaction.id, 1, { amount: "40" });
  assert.equal(first.transaction.cashback_applied_cents, 4000);
  assert.equal(first.transaction.cashback_pending_cents, 6000);
  getDb().exec("CREATE TEMP TRIGGER reject_partial_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try { assert.throws(() => apply(posted.transaction.id, first.transaction.version, { amount: "20" }), /audit unavailable/); }
  finally { getDb().exec("DROP TRIGGER reject_partial_audit"); }
  assert.equal(getTransaction(owner, posted.transaction.id).cashback_applications?.length, 1);
  assert.equal(getTransaction(owner, posted.transaction.id).version, first.transaction.version);
  const payload = { request_id: request(), version: first.transaction.version, amount: "60", transaction_date: "2026-10-16" };
  const second = applyCashback(owner, posted.transaction.id, payload);
  assert.deepEqual(applyCashback(owner, posted.transaction.id, payload), second);
  assert.equal(second.transaction.cashback_applied_cents, 10000);
  assert.equal(second.transaction.cashback_pending_cents, 0);
  assert.equal(second.transaction.cashback_applications?.length, 2);
  assert.equal(getAccount(owner, visa.id).balance_cents, -490000);
  assert.throws(() => apply(posted.transaction.id, second.transaction.version, { amount: "1" }), { code: "invalid_cashback" });
  const undone = unapplyCashback(owner, posted.transaction.id, { request_id: request(), version: second.transaction.version });
  assert.equal(undone.transaction.cashback_pending_cents, 10000);
  assert.equal(undone.transaction.cashback_applied_cents, 0);
  assert.equal(getAccount(owner, visa.id).balance_cents, -500000);
});

test("partial credits survive purchase corrections; hide and revert cover every application", () => {
  const visa = card(), posted = expense(visa.id, "5000", { mode: "percent", value: "2" });
  const first = apply(posted.transaction.id, 1, { amount: "40" });
  const second = apply(posted.transaction.id, first.transaction.version, { amount: "20", transaction_date: "2026-10-16" });
  const corrected = correctActivity(owner, posted.transaction.id, { request_id: request(), version: second.transaction.version, amount: "4000" });
  assert.equal(corrected.transaction.cashback_amount_cents, 8000);
  assert.equal(corrected.transaction.cashback_applied_cents, 6000);
  assert.equal(corrected.transaction.cashback_pending_cents, 2000);
  assert.equal(getTransaction(owner, first.cashback!.id).amount_cents, 4000);
  assert.throws(() => correctActivity(owner, posted.transaction.id, { request_id: request(), version: corrected.transaction.version, amount: "2000" }), { code: "cashback_in_use" });
  assert.throws(() => correctActivity(owner, posted.transaction.id, { request_id: request(), version: corrected.transaction.version, transaction_date: "2026-10-20" }), { code: "invalid_date" });
  const hidden = hideActivity(owner, posted.transaction.id, { request_id: request(), version: corrected.transaction.version });
  for (const credit of [first.cashback!, second.cashback!]) assert.equal(getTransaction(owner, credit.id).hidden, true);
  revertActivity(owner, posted.transaction.id, { request_id: request(), version: hidden.transaction.version });
  for (const credit of [first.cashback!, second.cashback!]) assert.equal(getTransaction(owner, credit.id).reverted, true);
  assert.equal(getAccount(owner, visa.id).balance_cents, 0);
});

test("credit dates reject future and pre-purchase days, including direct corrections, without changing rewards", () => {
  const visa = card(), posted = expense(visa.id, "5000", { mode: "amount", value: "100" });
  for (const transaction_date of ["9999-12-31", "2026-10-02"]) {
    assert.throws(() => apply(posted.transaction.id, 1, { amount: "40", transaction_date }));
  }
  assert.equal(getTransaction(owner, posted.transaction.id).version, 1);
  const first = apply(posted.transaction.id, 1, { amount: "40" });
  for (const transaction_date of ["9999-12-31", "2026-10-02"]) {
    assert.throws(() => correctActivity(owner, first.cashback!.id, { request_id: request(), version: first.cashback!.version, transaction_date }));
  }
  const changed = correctActivity(owner, first.cashback!.id, { request_id: request(), version: first.cashback!.version, transaction_date: "2026-10-16" });
  assert.equal(changed.transaction.transaction_date, "2026-10-16");
  assert.equal(getTransaction(owner, posted.transaction.id).version, first.transaction.version + 1);
  assert.throws(() => apply(posted.transaction.id, first.transaction.version, { amount: "20" }), { code: "version_conflict" });
});

test("early full payment leaves reward pending; percent corrections recalculate and reversion cancels earning", () => {
  const visa = card(), bank = account("Payment", "5000");
  const posted = expense(visa.id, "5000", { mode: "percent", value: "1" });
  postTransfer(owner, { request_id: request(), source_account_id: bank.id, destination_account_id: visa.id, amount: "5000", transaction_date: "2026-10-10" });
  assert.equal(getAccount(owner, visa.id).balance_cents, 0);
  assert.equal(getTransaction(owner, posted.transaction.id).cashback_amount_cents, 5000);
  const corrected = correctActivity(owner, posted.transaction.id, { request_id: request(), version: 1, amount: "4000" });
  assert.equal(corrected.transaction.cashback_amount_cents, 4000);
  const reverted = revertActivity(owner, posted.transaction.id, { request_id: request(), version: corrected.transaction.version });
  assert.equal(reverted.transaction.reverted, true);
  assert.throws(() => apply(posted.transaction.id, reverted.transaction.version), { code: "invalid_cashback" });
});

test("fixed pending cashback validates corrections and applied corrections, hide and revert retain paired effects", () => {
  const cash = account(), bank = account("Bank", "0");
  const posted = expense(cash.id, "20", { mode: "amount", value: "5" });
  assert.throws(() => correctActivity(owner, posted.transaction.id, { request_id: request(), version: 1, amount: "4" }), { code: "invalid_cashback" });
  const applied = apply(posted.transaction.id, 1, { account_id: bank.id });
  assert.equal(applied.cashback?.account_id, bank.id);
  assert.throws(() => correctActivity(owner, applied.cashback!.id, { request_id: request(), version: 1, amount: "4" }), { code: "linked_activity" });
  const corrected = correctActivity(owner, posted.transaction.id, { request_id: request(), version: applied.transaction.version, amount: "10" });
  assert.equal(corrected.cashback?.amount_cents, 500);
  const hidden = hideActivity(owner, posted.transaction.id, { request_id: request(), version: corrected.transaction.version });
  assert.equal(getTransaction(owner, applied.cashback!.id).hidden, true);
  revertActivity(owner, posted.transaction.id, { request_id: request(), version: hidden.transaction.version });
  assert.equal(getAccount(owner, bank.id).balance_cents, 0);
  assert.equal(getTransaction(owner, applied.cashback!.id).reverted, true);
});

test("rounding and invalid rewards, destinations, unavailable category and audit failures preserve atomicity", () => {
  const cash = account();
  for (const cashback of [{ mode: "percent", value: "100.01" }, { mode: "amount", value: "11" }, { mode: "amount", value: "0" }]) {
    assert.throws(() => postTransaction(owner, { request_id: request(), account_id: cash.id, amount: "10", transaction_date: "2026-10-03", cashback }));
  }
  const posted = expense(cash.id, "10.10", { mode: "percent", value: "5" });
  assert.equal(posted.transaction.cashback_amount_cents, 51);
  const asset = createAccount(owner, { request_id: request(), name: "House", kind: "asset", currency: "PHP", opening_balance: "0" }).account;
  const archived = account("Archived");
  updateAccount(owner, archived.id, { request_id: request(), version: 1, archived: true });
  for (const account_id of [asset.id, archived.id, "missing"]) assert.throws(() => apply(posted.transaction.id, 1, { account_id }), { code: "invalid_account" });
  updateClassification(owner, cashbackCategoryId, { request_id: request(), version: 1, archived: true });
  assert.throws(() => apply(posted.transaction.id), { code: "invalid_category" });
  updateClassification(owner, cashbackCategoryId, { request_id: request(), version: 2, archived: false });
  getDb().exec("CREATE TEMP TRIGGER reject_cashback_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try { assert.throws(() => apply(posted.transaction.id), /audit unavailable/); }
  finally { getDb().exec("DROP TRIGGER reject_cashback_audit"); }
  assert.equal(listTransactions(owner).total, 1);
  assert.equal(getTransaction(owner, posted.transaction.id).version, 1);
  assert.equal(apply(posted.transaction.id).cashback?.amount_cents, 51);
});

async function rpc(key: string, name: string, args: object) {
  return (await (await postRemote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: request(), method: "tools/call", params: { name, arguments: args } }) }))).json()).result;
}
const restRequest = (key: string, method: string, body: object) => new Request("https://chibako.test/api/finance/activity", { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
test("REST and MCP share pending posting, apply/unapply replay and denied write policy", async () => {
  const cash = account();
  const { key } = createApiKey("Writer", ["finance:write"]);
  const payload = { request_id: request(), account_id: cash.id, amount: "10", transaction_date: "2026-10-03", cashback: { mode: "amount", value: "1" } };
  const posted = await (await postRest(restRequest(key, "POST", payload), { params: Promise.resolve({}) })).json();
  assert.deepEqual((await rpc(key, "post_finance_transaction", payload)).structuredContent, posted);
  const id = posted.transaction.id, context = { params: Promise.resolve({ id }) };
  const applyPayload = { request_id: request(), version: 1, transaction_date: "2026-10-15" };
  const applied = await (await applyRest(restRequest(key, "POST", applyPayload), context)).json();
  assert.deepEqual((await rpc(key, "apply_finance_cashback", { id, ...applyPayload })).structuredContent, applied);
  const undo = { request_id: request(), version: applied.transaction.version };
  const pending = await (await unapplyRest(restRequest(key, "DELETE", undo), context)).json();
  assert.deepEqual((await rpc(key, "unapply_finance_cashback", { id, ...undo })).structuredContent, pending);
  const reader = createApiKey("Reader", ["finance:read"]);
  assert.equal((await applyRest(restRequest(reader.key, "POST", { ...applyPayload, request_id: request(), version: pending.transaction.version }), context)).status, 403);
  assert.equal((await rpc(reader.key, "apply_finance_cashback", { id, ...applyPayload })).isError, true);
  assert.equal((await unapplyRest(restRequest(reader.key, "DELETE", undo), context)).status, 403);
  assert.equal((await rpc(reader.key, "unapply_finance_cashback", { id, ...undo })).isError, true);
});

test("schema 6 cashback rows migrate as applied, retaining income, balances and foreign keys across restart", () => {
  const cash = account(), posted = expense(cash.id, "20", { mode: "amount", value: "5" });
  const applied = apply(posted.transaction.id);
  const before = getAccount(owner, cash.id).balance_cents;
  getDb().close();
  const legacy = new Database(join(vault, "brain.db"));
  legacy.exec(`PRAGMA foreign_keys=OFF; BEGIN;
    CREATE TABLE finance_cashbacks_v6 (expense_id TEXT PRIMARY KEY REFERENCES finance_transactions(id) ON DELETE CASCADE,
      income_id TEXT NOT NULL UNIQUE REFERENCES finance_transactions(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('percent','amount')), value TEXT NOT NULL);
    INSERT INTO finance_cashbacks_v6 SELECT expense_id,income_id,mode,value FROM finance_cashbacks;
    DROP TABLE finance_cashback_applications;
    DROP TABLE finance_cashbacks; ALTER TABLE finance_cashbacks_v6 RENAME TO finance_cashbacks;
    ALTER TABLE finance_accounts DROP COLUMN payment_account_id;
    DROP TABLE finance_credit_statements;
    PRAGMA user_version=6; COMMIT;`);
  legacy.close();
  for (let boot = 0; boot < 2; boot++) {
    assert.equal(getDb().pragma("user_version", { simple: true }), SCHEMA_VERSION);
    assert.equal(getTransaction(owner, posted.transaction.id).cashback_transaction_id, applied.cashback!.id);
    assert.equal(getAccount(owner, cash.id).balance_cents, before);
    assert.equal(getAccount(owner, cash.id).payment_account_id, null);
    assert.deepEqual(getDb().prepare("SELECT * FROM finance_credit_statements").all(), []);
    assert.deepEqual(getDb().pragma("foreign_key_check"), []);
    getDb().close();
  }
});


test("older partial cashback credits cannot be matched as receivable payments", () => {
  const cash = account(), posted = expense(cash.id, "100", { mode: "amount", value: "10" });
  const first = apply(posted.transaction.id, 1, { amount: "4" });
  apply(posted.transaction.id, first.transaction.version, { amount: "2" });
  const receivable = createObligation(owner, { request_id: request(), kind: "receivable", name: "Cashback matching guard", principal: "20" }).obligation;
  try {
    assert.throws(() => postObligationPayment(owner, { request_id: request(), obligation_id: receivable.id, obligation_version: receivable.version,
      account_id: cash.id, amount: "4", transaction_date: first.cashback!.transaction_date,
      cash_activity_id: first.cashback!.id, cash_activity_version: first.cashback!.version }), { code: "invalid_cash_activity" });
  } finally {
    getDb().prepare("DELETE FROM finance_obligation_payments WHERE obligation_id=?").run(receivable.id);
    getDb().prepare("DELETE FROM finance_obligations WHERE id=?").run(receivable.id);
  }
});

test("schema 7 applied and pending rewards migrate without creating duplicate income", () => {
  const visa = card();
  const posted = expense(visa.id, "5000", { mode: "amount", value: "100" });
  const pending = expense(visa.id, "100", { mode: "amount", value: "10" });
  const applied = apply(posted.transaction.id);
  const before = getAccount(owner, visa.id).balance_cents;
  getDb().close();
  const legacy = new Database(join(vault, "brain.db"));
  legacy.exec("DROP TABLE finance_cashback_applications; PRAGMA user_version=7;");
  legacy.close();
  assert.equal(getDb().pragma("user_version", { simple: true }), 8);
  assert.equal(getTransaction(owner, posted.transaction.id).cashback_applied_cents, 10000);
  assert.equal(getTransaction(owner, posted.transaction.id).cashback_applications?.[0].id, applied.cashback!.id);
  assert.equal(getTransaction(owner, pending.transaction.id).cashback_pending_cents, 1000);
  assert.equal(getAccount(owner, visa.id).balance_cents, before);
  assert.deepEqual(getDb().pragma("foreign_key_check"), []);
});
