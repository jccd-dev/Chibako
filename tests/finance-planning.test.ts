import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createAccount, getAccount } from "../src/features/finance/accounts";
import { postTransaction, getActivityTotals, listTransactions } from "../src/features/finance/activity";
import { createPlan, getPlan, listPlans, updatePlan, cancelPlan, postPlan, matchPlan } from "../src/features/finance/planning";
import { getFinanceReport, setBudget } from "../src/features/finance/budgets";
import { createClassification } from "../src/features/finance/classifications";
import { postTransfer } from "../src/features/finance/movements";
import { hideActivity, revertActivity } from "../src/features/finance/corrections";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-planning-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_plans; DELETE FROM finance_budget_limits; DELETE FROM finance_budget_plans; DELETE FROM finance_movements; DELETE FROM finance_transactions; DELETE FROM finance_classifications; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const cash = () => createAccount(owner, { request_id: randomUUID(), name: "Plan wallet", kind: "money", currency: "PHP", opening_balance: "100" }).account;
const input = (account_id: string, extra = {}) => ({ request_id: randomUUID(), type: "expense", account_id, amount: "12.25", due_date: "2026-10-03", ...extra });
const action = (version: number) => ({ request_id: randomUUID(), version });

test("one-time plans can be rescheduled and cancelled without cash or actual spending effects", () => {
  const account = cash();
  const payload = input(account.id, { text: "Private expected activity" });
  const original = createPlan(owner, payload);
  assert.equal(original.plan.status, "pending");
  assert.deepEqual(createPlan(owner, payload), original);
  assert.equal("text" in getPlan(owner, original.plan.id), false);
  assert.equal(getPlan(owner, original.plan.id, { include_details: true }).text, "Private expected activity");
  const edited = updatePlan(owner, original.plan.id, { ...action(1), amount: "20", due_date: "2026-11-01" });
  assert.equal(edited.plan.amount_cents, 2000);
  assert.equal(getPlan(owner, original.plan.id, { include_details: true }).text, "Private expected activity");
  assert.equal(listPlans(owner, { date_from: "2026-11-01", date_to: "2026-11-01" }).total, 1);
  assert.throws(() => updatePlan(owner, original.plan.id, { ...action(1), amount: "8" }), { code: "version_conflict" });
  cancelPlan(owner, original.plan.id, action(edited.plan.version));
  assert.equal(listPlans(owner).total, 0);
  assert.equal(getPlan(owner, original.plan.id).status, "cancelled");
  assert.equal(listTransactions(owner).total, 0);
  assert.equal(getAccount(owner, account.id).balance_cents, 10000);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).expense_cents, 0);
});

test("posting confirms actual fields once, Delete retains satisfaction and Revert reopens it", () => {
  const account = cash(), other = cash();
  const plan = createPlan(owner, input(account.id)).plan;
  const payload = { ...action(plan.version), amount: "15.50", account_id: other.id, transaction_date: "2026-11-01" };
  const posted = postPlan(owner, plan.id, payload);
  assert.equal(posted.plan.status, "satisfied");
  assert.equal(posted.transaction.amount_cents, 1550);
  assert.equal(posted.transaction.transaction_date, "2026-11-01");
  assert.equal(getAccount(owner, account.id).balance_cents, 10000);
  assert.equal(getAccount(owner, other.id).balance_cents, 8450);
  assert.deepEqual(postPlan(owner, plan.id, payload), posted);
  assert.throws(() => postPlan(owner, plan.id, { ...payload, request_id: randomUUID(), version: posted.plan.version }), { code: "not_pending" });
  const hidden = hideActivity(owner, posted.transaction.id, action(posted.transaction.version));
  assert.equal(getPlan(owner, plan.id).status, "satisfied");
  assert.equal(getAccount(owner, other.id).balance_cents, 8450);
  const reverted = revertActivity(owner, posted.transaction.id, action(hidden.transaction.version));
  assert.equal(reverted.plan?.status, "pending");
  const reopened = getPlan(owner, plan.id);
  assert.equal(reopened.transaction_id, null);
  assert.equal(reopened.version, posted.plan.version + 1);
  assert.equal(getAccount(owner, other.id).balance_cents, 10000);
  const reposted = postPlan(owner, plan.id, { ...payload, ...action(reopened.version) });
  assert.notEqual(reposted.transaction.id, posted.transaction.id);
  assert.equal(getAccount(owner, other.id).balance_cents, 8450);
  assert.deepEqual(postPlan(owner, plan.id, payload), posted);
});

test("explicit matching consumes no cash, prevents reuse and respects actual version and type", () => {
  const account = cash(), other = cash();
  const plan = createPlan(owner, input(account.id)).plan;
  const another = createPlan(owner, input(account.id)).plan;
  const actual = postTransaction(owner, { request_id: randomUUID(), type: "expense", account_id: other.id, amount: "3.50", transaction_date: "2026-09-01" }).transaction;
  const payload = { ...action(plan.version), transaction_id: actual.id, transaction_version: actual.version };
  const matched = matchPlan(owner, plan.id, payload);
  assert.equal(matched.plan.transaction_id, actual.id);
  assert.equal(matched.balance_cents, 9650);
  assert.equal(listTransactions(owner).total, 1);
  assert.equal(listTransactions(owner, { matchable: true, type: "expense", hidden: "all" }).total, 0);
  assert.deepEqual(matchPlan(owner, plan.id, payload), matched);
  assert.throws(() => matchPlan(owner, another.id, { ...action(another.version), transaction_id: actual.id, transaction_version: matched.transaction.version }), { code: "already_matched" });
  const income = postTransaction(owner, { request_id: randomUUID(), type: "income", account_id: other.id, amount: "2", transaction_date: "2026-10-04" }).transaction;
  assert.throws(() => matchPlan(owner, another.id, { ...action(1), transaction_id: income.id, transaction_version: income.version }), { code: "invalid_match" });
  const reverted = revertActivity(owner, actual.id, action(matched.transaction.version));
  assert.equal(reverted.plan?.status, "pending");
  assert.throws(() => matchPlan(owner, another.id, { ...action(1), transaction_id: actual.id, transaction_version: reverted.transaction.version }), { code: "invalid_match" });
  assert.equal(getAccount(owner, other.id).balance_cents, 10200);
});

test("pending due-date forecasts stay separate from actual budget consumption and respect cancellation/post/reopen", () => {
  const account = cash();
  const category = createClassification(owner, { request_id: randomUUID(), kind: "category", type: "expense", name: "Travel" }).classification;
  setBudget(owner, { request_id: randomUUID(), category_id: category.id, month: "2026-10", version: 0, mode: "forward", amount: "10" });
  const plan = createPlan(owner, input(account.id, { amount: "20", category_id: category.id })).plan;
  createPlan(owner, input(account.id, { type: "income", amount: "30", due_date: "2026-10-31" }));
  createPlan(owner, input(account.id, { amount: "99", due_date: "2026-11-01" }));
  const report = () => getFinanceReport(owner, { date_from: "2026-10-01", date_to: "2026-10-31" });
  assert.deepEqual(report().forecast, { available: true, spending_cents: 2000, income_cents: 3000 });
  assert.equal(report().spending_cents, 0);
  assert.equal(report().categories[0].overspent, false);
  const posted = postPlan(owner, plan.id, { ...action(1), account_id: account.id, amount: "8", transaction_date: "2026-10-05" });
  assert.equal(report().forecast.spending_cents, 0);
  assert.equal(report().categories[0].spending_cents, 800);
  assert.equal(report().categories[0].budget_cents, 1000);
  revertActivity(owner, posted.transaction.id, action(posted.transaction.version));
  assert.equal(report().forecast.spending_cents, 2000);
  assert.equal(report().spending_cents, 0);
  cancelPlan(owner, plan.id, action(getPlan(owner, plan.id).version));
  assert.equal(report().forecast.spending_cents, 0);
});

test("failed posting, matching and linked reversion roll back both planning and money, including audit attribution", () => {
  const account = cash(), ownerKey: FinanceActor = { kind: "api-key", id: "writer", scopes: ["finance:write"] };
  const plan = createPlan(ownerKey, input(account.id)).plan;
  const posting = { ...action(1), account_id: account.id, amount: "12", transaction_date: "2026-10-04" };
  const db = getDb();
  const rejectAudit = () => db.exec("CREATE TEMP TRIGGER reject_planning_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  rejectAudit();
  try { assert.throws(() => postPlan(ownerKey, plan.id, posting), /audit unavailable/); }
  finally { db.exec("DROP TRIGGER reject_planning_audit"); }
  assert.equal(getPlan(owner, plan.id).status, "pending");
  assert.equal(listTransactions(owner).total, 0);
  assert.equal(getAccount(owner, account.id).balance_cents, 10000);
  const actual = postTransaction(owner, { request_id: randomUUID(), account_id: account.id, amount: "5", transaction_date: "2026-10-04" }).transaction;
  const matching = { ...action(1), transaction_id: actual.id, transaction_version: actual.version };
  assert.throws(() => matchPlan(ownerKey, plan.id, { ...matching, transaction_version: 2 }), { code: "version_conflict" });
  rejectAudit();
  try { assert.throws(() => matchPlan(ownerKey, plan.id, matching), /audit unavailable/); }
  finally { db.exec("DROP TRIGGER reject_planning_audit"); }
  assert.equal(getPlan(owner, plan.id).status, "pending");
  const matched = matchPlan(ownerKey, plan.id, matching);
  assert.equal(matched.transaction.version, 2);
  assert.equal(getAccount(owner, account.id).balance_cents, 9500);
  rejectAudit();
  try { assert.throws(() => revertActivity(ownerKey, actual.id, action(2)), /audit unavailable/); }
  finally { db.exec("DROP TRIGGER reject_planning_audit"); }
  assert.equal(getPlan(owner, plan.id).status, "satisfied");
  assert.equal(getAccount(owner, account.id).balance_cents, 9500);
  const audits = db.prepare<[], { actor_id: string; before_json: string; after_json: string }>("SELECT * FROM finance_audit WHERE operation LIKE 'plan.%'").all();
  assert.equal(audits.length, 2);
  assert.ok(audits.every(row => row.actor_id === "api-key:writer"));
  assert.equal(JSON.parse(audits[1].before_json).plan.status, "pending");
  assert.equal(JSON.parse(audits[1].after_json).plan.status, "satisfied");
});

test("plans validate dates, cents, pagination and accounts; transfer fees and generated postings cannot be reused", () => {
  const account = cash(), other = cash();
  for (const patch of [{ amount: "0" }, { amount: "1.001" }, { amount: "90071992547410" }, { due_date: "2026-02-30" }, { unexpected: true }]) assert.throws(() => createPlan(owner, input(account.id, patch)), { status: 400 });
  const asset = createAccount(owner, { request_id: randomUUID(), name: "Asset", kind: "asset", currency: "PHP", opening_balance: "0" }).account;
  assert.throws(() => createPlan(owner, input(asset.id)), { code: "invalid_account" });
  const category = createClassification(owner, { request_id: randomUUID(), kind: "category", type: "expense", name: "Fees" }).classification;
  const transfer = postTransfer(owner, { request_id: randomUUID(), source_account_id: account.id, destination_account_id: other.id, amount: "1", transaction_date: "2026-10-04", fee: { amount: "1", category_id: category.id } });
  const plan = createPlan(owner, input(account.id)).plan;
  assert.throws(() => matchPlan(owner, plan.id, { ...action(1), transaction_id: transfer.fee!.id, transaction_version: 1 }), { code: "invalid_match" });
  const tag = createClassification(owner, { request_id: randomUUID(), kind: "tag", name: "Plan tag" }).classification;
  assert.throws(() => updatePlan(owner, plan.id, { ...action(1), tag_ids: [tag.id, tag.id] }), { code: "invalid_input" });
  const second = createPlan(owner, input(account.id, { due_date: "2026-10-05" })).plan;
  const posted = postPlan(owner, plan.id, { ...action(1), account_id: account.id, amount: "1", transaction_date: "2026-10-04" });
  assert.throws(() => matchPlan(owner, second.id, { ...action(1), transaction_id: posted.transaction.id, transaction_version: 1 }), { code: "already_matched" });
  for (const query of [{ limit: 101 }, { offset: -1 }, { date_from: "2026-11-01", date_to: "2026-10-01" }, { include_details: "yes" }]) assert.throws(() => listPlans(owner, query), { code: "invalid_input" });
  const firstPage = listPlans(owner, { status: "all", limit: 1 }), next = listPlans(owner, { status: "all", limit: 1, offset: 1 });
  assert.equal(firstPage.total, 2);
  assert.notEqual(firstPage.plans[0].id, next.plans[0].id);
  assert.equal(listTransactions(owner, { matchable: true, type: "expense", hidden: "all" }).total, 0);
});
