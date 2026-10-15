import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createAccount, getAccount } from "../src/features/finance/accounts";
import { createObligation } from "../src/features/finance/obligations";
import { listPlans, postPlan, updatePlan } from "../src/features/finance/planning";
import { catchUpPlans, createSchedule, pauseSchedule, processAutomaticSchedules, resumeSchedule, skipPlans, updateSchedule } from "../src/features/finance/recurrence";
import { getDb } from "../src/lib/db";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-occurrence-policy-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_plans; DELETE FROM finance_schedules; DELETE FROM finance_obligations; DELETE FROM finance_transactions; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const request = () => ({ request_id: randomUUID() });
function fixture(handling: "manual" | "automatic") {
  const account = createAccount(owner, { ...request(), name: "Occurrence policy", kind: "money", currency: "PHP", opening_balance: "100" }).account;
  const schedule = createSchedule(owner, { ...request(), account_id: account.id, amount: "10", handling,
    interval_unit: "day", interval_count: 1, start_date: "2026-01-01", max_occurrences: 4 }).schedule;
  catchUpPlans(owner, { ...request(), through_date: "2026-01-03" });
  return { account, schedule, plans: listPlans(owner, { schedule_id: schedule.id }).plans };
}

test("enabling automatic handling from an occurrence preserves earlier manual plans", () => {
  const { account, schedule, plans } = fixture("manual");
  updateSchedule(owner, schedule.id, { ...request(), version: schedule.version, from_plan_id: plans[2].id,
    from_plan_version: plans[2].version, handling: "automatic" });
  const result = processAutomaticSchedules(new Date("2026-01-03T12:00:00Z"));
  assert.equal(result.posted_count, 1);
  assert.equal(getAccount(owner, account.id).balance_cents, 9000);
  const updated = listPlans(owner, { schedule_id: schedule.id, status: "all" }).plans;
  assert.deepEqual(updated.map(plan => [plan.due_date, plan.handling, plan.status]), [
    ["2026-01-01", "manual", "pending"], ["2026-01-02", "manual", "pending"],
    ["2026-01-03", "automatic", "satisfied"], ["2026-01-04", "automatic", "pending"],
  ]);
});

test("disabling automatic handling affects selected and future plans while global pause stops earlier automatic plans", () => {
  const { account, schedule, plans } = fixture("automatic");
  const edited = updateSchedule(owner, schedule.id, { ...request(), version: schedule.version, from_plan_id: plans[2].id,
    from_plan_version: plans[2].version, handling: "manual" }).schedule;
  const paused = pauseSchedule(owner, schedule.id, { ...request(), version: edited.version }).schedule;
  assert.equal(processAutomaticSchedules(new Date("2026-01-03T12:00:00Z")).posted_count, 0);
  assert.throws(() => resumeSchedule({ kind: "api-key", id: "manage-only", scopes: ["finance:manage"] }, schedule.id,
    { ...request(), version: paused.version, resume_after: "2026-01-03" }), { status: 403 });
  resumeSchedule(owner, schedule.id, { ...request(), version: paused.version, resume_after: "2026-01-03" });
  assert.equal(processAutomaticSchedules(new Date("2026-01-03T12:00:00Z")).posted_count, 2);
  assert.equal(getAccount(owner, account.id).balance_cents, 8000);
  assert.deepEqual(listPlans(owner, { schedule_id: schedule.id }).plans.map(plan => plan.handling), ["manual", "manual"]);
  assert.equal(processAutomaticSchedules(new Date("2026-01-04T12:00:00Z")).posted_count, 0);
});

test("cadence edits retain later satisfied and skipped slots in the lifetime occurrence cap", () => {
  const { account, schedule, plans } = fixture("manual");
  for (const plan of plans.slice(1, 3)) postPlan(owner, plan.id, { ...request(), version: plan.version,
    account_id: account.id, amount: "10", transaction_date: plan.due_date });
  let edited = updateSchedule(owner, schedule.id, { ...request(), version: schedule.version, from_plan_id: plans[0].id,
    from_plan_version: plans[0].version, interval_unit: "week" }).schedule;
  catchUpPlans(owner, { ...request(), through_date: "2026-01-31" });
  let pending = listPlans(owner, { schedule_id: schedule.id }).plans;
  assert.deepEqual(pending.map(plan => plan.due_date), ["2026-01-01", "2026-01-08"]);
  assert.equal(listPlans(owner, { schedule_id: schedule.id, status: "satisfied" }).total, 2);
  skipPlans(owner, { ...request(), plans: [{ id: pending[1].id, version: pending[1].version }] });
  edited = updateSchedule(owner, schedule.id, { ...request(), version: edited.version, from_plan_id: pending[0].id,
    from_plan_version: pending[0].version, interval_unit: "month" }).schedule;
  catchUpPlans(owner, { ...request(), through_date: "2026-12-31" });
  pending = listPlans(owner, { schedule_id: schedule.id }).plans;
  assert.deepEqual(pending.map(plan => plan.due_date), ["2026-01-01"]);
  assert.equal(edited.next_due_date, null);
  assert.equal(getAccount(owner, account.id).balance_cents, 8000);
});

test("associating an automatic occurrence with an obligation switches only that occurrence to manual", () => {
  const { schedule, plans } = fixture("automatic");
  const obligation = createObligation(owner, { ...request(), kind: "debt", name: "Manual principal", principal: "10" }).obligation;
  const edited = updatePlan(owner, plans[0].id, { ...request(), version: plans[0].version, obligation_id: obligation.id }).plan;
  assert.equal(edited.handling, "manual");
  assert.equal(processAutomaticSchedules(new Date("2026-01-01T12:00:00Z")).posted_count, 0);
  assert.equal(listPlans(owner, { schedule_id: schedule.id }).plans.find(plan => plan.id === edited.id)?.status, "pending");
  assert.equal(processAutomaticSchedules(new Date("2026-01-02T12:00:00Z")).posted_count, 1);
});

test("logging an automatic monthly payment early leaves the next slot scheduled and prevents duplicate posting", () => {
  const account = createAccount(owner, { ...request(), name: "Early payment fixture", kind: "money", currency: "PHP", opening_balance: "100" }).account;
  const schedule = createSchedule(owner, { ...request(), account_id: account.id, amount: "10", handling: "automatic", interval_unit: "month", interval_count: 1, start_date: "2027-01-15" }).schedule;
  catchUpPlans(owner, { ...request(), through_date: "2027-01-01" });
  const [plan] = listPlans(owner, { schedule_id: schedule.id }).plans;
  const payload = { ...request(), version: plan.version, account_id: account.id, amount: "10", transaction_date: "2027-01-01" };
  const posted = postPlan(owner, plan.id, payload);
  assert.equal(posted.plan.status, "satisfied");
  assert.equal(postPlan(owner, plan.id, payload).transaction.id, posted.transaction.id);
  processAutomaticSchedules(new Date("2027-01-15T12:00:00Z"));
  assert.equal(getAccount(owner, account.id).balance_cents, 9000);
  const pending = listPlans(owner, { schedule_id: schedule.id }).plans;
  assert.deepEqual(pending.map(row => [row.due_date, row.handling]), [["2027-02-15", "automatic"]]);
});
