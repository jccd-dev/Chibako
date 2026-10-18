import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createAccount, getAccount } from "../src/features/finance/accounts";
import { revertActivity } from "../src/features/finance/corrections";
import { getPlan, listPlans, postPlan } from "../src/features/finance/planning";
import { listPlanning } from "../src/features/finance/planning-list";
import { catchUpPlans, createSchedule, deleteSchedule, getSchedule, listSchedules, processAutomaticSchedules, updateSchedule } from "../src/features/finance/recurrence";
import { getDb } from "../src/lib/db";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-schedule-actions-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_plans; DELETE FROM finance_schedules; DELETE FROM finance_transactions; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

function fixture() {
  const account = createAccount(owner, { request_id: randomUUID(), name: "TEST schedule actions", kind: "money", currency: "PHP", opening_balance: "100" }).account;
  const schedule = createSchedule(owner, { request_id: randomUUID(), account_id: account.id, amount: "10", interval_count: 1, interval_unit: "month", start_date: "2026-01-01", handling: "automatic" }).schedule;
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-01-01" });
  return { account, schedule };
}

test("schedule deletion is authorized, versioned, atomic and retryable while preserving cash history", () => {
  const { account, schedule } = fixture();
  const plans = listPlans(owner, { schedule_id: schedule.id }).plans;
  const posted = postPlan(owner, plans[0].id, { request_id: randomUUID(), version: plans[0].version, account_id: account.id, amount: "12", transaction_date: "2026-01-01" });
  const input = { request_id: randomUUID(), version: schedule.version };
  assert.throws(() => deleteSchedule({ kind: "api-key", id: "write-only", scopes: ["finance:write"] }, schedule.id, input), { status: 403 });
  assert.throws(() => deleteSchedule(owner, schedule.id, { ...input, version: 999 }), { status: 409 });
  assert.equal(listPlans(owner, { schedule_id: schedule.id }).total, 1);
  const deleted = deleteSchedule(owner, schedule.id, input);
  assert.deepEqual(deleteSchedule(owner, schedule.id, input), deleted);
  assert.equal(deleted.schedule.paused, true);
  assert.equal(listSchedules(owner).total, 0);
  assert.equal(listPlanning(owner).total, 0);
  assert.throws(() => getSchedule(owner, schedule.id), { status: 404 });
  assert.equal(listPlans(owner, { schedule_id: schedule.id }).total, 0);
  assert.equal(getPlan(owner, posted.plan.id).status, "satisfied");
  assert.equal(getAccount(owner, account.id).balance_cents, 8800);
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2028-01-01" });
  assert.equal(processAutomaticSchedules(new Date("2028-01-01T12:00:00Z")).posted_count, 0);
  assert.equal(getAccount(owner, account.id).balance_cents, 8800);
  revertActivity(owner, posted.transaction.id, { request_id: randomUUID(), version: posted.transaction.version });
  assert.equal(getPlan(owner, posted.plan.id).status, "cancelled");
  assert.equal(listPlans(owner, { schedule_id: schedule.id }).total, 0);
});

test("schedule overview edits work with and without pending payments and retain posted amounts", () => {
  const { account, schedule } = fixture();
  assert.equal(getSchedule(owner, schedule.id).pending_count, 2);
  const edited = updateSchedule(owner, schedule.id, { request_id: randomUUID(), version: schedule.version, amount: "15" }).schedule;
  assert.ok(listPlans(owner, { schedule_id: schedule.id }).plans.every(plan => plan.amount_cents === 1500));
  for (const plan of listPlans(owner, { schedule_id: schedule.id }).plans) postPlan(owner, plan.id, { request_id: randomUUID(), version: plan.version, account_id: account.id, amount: "15", transaction_date: plan.due_date });
  assert.equal(getSchedule(owner, schedule.id).pending_count, 0);
  const future = updateSchedule(owner, schedule.id, { request_id: randomUUID(), version: edited.version, amount: "20", interval_count: 2 }).schedule;
  assert.equal(future.amount_cents, 2000);
  assert.equal(future.interval_count, 2);
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-06-01" });
  const pending = listPlans(owner, { schedule_id: schedule.id }).plans;
  assert.ok(pending.length > 0);
  assert.ok(pending.every(plan => plan.amount_cents === 2000));
  assert.ok(listPlans(owner, { schedule_id: schedule.id, status: "satisfied" }).plans.every(plan => plan.amount_cents === 1500));
  assert.throws(() => updateSchedule(owner, schedule.id, { request_id: randomUUID(), version: future.version, from_plan_id: pending[0].id, amount: "25" }), { status: 400 });
});

test("newest-first payment pagination orders the full history before taking a page", () => {
  const { schedule } = fixture();
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-06-01" });
  const oldest = listPlans(owner, { schedule_id: schedule.id }).plans.map(plan => plan.id);
  const newest = listPlans(owner, { schedule_id: schedule.id, order: "newest", limit: 2, offset: 1 }).plans.map(plan => plan.id);
  assert.deepEqual(newest, oldest.toReversed().slice(1, 3));
});
