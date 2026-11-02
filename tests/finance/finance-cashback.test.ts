import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../../src/lib/db";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { createAccount, getAccount, updateAccount } from "../../src/features/finance/accounts";
import { getActivityTotals, getTransaction, listTransactions, postTransaction } from "../../src/features/finance/activity";
import { readClassification, updateClassification } from "../../src/features/finance/classifications";
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

test("percent cashback rounds half-up, posts a linked same-day income, counts gross monthly totals and retries once", () => {
  const cash = account();
  const payload = {
    request_id: "cashback-percent",
    type: "expense" as const,
    account_id: cash.id,
    amount: "10.10",
    transaction_date: "2026-10-03",
    category_id: "default-expense:food",
    cashback: { mode: "percent" as const, value: "5" },
  };
  const posted = postTransaction(owner, payload);
  assert.ok(posted.cashback);
  assert.equal(posted.cashback.amount_cents, 51);
  assert.equal(posted.cashback.type, "income");
  assert.equal(posted.cashback.account_id, cash.id);
  assert.equal(posted.cashback.transaction_date, payload.transaction_date);
  assert.equal(posted.cashback.category_id, cashbackCategoryId);
  assert.equal(posted.cashback.cashback_expense_id, posted.transaction.id);
  assert.equal(posted.cashback.linked_record_id, posted.transaction.id);
  assert.equal(posted.transaction.cashback_transaction_id, posted.cashback.id);
  assert.equal(posted.transaction.cashback_mode, "percent");
  assert.equal(posted.transaction.cashback_value, "5");
  assert.equal(posted.balance_cents, 99041);
  assert.equal(getAccount(owner, cash.id).balance_cents, 99041);
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), {
    currency: "PHP", month: "2026-10", income_cents: 51, expense_cents: 1010,
  });

  assert.deepEqual(postTransaction(owner, payload), posted);
  assert.equal(listTransactions(owner).total, 2);
  assert.equal(getDb().prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM finance_cashbacks").get()?.count, 1);
});

test("fixed cashback stays fixed, rejects corrections below its amount, follows parent changes and reverts as a pair", () => {
  const cash = account("Cash"), bank = account("Bank", "0");
  const posted = expense(cash.id, "20", { mode: "amount", value: "5" });
  assert.ok(posted.cashback);
  assert.equal(posted.cashback.amount_cents, 500);

  const childId = posted.cashback.id;
  assert.throws(() => correctActivity(owner, childId, { request_id: "edit-child", version: 1, amount: "4" }), { status: 409 });
  assert.throws(() => revertActivity(owner, childId, { request_id: "revert-child", version: 1 }), { status: 409 });

  assert.throws(() => correctActivity(owner, posted.transaction.id, {
    request_id: "too-small-fixed-cashback", version: posted.transaction.version, amount: "4",
  }), { code: "invalid_cashback" });
  assert.equal(getTransaction(owner, posted.transaction.id).amount_cents, 2000);
  assert.equal(getTransaction(owner, childId).amount_cents, 500);

  const corrected = correctActivity(owner, posted.transaction.id, {
    request_id: "correct-fixed-cashback", version: posted.transaction.version,
    amount: "10", account_id: bank.id, transaction_date: "2026-10-04",
  });
  const parent = getTransaction(owner, posted.transaction.id);
  const child = getTransaction(owner, childId);
  assert.equal(parent.account_id, bank.id);
  assert.equal(parent.transaction_date, "2026-10-04");
  assert.equal(child.account_id, bank.id);
  assert.equal(child.transaction_date, "2026-10-04");
  assert.equal(child.amount_cents, 500);
  assert.equal(corrected.balances.find(row => row.account_id === cash.id)?.balance_cents, 100000);
  assert.equal(corrected.balances.find(row => row.account_id === bank.id)?.balance_cents, -500);

  const hidden = hideActivity(owner, parent.id, { request_id: "hide-cashback-pair", version: parent.version });
  assert.equal(hidden.transaction.hidden, true);
  assert.equal(getTransaction(owner, childId).hidden, true);
  const reverted = revertActivity(owner, parent.id, { request_id: "revert-cashback-pair", version: hidden.transaction.version });
  assert.equal(reverted.transaction.reverted, true);
  assert.equal(getTransaction(owner, childId).reverted, true);
  assert.equal(getAccount(owner, cash.id).balance_cents, 100000);
  assert.equal(getAccount(owner, bank.id).balance_cents, 0);
});

test("percent cashback recalculates on parent correction and stale corrections cannot split the pair", () => {
  const cash = account();
  const posted = expense(cash.id, "50", { mode: "percent", value: "10" });
  assert.ok(posted.cashback);
  const childId = posted.cashback.id;
  const corrected = correctActivity(owner, posted.transaction.id, {
    request_id: "correct-percent-cashback", version: posted.transaction.version, amount: "40",
  });
  assert.equal(getTransaction(owner, childId).amount_cents, 400);
  assert.throws(() => correctActivity(owner, posted.transaction.id, {
    request_id: "stale-percent-cashback", version: posted.transaction.version, amount: "30",
  }), { code: "version_conflict" });
  assert.equal(getTransaction(owner, posted.transaction.id).amount_cents, 4000);
  assert.equal(getTransaction(owner, childId).amount_cents, 400);
  assert.equal(corrected.transaction.version, 2);
});

test("cashback validation, unavailable category and audit failure leave no partial transactions", () => {
  const cash = account("Cash", "100");
  const invalidCashbacks = [
    { mode: "percent", value: "0" },
    { mode: "percent", value: "100.01" },
    { mode: "percent", value: "0.01" },
    { mode: "percent", value: "1.001" },
    { mode: "amount", value: "0" },
    { mode: "amount", value: "10.01" },
    { mode: "amount", value: "90071992547409.92" },
    { mode: "other", value: "1" },
  ];
  for (const cashback of invalidCashbacks) {
    assert.throws(() => postTransaction(owner, {
      request_id: request(), type: "expense", account_id: cash.id, amount: "10", transaction_date: "2026-10-03", cashback,
    }));
  }
  assert.throws(() => postTransaction(owner, {
    request_id: request(), type: "income", account_id: cash.id, amount: "10", transaction_date: "2026-10-03",
    cashback: { mode: "amount", value: "1" },
  }));
  assert.equal(listTransactions(owner).total, 0);
  assert.equal(getDb().prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM finance_cashbacks").get()?.count, 0);
  assert.equal(getAccount(owner, cash.id).balance_cents, 10000);

  const cashbackCategory = readClassification(cashbackCategoryId);
  updateClassification(owner, cashbackCategory.id, { request_id: "archive-cashback-category", version: cashbackCategory.version, archived: true });
  assert.throws(() => expense(cash.id, "10", { mode: "amount", value: "1" }), { code: "invalid_category" });
  assert.equal(listTransactions(owner).total, 0);

  updateClassification(owner, cashbackCategory.id, { request_id: "restore-cashback-category", version: cashbackCategory.version + 1, archived: false });
  const db = getDb();
  db.exec("CREATE TEMP TRIGGER reject_cashback_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  const payload = { request_id: "cashback-audit-rollback", type: "expense" as const, account_id: cash.id, amount: "10", transaction_date: "2026-10-03", cashback: { mode: "amount" as const, value: "1" } };
  try {
    assert.throws(() => postTransaction(owner, payload), /audit unavailable/);
    assert.equal(listTransactions(owner).total, 0);
    assert.equal(db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM finance_cashbacks").get()?.count, 0);
    assert.equal(db.prepare("SELECT 1 FROM finance_requests WHERE request_id = ?").get(payload.request_id), undefined);
    assert.equal(getAccount(owner, cash.id).balance_cents, 10000);
  } finally { db.exec("DROP TRIGGER reject_cashback_audit"); }
  assert.ok(postTransaction(owner, payload).cashback);
});

test("REST and remote MCP accept cashback and share the paired retry result", async () => {
  const cash = account("Protocol cash", "100");
  const { key } = createApiKey("Cashback writer", ["finance:read", "finance:write"]);
  const payload = {
    request_id: "cashback-transport", type: "expense", account_id: cash.id, amount: "10.10", transaction_date: "2026-10-03",
    cashback: { mode: "percent", value: "5" },
  };
  const response = await postRest(new Request("https://chibako.test/api/finance/activity", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(payload),
  }), { params: Promise.resolve({}) });
  assert.equal(response.status, 201);
  const restResult = await response.json();
  const mcpResponse = await postRemote(new Request("https://chibako.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: request(), method: "tools/call", params: { name: "post_finance_transaction", arguments: payload } }),
  }));
  assert.equal(mcpResponse.status, 200);
  const envelope = await mcpResponse.json();
  assert.deepEqual(envelope.result.structuredContent, restResult);
  assert.equal(listTransactions(owner).total, 2);
});

// Test decision: extend — a chosen cashback destination is new money routing through the shared post/correct/revert capabilities.
test("cashback can go to another active money or credit account, stays linked and reverts with its expense", () => {
  const cash = account("Debit", "1000");
  const card = createAccount(owner, { request_id: request(), name: "Card", kind: "credit", currency: "PHP", opening_balance: "-200", credit_limit: "5000" }).account;
  const posted = postTransaction(owner, {
    request_id: request(), type: "expense", account_id: cash.id, amount: "100", transaction_date: "2026-10-03",
    cashback: { mode: "amount", value: "5", account_id: card.id },
  });
  assert.equal(posted.balance_cents, 90000, "the paying account is not credited");
  assert.equal(posted.cashback?.account_id, card.id);
  assert.equal(posted.cashback?.amount_cents, 500);
  assert.equal(getAccount(owner, card.id).balance_cents, -19500);
  assert.equal(getTransaction(owner, posted.transaction.id).cashback_transaction_id, posted.cashback?.id);

  const corrected = correctActivity(owner, posted.transaction.id, { request_id: request(), version: posted.transaction.version, amount: "200" });
  assert.equal(getTransaction(owner, posted.cashback!.id).account_id, card.id, "a chosen destination survives expense corrections");
  assert.deepEqual([getAccount(owner, cash.id).balance_cents, getAccount(owner, card.id).balance_cents], [80000, -19500]);

  revertActivity(owner, posted.transaction.id, { request_id: request(), version: corrected.transaction.version });
  assert.deepEqual([getAccount(owner, cash.id).balance_cents, getAccount(owner, card.id).balance_cents], [100000, -20000]);
  assert.equal(getTransaction(owner, posted.cashback!.id).reverted, true);
});

test("an invalid cashback destination is rejected with no partial write, and the paying account stays the default", () => {
  const cash = account("Debit", "1000");
  const asset = createAccount(owner, { request_id: request(), name: "House", kind: "asset", currency: "PHP", opening_balance: "0" }).account;
  const archived = account("Old", "0");
  updateAccount(owner, archived.id, { request_id: request(), version: archived.version, archived: true });
  for (const account_id of [asset.id, archived.id, "missing-account"]) {
    const input = { request_id: request(), type: "expense", account_id: cash.id, amount: "100", transaction_date: "2026-10-03", cashback: { mode: "amount", value: "5", account_id } };
    assert.throws(() => postTransaction(owner, input), { status: 400, code: "invalid_account", message: "Choose an active money or credit account for cashback" });
    assert.deepEqual(getDb().prepare("SELECT COUNT(*) AS count FROM finance_requests WHERE request_id = ?").get(input.request_id), { count: 0 });
  }
  assert.equal(listTransactions(owner, { hidden: "all", reverted: "all" }).total, 0);
  const same = postTransaction(owner, { request_id: request(), type: "expense", account_id: cash.id, amount: "100", transaction_date: "2026-10-03", cashback: { mode: "amount", value: "5", account_id: cash.id } });
  assert.deepEqual([same.cashback?.account_id, same.balance_cents], [cash.id, 90500]);
});

test("REST and remote MCP route cashback to a chosen account and reject invalid destinations alike", async () => {
  const cash = account("Protocol debit", "100");
  const card = createAccount(owner, { request_id: request(), name: "Protocol card", kind: "credit", currency: "PHP", opening_balance: "0", credit_limit: "100" }).account;
  const asset = createAccount(owner, { request_id: request(), name: "Protocol house", kind: "asset", currency: "PHP", opening_balance: "0" }).account;
  const { key } = createApiKey("Cashback destination writer", ["finance:read", "finance:write"]);
  const rest = (body: object) => postRest(new Request("https://chibako.test/api/finance/activity", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
  const mcp = async (args: object) => (await (await postRemote(new Request("https://chibako.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: request(), method: "tools/call", params: { name: "post_finance_transaction", arguments: args } }),
  }))).json()).result;
  const payload = (request_id: string, account_id: string) => ({ request_id, type: "expense", account_id: cash.id, amount: "10", transaction_date: "2026-10-03", cashback: { mode: "amount", value: "1", account_id } });

  const restRejected = await rest(payload("rest-bad-destination", asset.id));
  assert.equal(restRejected.status, 400);
  assert.deepEqual(await restRejected.json(), { error: "Choose an active money or credit account for cashback", code: "invalid_account" });
  assert.equal((await mcp(payload("mcp-bad-destination", asset.id))).content[0].text, "error: invalid_account: Choose an active money or credit account for cashback");

  const restPosted = await (await rest(payload("rest-card-destination", card.id))).json();
  const mcpPosted = (await mcp(payload("mcp-card-destination", card.id))).structuredContent;
  assert.deepEqual([restPosted.cashback.account_id, mcpPosted.cashback.account_id], [card.id, card.id]);
  assert.deepEqual([restPosted.balance_cents, mcpPosted.balance_cents], [9000, 8000]);
  assert.equal(getAccount(owner, card.id).balance_cents, 200);
});
