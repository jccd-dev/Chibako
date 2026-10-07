import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createAccount, getAccount } from "../src/features/finance/accounts";
import { createObligation, getObligation, postObligationPayment } from "../src/features/finance/obligations";
import { createSchedule, catchUpPlans, pauseSchedule, resumeSchedule, updateSchedule, skipPlans } from "../src/features/finance/recurrence";
import { getPlan, listPlans, postPlan, matchPlan, updatePlan } from "../src/features/finance/planning";
import { getActivityTotals, postTransaction, listTransactions } from "../src/features/finance/activity";
import { correctActivity, hideActivity, revertActivity } from "../src/features/finance/corrections";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-recurring-payments-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
const request = () => randomUUID();
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_obligation_payments; DELETE FROM finance_obligation_writeoffs; DELETE FROM finance_obligation_movements; DELETE FROM finance_plans; DELETE FROM finance_schedules; DELETE FROM finance_refunds; DELETE FROM finance_transactions; DELETE FROM finance_obligations; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
function fixture(kind = "debt") {
  const account = createAccount(owner, { request_id: request(), name: "TEST 12 cash", kind: "money", opening_balance: "100", currency: "PHP" }).account;
  const obligation = createObligation(owner, { request_id: request(), name: "TEST 12 obligation", kind, principal: "30" }).obligation;
  const schedule = createSchedule(owner, { request_id: request(), type: kind === "debt" ? "expense" : "income", account_id: account.id, amount: "10", interval_count: 1, interval_unit: "month", start_date: "2026-10-01", obligation_id: obligation.id }).schedule;
  catchUpPlans(owner, { request_id: request(), through_date: "2026-10-01" });
  const plan = listPlans(owner, { schedule_id: schedule.id }).plans[0];
  return { account, obligation, schedule, plan };
}

test("recurring payment review atomically posts principal and explicit fee, retries once, and corrects/Delete/Reverts both", () => {
  const { account, obligation, plan } = fixture();
  assert.equal(plan.obligation_id, obligation.id);
  assert.equal(getAccount(owner, account.id).balance_cents, 10000);
  const input = { request_id: request(), version: plan.version, obligation_version: obligation.version, account_id: account.id, amount: "10", transaction_date: "2026-10-03", fee: { type: "expense", amount: "2" } };
  const paid = postPlan(owner, plan.id, input);
  assert.equal(paid.obligation?.outstanding_cents, 2000);
  assert.equal(paid.balance_cents, 8800);
  assert.equal(paid.plan.status, "satisfied");
  assert.equal(paid.transaction.transaction_date, "2026-10-03");
  assert.equal(paid.plan.due_date, "2026-10-01");
  assert.equal(paid.fee?.amount_cents, 200);
  assert.deepEqual(postPlan(owner, plan.id, input), paid);
  assert.throws(() => postPlan(owner, plan.id, { ...input, amount: "11" }), { code: "request_conflict" });
  assert.throws(() => postPlan(owner, plan.id, { ...input, request_id: request(), version: paid.plan.version }), { code: "not_pending" });
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).expense_cents, 200);
  const next = listPlans(owner, { schedule_id: paid.plan.schedule_id! }).plans[0];
  updateSchedule(owner, paid.plan.schedule_id!, { request_id: request(), version: 1, from_plan_id: next.id, from_plan_version: next.version, obligation_id: null });
  assert.equal(getPlan(owner, plan.id).obligation_id, obligation.id);
  assert.equal(getPlan(owner, next.id).obligation_id, null);
  const edited = correctActivity(owner, paid.transaction.id, { request_id: request(), version: paid.transaction.version, obligation_version: paid.obligation!.version, amount: "12", transaction_date: "2026-10-04", fee: { version: paid.fee!.version, amount: "3" } });
  assert.equal(edited.obligation?.outstanding_cents, 1800);
  assert.equal(getAccount(owner, account.id).balance_cents, 8500);
  assert.equal(edited.fee?.transaction_date, "2026-10-04");
  const hidden = hideActivity(owner, paid.transaction.id, { request_id: request(), version: edited.transaction.version, obligation_version: edited.obligation!.version });
  assert.equal(getPlan(owner, plan.id).status, "satisfied");
  assert.equal(hidden.obligation?.outstanding_cents, 1800);
  assert.equal(getAccount(owner, account.id).balance_cents, 8500);
  const reverted = revertActivity(owner, paid.transaction.id, { request_id: request(), version: hidden.transaction.version, obligation_version: hidden.obligation!.version });
  assert.equal(reverted.plan?.status, "pending");
  assert.equal(reverted.obligation?.outstanding_cents, 3000);
  assert.equal(getAccount(owner, account.id).balance_cents, 10000);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).expense_cents, 0);
});

test("review failures roll back cash, progress, occurrence, and audit; stale/overpaid review cannot post", () => {
  const { account, obligation, plan } = fixture();
  const input = { request_id: request(), version: plan.version, obligation_version: obligation.version, account_id: account.id, amount: "10", transaction_date: "2026-10-03" };
  assert.throws(() => postPlan(owner, plan.id, { ...input, obligation_version: 2 }), { code: "version_conflict" });
  assert.throws(() => postPlan(owner, plan.id, { ...input, amount: "31" }), { code: "overpayment" });
  assert.throws(() => postPlan(owner, plan.id, { ...input, fee: { type: "expense", amount: "1", category_id: "missing" } }), { code: "not_found" });
  getDb().exec("CREATE TRIGGER fail_payment_audit BEFORE INSERT ON finance_audit WHEN NEW.operation='plan.post' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try { assert.throws(() => postPlan(owner, plan.id, input), /audit unavailable/); }
  finally { getDb().exec("DROP TRIGGER fail_payment_audit"); }
  assert.equal(getAccount(owner, account.id).balance_cents, 10000);
  assert.equal(getObligation(owner, obligation.id).outstanding_cents, 3000);
  assert.deepEqual(getPlan(owner, plan.id), plan);
  assert.equal(listTransactions(owner).total, 0);
  assert.equal(postPlan(owner, plan.id, input).obligation?.paid_cents, 1000);
});

test("existing receivable cash links once, already recorded payments match once, and Revert reopens review", () => {
  const { account, obligation, schedule, plan } = fixture("receivable");
  const cash = postTransaction(owner, { request_id: request(), type: "income", account_id: account.id, amount: "10", transaction_date: "2026-10-03" }).transaction;
  const input = { request_id: request(), version: plan.version, obligation_version: obligation.version, account_id: account.id, amount: "10", transaction_date: cash.transaction_date, cash_activity_id: cash.id, cash_activity_version: cash.version };
  assert.throws(() => postPlan(owner, plan.id, { ...input, fee: { type: "income", amount: "1" } }), { code: "invalid_input" });
  const paid = postPlan(owner, plan.id, input);
  assert.equal(paid.balance_cents, 11000);
  assert.equal(paid.obligation?.paid_cents, 1000);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).income_cents, 0);
  catchUpPlans(owner, { request_id: request(), through_date: "2026-11-01" });
  const next = listPlans(owner, { schedule_id: schedule.id }).plans[0];
  const match = { request_id: request(), version: next.version, transaction_id: cash.id, transaction_version: paid.transaction.version, obligation_version: paid.obligation!.version };
  assert.throws(() => matchPlan(owner, next.id, match), { code: "already_matched" });
  const recorded = postObligationPayment(owner, { request_id: request(), obligation_id: obligation.id, obligation_version: paid.obligation!.version, account_id: account.id, amount: "5", transaction_date: "2026-11-02" });
  const matched = matchPlan(owner, next.id, { ...match, request_id: request(), transaction_id: recorded.transaction.id, transaction_version: recorded.transaction.version, obligation_version: recorded.obligation.version });
  assert.equal(matched.balance_cents, 11500);
  assert.equal(matched.obligation?.paid_cents, 1500);
  const undone = revertActivity(owner, matched.transaction.id, { request_id: request(), version: matched.transaction.version, obligation_version: matched.obligation!.version });
  assert.equal(undone.plan?.status, "pending");
  assert.equal(undone.obligation?.paid_cents, 1000);
  assert.equal(getAccount(owner, account.id).balance_cents, 11000);
});

test("association and recurrence lifecycle never post payment effects or rewrite satisfied history", () => {
  const { account, obligation, schedule, plan } = fixture();
  const edited = updatePlan(owner, plan.id, { request_id: request(), version: plan.version, obligation_id: null }).plan;
  const linked = updatePlan(owner, plan.id, { request_id: request(), version: edited.version, obligation_id: obligation.id }).plan;
  assert.throws(() => updatePlan(owner, plan.id, { request_id: request(), version: linked.version, type: "income" }), { code: "invalid_obligation" });
  const paused = pauseSchedule(owner, schedule.id, { request_id: request(), version: schedule.version }).schedule;
  catchUpPlans(owner, { request_id: request(), through_date: "2027-01-01" });
  const resumed = resumeSchedule(owner, schedule.id, { request_id: request(), version: paused.version, resume_after: "2026-12-01" }).schedule;
  const changed = updateSchedule(owner, schedule.id, { request_id: request(), version: resumed.version, from_plan_id: linked.id, from_plan_version: linked.version, amount: "9" }).schedule;
  assert.equal(changed.obligation_id, obligation.id);
  const current = getPlan(owner, plan.id);
  skipPlans(owner, { request_id: request(), plans: [{ id: current.id, version: current.version }] });
  assert.equal(getPlan(owner, plan.id).status, "cancelled");
  assert.equal(getAccount(owner, account.id).balance_cents, 10000);
  assert.equal(getObligation(owner, obligation.id).paid_cents, 0);
});

test("linked review REST/MCP parity retains independent manage/write/read scopes and atomic retry audit", async () => {
  const { createApiKey } = await import("../src/server/auth/api-key-authorization");
  const { POST: restPost } = await import("../src/app/api/finance/plans/[id]/post/route");
  const { POST: restMatch } = await import("../src/app/api/finance/plans/[id]/match/route");
  const { POST: restSchedule } = await import("../src/app/api/finance/schedules/route");
  const { GET: restRead } = await import("../src/app/api/finance/plans/[id]/route");
  const { POST: remote } = await import("../src/app/mcp/route");
  const { account, obligation, plan } = fixture();
  const context = { params: Promise.resolve({ id: plan.id }) };
  const requestFor = (key: string, body?: object) => new Request("https://chibako.test/api/finance/plans", { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const rpc = async (key: string, name: string, args: object) => {
    const response = await remote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const envelope = await response.json();
    return envelope.result ?? { isError: true, content: [{ text: envelope.error?.message }] };
  };
  const payload = { version: plan.version, obligation_version: obligation.version, account_id: account.id, amount: "10", transaction_date: "2026-10-04", fee: { type: "expense", amount: "2" } };
  const scheduleInput = { account_id: account.id, obligation_id: obligation.id, type: "expense", amount: "10", interval_count: 1, interval_unit: "month", start_date: "2026-11-01" };
  for (const scopes of [[], ["finance:read"], ["finance:manage"]]) {
    const { key } = createApiKey("TEST 12 denied", scopes);
    assert.equal((await restPost(requestFor(key, { request_id: request(), ...payload }), context)).status, 403);
    assert.equal((await rpc(key, "post_finance_plan", { id: plan.id, request_id: request(), ...payload })).isError, true);
    assert.equal((await restMatch(requestFor(key, { request_id: request(), version: 1, obligation_version: 1, transaction_id: "missing", transaction_version: 1 }), context)).status, 403);
    assert.equal((await restRead(requestFor(key), context)).status, scopes.includes("finance:read") ? 200 : 403);
    const scheduleBody = { request_id: request(), ...scheduleInput };
    const scheduleResponse = await restSchedule(requestFor(key, scheduleBody), { params: Promise.resolve({}) });
    assert.equal(scheduleResponse.status, scopes.includes("finance:manage") ? 201 : 403);
    const mcpSchedule = await rpc(key, "create_finance_schedule", scheduleBody);
    if (scopes.includes("finance:manage")) assert.deepEqual(mcpSchedule.structuredContent, await scheduleResponse.json());
    else assert.equal(mcpSchedule.isError, true);
  }
  const { key, id: keyId } = createApiKey("TEST 12 write only", ["finance:write"]);
  assert.equal((await restRead(requestFor(key), context)).status, 403);
  assert.equal((await restSchedule(requestFor(key, { request_id: request(), ...scheduleInput }), { params: Promise.resolve({}) })).status, 403);
  const input = { request_id: request(), ...payload };
  const response = await restPost(requestFor(key, input), context);
  assert.equal(response.status, 200);
  const posted = await response.json();
  assert.deepEqual((await rpc(key, "post_finance_plan", { id: plan.id, ...input })).structuredContent, posted);
  assert.equal(posted.obligation.outstanding_cents, 2000);
  assert.equal(posted.balance_cents, 8800);
  const audit = getDb().prepare("SELECT actor_id,affected_ids FROM finance_audit WHERE request_id=?").get(input.request_id) as { actor_id: string; affected_ids: string };
  assert.equal(audit.actor_id, `api-key:${keyId}`);
  assert.ok(JSON.parse(audit.affected_ids).includes(obligation.id));
  assert.ok(JSON.parse(audit.affected_ids).includes(posted.fee.id));
  assert.equal((await restPost(requestFor(key, { ...input, amount: "11" }), context)).status, 409);
  const next = listPlans(owner, { schedule_id: plan.schedule_id! }).plans[0];
  const manual = postObligationPayment(owner, { request_id: request(), obligation_id: obligation.id, obligation_version: posted.obligation.version, account_id: account.id, amount: "5", transaction_date: "2026-11-02" });
  const matchBody = { request_id: request(), version: next.version, transaction_id: manual.transaction.id, transaction_version: manual.transaction.version, obligation_version: manual.obligation.version };
  const matchResponse = await restMatch(requestFor(key, matchBody), { params: Promise.resolve({ id: next.id }) });
  assert.equal(matchResponse.status, 200);
  const matched = await matchResponse.json();
  assert.deepEqual((await rpc(key, "match_finance_plan", { id: next.id, ...matchBody })).structuredContent, matched);
  assert.equal(matched.balance_cents, 8300);
  assert.equal(matched.obligation.paid_cents, 1500);
});

test("receivable interest is separate income and a linked fee cannot be reused as principal or reverted alone", () => {
  const { account, obligation, plan } = fixture("receivable");
  const paid = postPlan(owner, plan.id, { request_id: request(), version: plan.version, obligation_version: obligation.version, account_id: account.id, amount: "10", transaction_date: "2026-10-03", fee: { type: "income", amount: "1.25" } });
  assert.equal(paid.balance_cents, 11125);
  assert.equal(paid.obligation?.outstanding_cents, 2000);
  assert.equal(getActivityTotals(owner, { month: "2026-10" }).income_cents, 125);
  assert.throws(() => postObligationPayment(owner, { request_id: request(), obligation_id: obligation.id, obligation_version: paid.obligation!.version, cash_activity_id: paid.fee!.id, cash_activity_version: paid.fee!.version, account_id: account.id, amount: "1.25", transaction_date: "2026-10-03" }), { code: "invalid_cash_activity" });
  assert.throws(() => revertActivity(owner, paid.fee!.id, { request_id: request(), version: paid.fee!.version }), { code: "linked_activity" });
  const second = createAccount(owner, { request_id: request(), name: "TEST 12 corrected", kind: "money", currency: "PHP", opening_balance: "0" }).account;
  const edited = correctActivity(owner, paid.transaction.id, { request_id: request(), version: paid.transaction.version, obligation_version: paid.obligation!.version, account_id: second.id });
  assert.equal(getAccount(owner, account.id).balance_cents, 10000);
  assert.equal(getAccount(owner, second.id).balance_cents, 1125);
  assert.equal(edited.fee?.account_id, second.id);
});
