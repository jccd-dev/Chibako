import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../../src/lib/db";
import { createAccount, getAccount, updateAccount } from "../../src/features/finance/accounts";
import { postTransaction } from "../../src/features/finance/activity";
import { applyCashback } from "../../src/features/finance/cashbacks";
import { postTransfer } from "../../src/features/finance/movements";
import { createPlan } from "../../src/features/finance/planning";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { POST as postRest } from "../../src/app/api/finance/activity/route";
import { POST as accountRest } from "../../src/app/api/finance/accounts/route";
import { POST as remote } from "../../src/app/mcp/route";
import type { FinanceActor } from "../../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-payment-account-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
const req = () => randomUUID();
beforeEach(() => getDb().exec(`DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_cashbacks;
DELETE FROM finance_plans; DELETE FROM finance_refunds; DELETE FROM finance_movements; DELETE FROM finance_transactions;
UPDATE finance_accounts SET payment_account_id=NULL; DELETE FROM finance_accounts;`));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const money = (extra: object = {}) => createAccount(owner, { request_id: req(), name: "Payment cash", kind: "money", currency: "PHP", opening_balance: "5000", ...extra }).account;
const card = (payment_account_id: string, extra: object = {}) => createAccount(owner, { request_id: req(), name: "Card", kind: "credit", currency: "PHP", opening_balance: "0", credit_limit: "10000", payment_account_id, ...extra }).account;
const spend = (account_id: string, amount: string, extra: object = {}) => postTransaction(owner, { request_id: req(), account_id, type: "expense", amount, transaction_date: "2026-11-01", ...extra });

test("full owed amount holds money alongside maintaining balance and plans; pending rewards do not reduce hold", () => {
  const cash = money({ maintaining_balance: "100" }), visa = card(cash.id);
  createPlan(owner, { request_id: req(), text: "Bills", type: "expense", account_id: cash.id, amount: "200", due_date: new Date().toISOString().slice(0, 7) + "-15" });
  const posted = spend(visa.id, "5000", { cashback: { mode: "percent", value: "1" } });
  const held = getAccount(owner, cash.id);
  assert.equal(held.balance_cents, 510000);
  assert.equal(held.credit_hold_cents, 500000);
  assert.equal(held.planned_expense_cents, 20000);
  assert.equal(held.spendable_cents, 0);
  assert.ok(posted.warnings.includes("payment_account_shortfall"));
  applyCashback(owner, posted.transaction.id, { request_id: req(), version: 1, transaction_date: "2026-11-02" });
  assert.equal(getAccount(owner, cash.id).credit_hold_cents, 495000);
});

test("two cards add holds; spend warns but saves; payment releases hold without double reducing free cash", () => {
  const cash = money(), visa = card(cash.id), master = card(cash.id);
  assert.deepEqual(spend(visa.id, "3000").warnings, []);
  const posted = spend(master.id, "2500");
  assert.ok(posted.warnings.includes("payment_account_shortfall"));
  assert.equal(getAccount(owner, master.id).balance_cents, -250000);
  assert.equal(getAccount(owner, cash.id).credit_hold_cents, 550000);
  assert.equal(getAccount(owner, cash.id).spendable_cents, 0);
  postTransfer(owner, { request_id: req(), source_account_id: cash.id, destination_account_id: visa.id, amount: "3000", transaction_date: "2026-11-02" });
  assert.equal(getAccount(owner, cash.id).balance_cents, 200000);
  assert.equal(getAccount(owner, cash.id).credit_hold_cents, 250000);
  updateAccount(owner, master.id, { request_id: req(), version: 1, payment_account_id: null });
  assert.equal(getAccount(owner, cash.id).credit_hold_cents, 0);
  assert.equal(getAccount(owner, cash.id).spendable_cents, 200000);
});

test("links require credit to active money, and linked money cannot be archived until unlinked", () => {
  const cash = money(), visa = card(cash.id);
  const asset = money({ kind: "asset", name: "Asset" }), old = money();
  updateAccount(owner, old.id, { request_id: req(), version: 1, archived: true });
  for (const target of [visa.id, asset.id, old.id, "missing"]) {
    assert.throws(() => card(target), { code: "invalid_payment_account" });
    assert.throws(() => updateAccount(owner, visa.id, { request_id: req(), version: 1, payment_account_id: target }), { code: "invalid_payment_account" });
  }
  assert.throws(() => money({ payment_account_id: cash.id }), { code: "invalid_payment_account" });
  assert.throws(() => updateAccount(owner, cash.id, { request_id: req(), version: 1, archived: true }), { code: "payment_account_in_use" });
  spend(visa.id, "100");
  updateAccount(owner, visa.id, { request_id: req(), version: 1, archived: true });
  assert.equal(getAccount(owner, cash.id).credit_hold_cents, 10000, "archiving debt must not release its hold");
});

async function rpc(key: string, name: string, args: object) {
  return (await (await remote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: req(), method: "tools/call", params: { name, arguments: args } }) }))).json()).result;
}
const request = (key: string, body: object) => new Request("https://chibako.test/api/finance", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
test("REST and MCP share link creation and warn-not-block replay", async () => {
  const cash = money({ opening_balance: "1" });
  const { key } = createApiKey("Card writer", ["finance:manage", "finance:write"]);
  const payload = { request_id: req(), name: "Protocol card", kind: "credit", currency: "PHP", opening_balance: "0", credit_limit: "10000", payment_account_id: cash.id };
  const created = await (await accountRest(request(key, payload), { params: Promise.resolve({}) })).json();
  assert.deepEqual((await rpc(key, "create_finance_account", payload)).structuredContent, created);
  const body = { request_id: req(), account_id: created.account.id, amount: "5000", transaction_date: "2026-11-01" };
  const posted = await (await postRest(request(key, body), { params: Promise.resolve({}) })).json();
  assert.deepEqual(posted.warnings, ["payment_account_shortfall"]);
  assert.deepEqual((await rpc(key, "post_finance_transaction", body)).structuredContent, posted);
  assert.equal(getAccount(owner, cash.id).credit_hold_cents, 500000);
});


test("a positive card credit covers spending before its payment account needs cash", () => {
  const cash = money({ opening_balance: "0" }), visa = card(cash.id, { opening_balance: "100" });
  assert.deepEqual(spend(visa.id, "50").warnings, []);
  assert.equal(getAccount(owner, cash.id).credit_hold_cents, 0);
  assert.deepEqual(spend(visa.id, "60").warnings, ["payment_account_shortfall"]);
  assert.equal(getAccount(owner, cash.id).credit_hold_cents, 1000);
});
