import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../../src/lib/db";
import { createAccount, getAccount, listCreditDueAccounts } from "../../src/features/finance/accounts";
import { confirmStatement } from "../../src/features/finance/statements";
import { postTransaction } from "../../src/features/finance/activity";
import { postTransfer } from "../../src/features/finance/movements";
import { revertActivity } from "../../src/features/finance/corrections";
import { getFinanceAttention } from "../../src/features/finance/overview";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { POST as confirmRest } from "../../src/app/api/finance/accounts/[id]/statement/route";
import { POST as remote } from "../../src/app/mcp/route";
import type { FinanceActor } from "../../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-statements-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
const req = () => randomUUID();
beforeEach(() => getDb().exec(`DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_credit_statements;
DELETE FROM finance_cashbacks; DELETE FROM finance_refunds; DELETE FROM finance_movements; DELETE FROM finance_transactions;
UPDATE finance_accounts SET payment_account_id=NULL; DELETE FROM finance_accounts;`));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const card = (extra: object = {}) => createAccount(owner, { request_id: req(), name: "Confirmed card", kind: "credit", currency: "PHP", opening_balance: "-5000", credit_limit: "10000", statement_day: 15, due_mode: "after_statement", due_value: 20, ...extra }).account;
const confirmation = (extra: object = {}) => ({ request_id: req(), version: 1, statement_date: "2026-10-15", balance: "5100", minimum_due: "500", due_date: "2026-11-04", ...extra });
const readAt = (id: string, asOf = "2026-11-05") => listCreditDueAccounts(owner, asOf).find(account => account.id === id)!;
const attention = (id: string, as_of: string) => getFinanceAttention(owner, { as_of }).items.find(item => item.reference_id === id);
function pay(id: string, amount: string, transaction_date: string) {
  const cash = createAccount(owner, { request_id: req(), name: "Payment", kind: "money", currency: "PHP", opening_balance: "10000" }).account;
  return postTransfer(owner, { request_id: req(), source_account_id: cash.id, destination_account_id: id, amount, transaction_date });
}

test("legacy future payments do not clear today's overdue minimum", () => {
  const visa = card();
  confirmStatement(owner, visa.id, confirmation());
  const legacy = pay(visa.id, "500", "2026-10-20");
  getDb().prepare("UPDATE finance_movements SET transaction_date='2026-11-10' WHERE id=?").run(legacy.transaction.id);
  assert.equal(readAt(visa.id, "2026-11-05").remaining_minimum_cents, 50000);
  assert.equal(attention(visa.id, "2026-11-05")?.urgency, "overdue");
  assert.equal(readAt(visa.id, "2026-11-10").remaining_minimum_cents, 0);
  assert.equal(attention(visa.id, "2026-11-10")?.urgency, "warning");
});

test("bank figures replace estimate without changing debt, with independent delta and minimum", () => {
  const visa = card(), payload = confirmation();
  const first = confirmStatement(owner, visa.id, payload);
  assert.deepEqual(confirmStatement(owner, visa.id, payload), first);
  const account = readAt(visa.id);
  assert.equal(account.statement_confirmed, true);
  assert.equal(account.statement_version, 1);
  assert.equal(account.estimated_statement_balance_cents, 500000);
  assert.equal(account.statement_balance_cents, 510000);
  assert.equal(account.statement_difference_cents, 10000);
  assert.equal(account.minimum_due_cents, 50000);
  assert.equal(account.remaining_minimum_cents, 50000);
  assert.equal(account.next_due_date, "2026-11-04");
  assert.equal(account.balance_cents, -500000, "confirmation never invents missing bank charges");
  assert.equal(attention(visa.id, "2026-11-05")?.urgency, "overdue");
  assert.throws(() => confirmStatement(owner, visa.id, confirmation()), { code: "version_conflict" });
  confirmStatement(owner, visa.id, confirmation({ version: first.account.version, balance: "5050" }));
  assert.equal(readAt(visa.id).statement_version, 2);
  assert.equal(readAt(visa.id).statement_difference_cents, 5000);
});

test("only credits after close reduce confirmed balance and minimum; paid minimum never becomes overdue", () => {
  const visa = card();
  confirmStatement(owner, visa.id, confirmation());
  pay(visa.id, "100", "2026-10-15");
  assert.equal(readAt(visa.id).remaining_minimum_cents, 50000, "statement-day credit is already in bank balance");
  const payment = pay(visa.id, "400", "2026-10-16");
  assert.equal(readAt(visa.id).remaining_due_cents, 470000);
  assert.equal(readAt(visa.id).remaining_minimum_cents, 10000);
  assert.equal(attention(visa.id, "2026-11-04")?.urgency, "due");
  assert.equal(attention(visa.id, "2026-11-05")?.urgency, "overdue");
  postTransaction(owner, { request_id: req(), account_id: visa.id, type: "expense", amount: "1", transaction_date: "2026-10-20" });
  pay(visa.id, "100", "2026-10-20");
  assert.equal(readAt(visa.id).remaining_minimum_cents, 0);
  assert.equal(readAt(visa.id).remaining_due_cents, 460000);
  assert.equal(attention(visa.id, "2026-11-05")?.urgency, "warning");
  revertActivity(owner, payment.transaction.id, { request_id: req(), version: payment.transaction.version });
  assert.equal(attention(visa.id, "2026-11-05")?.urgency, "overdue");
  pay(visa.id, "10000", "2026-11-01");
  assert.equal(attention(visa.id, "2026-11-05"), undefined);
});

test("confirmation works without settings and older unpaid confirmed cycles stay visible", () => {
  const visa = card();
  assert.equal(readAt(visa.id).statement_confirmed, false);
  confirmStatement(owner, visa.id, confirmation({ minimum_due: "0" }));
  assert.equal(attention(visa.id, "2026-11-05")?.urgency, "warning");
  assert.equal(readAt(visa.id, "2026-11-15").statement_confirmed, true);
  const manual = card({ statement_day: undefined, due_mode: undefined, due_value: undefined });
  confirmStatement(owner, manual.id, confirmation());
  assert.equal(readAt(manual.id).statement_balance_cents, 510000);
});

test("malformed, stale and denied confirmation and audit failure leave no partial write", () => {
  const visa = card();
  for (const extra of [{ balance: "-1" }, { minimum_due: "6000" }, { due_date: "2026-10-14" }, { statement_date: "2026-02-30" }]) {
    assert.throws(() => confirmStatement(owner, visa.id, confirmation(extra)));
  }
  assert.throws(() => confirmStatement({ kind: "api-key", id: "reader", scopes: ["finance:read"] }, visa.id, confirmation()), { status: 403 });
  getDb().exec("CREATE TEMP TRIGGER reject_statement_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try { assert.throws(() => confirmStatement(owner, visa.id, confirmation()), /audit unavailable/); }
  finally { getDb().exec("DROP TRIGGER reject_statement_audit"); }
  assert.equal(getAccount(owner, visa.id).version, 1);
  assert.deepEqual(getDb().prepare("SELECT * FROM finance_credit_statements").all(), []);
});

async function rpc(key: string, args: object) {
  return (await (await remote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: req(), method: "tools/call", params: { name: "confirm_finance_statement", arguments: args } }) }))).json()).result;
}
const request = (key: string, body: object) => new Request("https://chibako.test/api/finance", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
test("REST and MCP share confirmation replay and finance:write policy", async () => {
  const visa = card(), payload = confirmation(), context = { params: Promise.resolve({ id: visa.id }) };
  const { key } = createApiKey("Statement writer", ["finance:write"]);
  const rest = await confirmRest(request(key, payload), context);
  assert.equal(rest.status, 200);
  assert.deepEqual((await rpc(key, { id: visa.id, ...payload })).structuredContent, await rest.json());
  const reader = createApiKey("Reader", ["finance:read"]);
  assert.equal((await confirmRest(request(reader.key, payload), context)).status, 403);
  assert.equal((await rpc(reader.key, { id: visa.id, ...payload })).isError, true);
});
