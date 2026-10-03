import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createAccount, getAccount, getFinanceSummary } from "../src/features/finance/accounts";
import { postTransaction, listTransactions, getTransaction, getActivityTotals } from "../src/features/finance/activity";
import { createClassification, updateClassification, listClassifications } from "../src/features/finance/classifications";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-activity-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_transactions; DELETE FROM finance_classifications; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
function account(opening = "100.00", kind = "money") {
  return createAccount(owner, { request_id: randomUUID(), name: "Wallet", kind, currency: "PHP", opening_balance: opening }).account;
}
function entry(accountId: string, amount = "7.25", date = "2026-10-03", type = "expense") {
  return { request_id: randomUUID(), account_id: accountId, amount, transaction_date: date, type };
}

test("posted income and expenses derive exact balances and report by calendar date, not creation time", () => {
  const cash = account();
  const expense = postTransaction(owner, entry(cash.id));
  assert.equal(expense.balance_cents, 9275);
  postTransaction(owner, entry(cash.id, "12.01", "2026-10-04", "income"));
  postTransaction(owner, entry(cash.id, "3.50", "2026-09-30"));
  assert.equal(getAccount(owner, cash.id).balance_cents, 10126);
  assert.equal(getFinanceSummary(owner).money.balance_cents, 10126);
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), { currency: "PHP", month: "2026-10", income_cents: 1201, expense_cents: 725 });
  assert.equal(getActivityTotals(owner, { month: "2026-09" }).expense_cents, 350);
  assert.equal(getTransaction(owner, expense.transaction.id).transaction_date, "2026-10-03");
  assert.equal(listTransactions(owner).total, 3);
});

test("post retries return the original balance after later activity and failures roll back effects and audit", () => {
  const cash = account("1.00");
  const payload = { ...entry(cash.id, "2.01"), text: "Private context" };
  const original = postTransaction(owner, payload);
  assert.equal(original.balance_cents, -101);
  assert.deepEqual(original.warnings, ["negative_balance"]);
  assert.equal(original.transaction.version, 1);
  assert.equal("text" in original.transaction, false);
  postTransaction(owner, entry(cash.id, "5.00", "2026-10-05", "income"));
  assert.deepEqual(postTransaction(owner, payload), original);
  assert.throws(() => postTransaction(owner, { ...payload, amount: "3.00" }), { status: 409, code: "request_conflict" });
  const before = getAccount(owner, cash.id);
  const db = getDb();
  db.exec("CREATE TEMP TRIGGER reject_post_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  const failed = entry(cash.id);
  try { assert.throws(() => postTransaction(owner, failed), /audit unavailable/); }
  finally { db.exec("DROP TRIGGER reject_post_audit"); }
  assert.deepEqual(getAccount(owner, cash.id), before);
  assert.equal(listTransactions(owner).total, 2);
  assert.ok(postTransaction(owner, failed).transaction.id);
  const audits = db.prepare<[], { affected_ids: string; actor_id: string; after_json: string; created_at: number }>("SELECT * FROM finance_audit WHERE operation = 'transaction.post'").all();
  assert.equal(audits.length, 3);
  assert.ok(audits.every(audit => audit.actor_id === "owner" && audit.created_at > 0 && JSON.parse(audit.affected_ids).includes(cash.id)));
  assert.ok(audits.some(audit => JSON.parse(audit.after_json).text === "Private context"));
});

test("separate categories, one-level subcategories and tags retain context and reject mismatched classifications", () => {
  const cash = account();
  const categoryInput = { request_id: "category", kind: "category", type: "expense", name: "Travel" };
  const category = createClassification(owner, categoryInput).classification;
  const sub = createClassification(owner, { ...categoryInput, request_id: "sub", name: "Rail", parent_id: category.id }).classification;
  const income = createClassification(owner, { ...categoryInput, request_id: "income-category", type: "income" }).classification;
  const tag = createClassification(owner, { request_id: "tag", kind: "tag", name: "Weekend" }).classification;
  const payload = { ...entry(cash.id), category_id: category.id, subcategory_id: sub.id, tag_ids: [tag.id], text: "Trip to the station" };
  const posted = postTransaction(owner, payload);
  assert.equal(listTransactions(owner, { q: "station", category_id: category.id }).total, 1);
  assert.equal(listTransactions(owner, { q: "Weekend", category_id: sub.id }).total, 1);
  const compact = getTransaction(owner, posted.transaction.id);
  assert.equal("text" in compact, false);
  assert.equal("tag_ids" in compact, false);
  const detail = getTransaction(owner, posted.transaction.id, { include_details: true });
  assert.equal(detail.text, "Trip to the station");
  assert.deepEqual(detail.tag_ids, [tag.id]);
  for (const patch of [{ category_id: income.id }, { category_id: null }, { tag_ids: [category.id] }, { tag_ids: [tag.id, tag.id] }]) {
    assert.throws(() => postTransaction(owner, { ...payload, request_id: randomUUID(), ...patch }), { status: 400 });
  }
  assert.throws(() => createClassification(owner, { ...categoryInput, request_id: "nested", parent_id: sub.id }), { status: 400 });
  assert.throws(() => createClassification(owner, { request_id: "bad-tag", kind: "tag", name: "Bad", type: "income" }), { status: 400 });
  const rename = { request_id: "rename", version: 1, name: "Transport" };
  const renamed = updateClassification(owner, category.id, rename);
  assert.deepEqual(updateClassification(owner, category.id, rename), renamed);
  assert.deepEqual(createClassification(owner, categoryInput).classification, category);
  assert.throws(() => updateClassification(owner, category.id, { request_id: "stale", version: 1, name: "Old" }), { status: 409, code: "version_conflict" });
  updateClassification(owner, category.id, { request_id: "archive-category", version: 2, archived: true });
  assert.throws(() => postTransaction(owner, { ...payload, request_id: randomUUID() }), { status: 400 });
  assert.equal(getTransaction(owner, posted.transaction.id).category_id, category.id);
  assert.equal(listClassifications(owner, { type: "income" }).total, 1);
  assert.equal(listClassifications(owner, { kind: "tag" }).total, 1);
});

test("history is bounded, filterable and literal search does not expose details by default", () => {
  const cash = account(), other = account();
  postTransaction(owner, { ...entry(cash.id, "1", "2024-02-29"), text: "100% done" });
  postTransaction(owner, { ...entry(cash.id, "2", "2024-03-01", "income"), text: "ordinary" });
  postTransaction(owner, entry(other.id, "3", "2024-03-02"));
  const first = listTransactions(owner, { limit: 2 });
  const second = listTransactions(owner, { limit: 2, offset: 2 });
  assert.equal(first.total, 3);
  assert.equal(first.transactions.length, 2);
  assert.equal(second.transactions.length, 1);
  assert.ok(!first.transactions.some(row => row.id === second.transactions[0].id));
  assert.equal(listTransactions(owner, { date_from: "2024-03-01", date_to: "2024-03-01", account_id: cash.id, type: "income" }).total, 1);
  assert.equal(listTransactions(owner, { q: "%" }).total, 1);
  assert.equal(listTransactions(owner, { q: "' OR 1=1 --" }).total, 0);
  assert.ok(first.transactions.every(row => !("text" in row) && !("tag_ids" in row)));
  assert.equal(listTransactions(owner, { include_details: true, q: "ordinary" }).transactions[0].text, "ordinary");
  for (const query of [{ limit: 101 }, { offset: -1 }, { date_from: "2024-03-02", date_to: "2024-03-01" }, { include_details: "true" }]) {
    assert.throws(() => listTransactions(owner, query), { status: 400 });
  }
});

test("invalid dates, unsafe amounts and unsupported accounts have no posting effects", () => {
  const cash = account();
  for (const transaction_date of ["2025-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-10-03T00:00:00Z", "0000-01-01"]) {
    assert.throws(() => postTransaction(owner, { ...entry(cash.id), transaction_date }), { status: 400 });
  }
  for (const amount of ["0", "-1", "0.001", "1e2", "90071992547409.92"]) assert.throws(() => postTransaction(owner, entry(cash.id, amount)), { status: 400 });
  assert.throws(() => postTransaction(owner, { ...entry(cash.id), currency: "USD" }), { status: 400 });
  assert.throws(() => postTransaction(owner, entry(account("0", "asset").id)), { status: 400, code: "invalid_account" });
  const max = account("90071992547409.91");
  assert.throws(() => postTransaction(owner, entry(max.id, "0.01", "2026-10-03", "income")), { status: 400, code: "amount_out_of_range" });
  assert.equal(listTransactions(owner).total, 0);
  assert.equal(getAccount(owner, cash.id).balance_cents, 10000);
});
