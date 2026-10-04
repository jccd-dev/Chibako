import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createAccount, getAccount } from "../src/features/finance/accounts";
import { createSchedule, getSchedule, listSchedules, updateSchedule, pauseSchedule, resumeSchedule, catchUpPlans, skipPlans } from "../src/features/finance/recurrence";
import { listPlans, getPlan, updatePlan, postPlan, matchPlan } from "../src/features/finance/planning";
import { postTransaction } from "../src/features/finance/activity";
import { hideActivity, revertActivity } from "../src/features/finance/corrections";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-recurrence-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_plans; DELETE FROM finance_schedules; DELETE FROM finance_transactions; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const action = (version = 1) => ({ request_id: randomUUID(), version });
const account = () => createAccount(owner, { request_id: randomUUID(), name: "Recurrence cash", kind: "money", currency: "PHP", opening_balance: "1000" }).account;
function schedule(account_id: string, extra: object = {}) { return createSchedule(owner, { request_id: randomUUID(), account_id, amount: "12", interval_count: 1, interval_unit: "month", start_date: "2026-01-31", end_date: "2026-04-30", ...extra }).schedule; }
const catchup = (through_date = "2026-04-30") => catchUpPlans(owner, { request_id: randomUUID(), through_date });

test("calendar intervals clamp from the original anchor, include boundaries, catch up every missed date and never post", () => {
  const cash = account();
  const monthly = schedule(cash.id);
  assert.equal(listPlans(owner).total, 0, "reads do not create pending activity");
  const request = { request_id: randomUUID(), through_date: "2026-04-30" };
  const result = catchUpPlans(owner, request);
  assert.deepEqual(catchUpPlans(owner, request), result);
  assert.equal(result.has_more, false);
  assert.deepEqual(listPlans(owner, { schedule_id: monthly.id }).plans.map(p => p.due_date), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.equal(getAccount(owner, cash.id).balance_cents, 100000);
  for (const [interval_unit, interval_count, start_date, end_date, dates] of [
    ["day", 2, "2026-01-01", "2026-01-05", ["2026-01-01", "2026-01-03", "2026-01-05"]],
    ["week", 2, "2026-01-01", "2026-01-29", ["2026-01-01", "2026-01-15", "2026-01-29"]],
    ["month", 2, "2026-01-31", "2026-05-31", ["2026-01-31", "2026-03-31", "2026-05-31"]],
    ["year", 1, "2024-02-29", "2028-02-29", ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]],
  ] as const) {
    const row = schedule(cash.id, { interval_unit, interval_count, start_date, end_date });
    catchup(end_date);
    assert.deepEqual(listPlans(owner, { schedule_id: row.id }).plans.map(p => p.due_date), dates);
  }
  assert.throws(() => catchUpPlans(owner, { ...request, through_date: "2026-05-01" }), { code: "request_conflict" });
});

test("catch-up is bounded and resumable with paginated missed review and one next upcoming occurrence", () => {
  const cash = account(), row = schedule(cash.id, { interval_unit: "day", start_date: "2020-01-01", end_date: null });
  let created = 0, passes = 0, more = true;
  while (more) { const result = catchup("2023-01-01"); assert.ok(result.created_count <= 1000); created += result.created_count; more = result.has_more; assert.ok(++passes < 5); }
  assert.equal(created, 1098);
  const page = listPlans(owner, { schedule_id: row.id, limit: 100 });
  assert.equal(page.total, 1098); assert.equal(page.plans[0].due_date, "2020-01-01");
  assert.equal(listPlans(owner, { schedule_id: row.id, offset: 1097 }).plans[0].due_date, "2023-01-02");
  assert.equal(catchup("2023-01-01").created_count, 0);
  assert.equal(getAccount(owner, cash.id).balance_cents, 100000);
});

test("pause retains pending review; resume skips paused dates and defaults to the next future anchored occurrence", () => {
  const cash = account(), today = new Date().toISOString().slice(0, 10), year = Number(today.slice(0, 4));
  const row = schedule(cash.id, { start_date: `${year - 1}-01-31`, end_date: null });
  catchup(today);
  const before = listPlans(owner, { schedule_id: row.id }).total;
  const paused = pauseSchedule(owner, row.id, action()).schedule;
  catchup(`${year + 2}-12-31`);
  assert.equal(listPlans(owner, { schedule_id: row.id }).total, before);
  const resumed = resumeSchedule(owner, row.id, action(paused.version)).schedule;
  assert.equal(resumed.paused, false); assert.ok(resumed.next_due_date! > today);
  catchup(today);
  assert.equal(listPlans(owner, { schedule_id: row.id }).total, before, "existing upcoming occurrence is not duplicated");
  const localDaily = schedule(cash.id, { interval_unit: "day", start_date: "2026-10-03", end_date: null, paused: true });
  const resumedDaily = resumeSchedule(owner, localDaily.id, { ...action(), resume_after: "2026-10-04" }).schedule;
  assert.equal(resumedDaily.next_due_date, "2026-10-05");
  pauseSchedule(owner, row.id, action(resumed.version));
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-10-04" });
  assert.equal(listPlans(owner, { schedule_id: localDaily.id }).plans[0].due_date, "2026-10-05", "owner-local catch-up creates the next occurrence after resume");
});

test("one and future edits preserve posted history, bulk skip is atomic, occurrence posts once and corrections retain linkage", () => {
  const cash = account(), row = schedule(cash.id); catchup();
  const plans = listPlans(owner, { schedule_id: row.id }).plans;
  const posted = postPlan(owner, plans[0].id, { ...action(), account_id: cash.id, amount: "10", transaction_date: "2026-02-01" });
  assert.throws(() => postPlan(owner, plans[0].id, { ...action(), account_id: cash.id, amount: "10", transaction_date: "2026-02-01" }), { code: "version_conflict" });
  updatePlan(owner, plans[1].id, { ...action(), amount: "15", due_date: "2026-03-01" });
  updateSchedule(owner, row.id, { ...action(), from_plan_id: plans[2].id, from_plan_version: 1, amount: "20" });
  assert.equal(getPlan(owner, plans[0].id).transaction_id, posted.transaction.id);
  assert.equal(getPlan(owner, plans[1].id).amount_cents, 1500);
  assert.equal(getPlan(owner, plans[2].id).amount_cents, 2000);
  assert.equal(getPlan(owner, plans[3].id).amount_cents, 2000);
  assert.throws(() => updateSchedule(owner, row.id, { ...action(), from_plan_id: plans[2].id, from_plan_version: 1, amount: "30" }), { code: "version_conflict" });
  const pending = listPlans(owner).plans;
  assert.throws(() => skipPlans(owner, { request_id: randomUUID(), plans: pending.map((p, i) => ({ id: p.id, version: i ? p.version : 99 })) }), { code: "version_conflict" });
  assert.ok(listPlans(owner).plans.every(p => p.status === "pending"));
  const skip = { request_id: randomUUID(), plans: pending.map(p => ({ id: p.id, version: p.version })) };
  assert.equal(skipPlans(owner, skip).plans.length, 3); assert.equal(skipPlans(owner, skip).plans.length, 3);
  assert.equal(getAccount(owner, cash.id).balance_cents, 99000);
  hideActivity(owner, posted.transaction.id, action(posted.transaction.version));
  assert.equal(getPlan(owner, plans[0].id).status, "satisfied");
  revertActivity(owner, posted.transaction.id, action(posted.transaction.version + 1));
  assert.equal(getPlan(owner, plans[0].id).status, "pending");
  assert.equal(getPlan(owner, plans[0].id).schedule_id, row.id);
  const actual = postTransaction(owner, { request_id: randomUUID(), account_id: cash.id, amount: "9", transaction_date: "2026-01-31" }).transaction;
  matchPlan(owner, plans[0].id, { ...action(getPlan(owner, plans[0].id).version), transaction_id: actual.id, transaction_version: actual.version });
  assert.equal(getAccount(owner, cash.id).balance_cents, 99100);
});

test("cadence changes replace only selected and future pending review, preserving earlier edits and posted history", () => {
  const cash = account(), row = schedule(cash.id); catchup();
  const plans = listPlans(owner, { schedule_id: row.id }).plans;
  const actual = postPlan(owner, plans[3].id, { ...action(), account_id: cash.id, amount: "9", transaction_date: "2026-04-30" });
  const anchor = updatePlan(owner, plans[1].id, { ...action(), amount: "18" }).plan;
  assert.throws(() => updateSchedule(owner, row.id, { ...action(), from_plan_id: anchor.id, from_plan_version: 1, interval_count: 2 }), { code: "version_conflict" });
  const changed = updateSchedule(owner, row.id, { ...action(), from_plan_id: anchor.id, from_plan_version: anchor.version, interval_unit: "day", interval_count: 31, start_date: row.start_date }).schedule;
  assert.equal(changed.start_date, "2026-02-28");
  assert.equal(getPlan(owner, plans[0].id).amount_cents, 1200);
  assert.equal(getPlan(owner, plans[2].id).status, "cancelled");
  assert.equal(getPlan(owner, plans[3].id).transaction_id, actual.transaction.id);
  catchup("2026-04-30");
  assert.deepEqual(listPlans(owner, { schedule_id: row.id }).plans.map(plan => plan.occurrence_date), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.equal(getAccount(owner, cash.id).balance_cents, 99100);
});

test("future cadence edit cannot move a pending occurrence onto a date already satisfied by posted activity", () => {
  const cash = account(), row = schedule(cash.id); catchup();
  const plans = listPlans(owner, { schedule_id: row.id }).plans;
  const march = postPlan(owner, plans[2].id, { ...action(), account_id: cash.id, amount: "12", transaction_date: "2026-03-31" });
  assert.throws(() => updateSchedule(owner, row.id, {
    ...action(), from_plan_id: plans[1].id, from_plan_version: plans[1].version,
    interval_count: 2, start_date: "2026-03-31",
  }), { code: "occurrence_conflict" });
  assert.equal(getPlan(owner, plans[2].id).transaction_id, march.transaction.id);
  assert.equal(getPlan(owner, plans[1].id).status, "pending");
  assert.equal(getSchedule(owner, row.id).version, 1);
  assert.equal(getAccount(owner, cash.id).balance_cents, 98800);
});

test("catch-up reuses a reverted occurrence after a cadence generation changes", () => {
  const cash = account(), row = schedule(cash.id); catchup();
  const plans = listPlans(owner, { schedule_id: row.id }).plans;
  const april = plans.find(plan => plan.occurrence_date === "2026-04-30")!;
  const posted = postPlan(owner, april.id, { ...action(), account_id: cash.id, amount: "12", transaction_date: "2026-04-30" });
  updateSchedule(owner, row.id, {
    ...action(), from_plan_id: plans[0].id, from_plan_version: plans[0].version,
    interval_count: 3,
  });
  revertActivity(owner, posted.transaction.id, action(posted.transaction.version));

  catchup("2026-04-30");
  const aprilPending = listPlans(owner, { schedule_id: row.id }).plans.filter(plan =>
    plan.occurrence_date === "2026-04-30" && plan.status === "pending");
  assert.equal(aprilPending.length, 1, "the reopened historical occurrence owns its schedule date");
  assert.equal(aprilPending[0].id, april.id);
  postPlan(owner, aprilPending[0].id, { ...action(aprilPending[0].version), account_id: cash.id, amount: "12", transaction_date: "2026-04-30" });
  assert.equal(getAccount(owner, cash.id).balance_cents, 98800, "the same occurrence cannot post twice");
});

test("extending a shortened schedule reopens boundary-cancelled dates but preserves explicit skips", () => {
  const cash = account(), row = schedule(cash.id, { end_date: "2026-05-31" }); catchup();
  const plans = listPlans(owner, { schedule_id: row.id }).plans;
  const march = plans.find(plan => plan.occurrence_date === "2026-03-31")!;
  const april = plans.find(plan => plan.occurrence_date === "2026-04-30")!;
  const may = plans.find(plan => plan.occurrence_date === "2026-05-31")!;
  skipPlans(owner, { request_id: randomUUID(), plans: [march, april].map(plan => ({ id: plan.id, version: plan.version })) });
  // Simulate a cancelled occurrence from a vault predating cancel_reason.
  getDb().prepare("UPDATE finance_plans SET cancel_reason=NULL WHERE id=?").run(april.id);

  const shortened = updateSchedule(owner, row.id, {
    ...action(), from_plan_id: plans[0].id, from_plan_version: plans[0].version,
    end_date: "2026-02-28",
  }).schedule;
  const anchor = getPlan(owner, plans[0].id);
  updateSchedule(owner, row.id, {
    ...action(shortened.version), from_plan_id: anchor.id, from_plan_version: anchor.version,
    end_date: "2026-05-31",
  });

  catchup("2026-05-31");
  assert.equal(getPlan(owner, march.id).status, "cancelled", "an explicit skip stays skipped after extension");
  assert.equal(getPlan(owner, april.id).status, "cancelled", "an older reasonless cancellation is preserved as a skip");
  assert.equal(getPlan(owner, may.id).status, "pending", "an end-boundary cancellation is reopened in place");
  assert.equal(listPlans(owner, { schedule_id: row.id }).plans.filter(plan =>
    plan.occurrence_date === "2026-05-31" && plan.status === "pending").length, 1);
});

test("import-style paused schedules generate nothing until explicit future resume; invalid inputs and audit failure leave no partial changes", () => {
  const cash = account(), row = schedule(cash.id, { paused: true, end_date: null });
  catchup(); assert.equal(listPlans(owner).total, 0);
  const resumed = resumeSchedule(owner, row.id, action()).schedule;
  const current = new Date().toISOString().slice(0, 10);
  assert.ok(resumed.next_due_date! > current);
  catchup(current);
  assert.equal(listPlans(owner).total, 1);
  assert.ok(listPlans(owner).plans[0].due_date > current);
  for (const extra of [{ interval_count: 0 }, { interval_count: 1.2 }, { interval_count: 10001 }, { interval_unit: "hour" }, { start_date: "2026-02-30" }, { start_date: "2026-05-01", end_date: "2026-04-30" }, { amount: "0" }])
    assert.throws(() => schedule(cash.id, extra), { status: 400 });
  assert.throws(() => skipPlans(owner, { request_id: randomUUID(), plans: [{ id: "missing", version: 1 }, { id: "missing", version: 1 }] }), { code: "invalid_input" });
  const fresh = schedule(cash.id, { start_date: "2026-01-01" }), db = getDb();
  const generation = { request_id: randomUUID(), through_date: "2026-04-30" };
  db.exec("CREATE TEMP TRIGGER reject_recurrence_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try { assert.throws(() => catchUpPlans(owner, generation), /audit unavailable/); }
  finally { db.exec("DROP TRIGGER reject_recurrence_audit"); }
  assert.equal(listPlans(owner, { schedule_id: fresh.id }).total, 0);
  assert.equal(catchUpPlans(owner, generation).created_count, 4);
  const pending = listPlans(owner, { schedule_id: fresh.id }).plans;
  const patch = { ...action(), from_plan_id: pending[1].id, from_plan_version: pending[1].version, amount: "33" };
  db.exec("CREATE TEMP TRIGGER reject_recurrence_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try { assert.throws(() => updateSchedule(owner, fresh.id, patch), /audit unavailable/); }
  finally { db.exec("DROP TRIGGER reject_recurrence_audit"); }
  assert.equal(getSchedule(owner, fresh.id).version, 1);
  assert.ok(listPlans(owner, { schedule_id: fresh.id }).plans.every(plan => plan.amount_cents === 1200 && plan.version === 1));
  assert.equal(updateSchedule(owner, fresh.id, patch).schedule.version, 2);
  assert.equal(listSchedules(owner, { paused: "true" }).total, 0);
});
