import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../../src/lib/db";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { createAccount, getAccount } from "../../src/features/finance/accounts";
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
