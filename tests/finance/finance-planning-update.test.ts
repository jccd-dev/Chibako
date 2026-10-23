import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createAccount, getAccount } from "../../src/features/finance/accounts";
import { revertActivity } from "../../src/features/finance/corrections";
import { createPlan, getPlan, listPlans, postPlan } from "../../src/features/finance/planning";
import { createObligation } from "../../src/features/finance/obligations";
import { catchUpPlans, createSchedule, getSchedule, processAutomaticSchedules, skipPlans, updateSchedule } from "../../src/features/finance/recurrence";
import { repeatPreset, repeatPresets } from "../../src/features/finance/repeat-presets";
import { occurrenceDate } from "../../src/features/finance/schedule-calendar";
import { getDb } from "../../src/lib/db";
import type { FinancePlan } from "../../src/features/finance/planning-types";
import type { FinanceActor } from "../../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-planning-update-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_plans; DELETE FROM finance_schedules; DELETE FROM finance_transactions; DELETE FROM finance_obligations; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

function account() {
  return createAccount(owner, { request_id: randomUUID(), name: "Planning update", kind: "money", currency: "PHP", opening_balance: "100" }).account;
}

test("calendar occurrence helper clamps from the anchor, honors end dates, and rejects invalid indices", () => {
  const monthly = { start_date: "2026-01-31", end_date: "2026-04-30", interval_count: 1, interval_unit: "month" as const };
  assert.deepEqual([0, 1, 2, 3, 4].map(index => occurrenceDate(monthly, index)), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", null]);
  assert.equal(occurrenceDate(monthly, -1), null);
  assert.equal(occurrenceDate({ ...monthly, start_date: "2026-02-30" }, 0), null);
});

test("repeat presets map every supported cadence and preserve unmatched values as custom", () => {
  assert.deepEqual(repeatPresets.map(({ value }) => value), ["daily", "weekly", "biweekly", "bimonthly", "monthly", "quarterly", "yearly"]);
  for (const preset of repeatPresets) assert.equal(repeatPreset(preset.count, preset.unit), preset.value);
  assert.equal(repeatPreset(5, "day"), "custom");
});

test("plans persist default and explicit local time and timezone; invalid values reject", () => {
  const cash = account();
  const base = { request_id: randomUUID(), account_id: cash.id, amount: "12", due_date: "2026-10-15", type: "expense" as const };
  const defaults = createPlan(owner, base).plan;
  assert.equal(defaults.logged_time, "00:00");
  assert.equal(defaults.timezone, "UTC");
  const local = createPlan(owner, { ...base, request_id: randomUUID(), logged_time: "09:45", timezone: "Asia/Manila" }).plan;
  assert.deepEqual([local.logged_time, local.timezone], ["09:45", "Asia/Manila"]);
  assert.deepEqual([getPlan(owner, local.id).logged_time, getPlan(owner, local.id).timezone], ["09:45", "Asia/Manila"]);
  for (const invalid of [{ logged_time: "24:00" }, { timezone: "Mars/Olympus" }])
    assert.throws(() => createPlan(owner, { ...base, request_id: randomUUID(), ...invalid }), { status: 400 });
});

test("schedule defaults stay manual and capped slots copy local time and timezone without extending after skips", () => {
  const cash = account();
  const base = { request_id: randomUUID(), account_id: cash.id, amount: "12", interval_count: 1, interval_unit: "month" as const, start_date: "2026-01-31" };
  const manual = createSchedule(owner, base).schedule;
  assert.equal(manual.handling, "manual");
  assert.equal(manual.max_occurrences, null);
  assert.equal(manual.total_limit_cents, null);
  const capped = createSchedule(owner, { ...base, request_id: randomUUID(), handling: "automatic", max_occurrences: 5, total_limit: "25", logged_time: "09:30", timezone: "Asia/Manila" }).schedule;
  assert.equal(capped.total_limit_cents, 2500);
  const result = catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-12-31" });
  assert.equal(result.has_more, false);
  const plans = listPlans(owner, { schedule_id: capped.id }).plans;
  assert.deepEqual(plans.map(plan => plan.due_date), ["2026-01-31", "2026-02-28"]);
  assert.ok(plans.every(plan => plan.logged_time === "09:30" && plan.timezone === "Asia/Manila"));
  // The $25 total at $12 per slot allows two complete payments, never a partial third.
  skipPlans(owner, { request_id: randomUUID(), plans: [{ id: plans[0].id, version: plans[0].version }] });
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2027-12-31" });
  assert.equal(listPlans(owner, { schedule_id: capped.id, status: "all" }).total, 2, "a skipped slot still consumes the fixed total budget");
  assert.throws(() => createSchedule({ kind: "api-key", id: "manage-only", scopes: ["finance:manage"] }, { ...base, request_id: randomUUID(), handling: "automatic" }), { status: 403 });
});

test("automatic runner respects each schedule timezone and logged time while manual schedules remain review-only", () => {
  const cash = account(), at = new Date("2026-10-15T12:00:00.000Z");
  const make = (extra: object) => createSchedule(owner, { request_id: randomUUID(), account_id: cash.id, amount: "10", interval_count: 1,
    interval_unit: "day", start_date: "2026-10-15", ...extra }).schedule;
  const dueManila = make({ handling: "automatic", logged_time: "19:00", timezone: "Asia/Manila" });
  const futureManila = make({ handling: "automatic", logged_time: "21:00", timezone: "Asia/Manila" });
  const futureUtc = make({ handling: "automatic", logged_time: "13:00", timezone: "UTC" });
  const manual = make({ logged_time: "00:00", timezone: "UTC" });
  assert.deepEqual(processAutomaticSchedules(at), { posted_count: 1, failed_count: 0, has_more: false });
  assert.equal(getAccount(owner, cash.id).balance_cents, 9000);
  assert.equal(listPlans(owner, { schedule_id: dueManila.id, status: "all" }).plans[0].status, "satisfied");
  for (const row of [futureManila, futureUtc, manual]) {
    const pendingPlans: FinancePlan[] = listPlans(owner, { schedule_id: row.id, status: "all" }).plans;
    assert.ok(pendingPlans.every((plan: FinancePlan) => plan.status === "pending"), row.id);
  }
});

test("automatic execution marker prevents reposting an occurrence after its transaction is reverted", () => {
  const cash = account(), at = new Date("2026-10-15T12:00:00.000Z");
  const schedule = createSchedule(owner, { request_id: randomUUID(), account_id: cash.id, amount: "10", handling: "automatic", interval_count: 1,
    interval_unit: "day", start_date: "2026-10-15", logged_time: "00:00", timezone: "UTC" }).schedule;
  assert.equal(processAutomaticSchedules(at).posted_count, 1);
  const [plan] = listPlans(owner, { schedule_id: schedule.id, status: "all" }).plans;
  const transaction = plan.transaction_id!;
  revertActivity(owner, transaction, { request_id: randomUUID(), version: 1 });
  assert.equal(listPlans(owner, { schedule_id: schedule.id }).plans.find(row => row.id === plan.id)?.status, "pending");
  assert.equal(listPlans(owner, { schedule_id: schedule.id }).plans.find(row => row.id === plan.id)?.handling, "manual");
  assert.equal(processAutomaticSchedules(at).posted_count, 0);
  assert.equal(getAccount(owner, cash.id).balance_cents, 10000);
});

test("automatic processing rolls back a failed generation and exposes a safe retry state", () => {
  const cash = account(), at = new Date("2026-10-15T12:00:00.000Z");
  const schedule = createSchedule(owner, { request_id: randomUUID(), account_id: cash.id, amount: "10", handling: "automatic", interval_count: 1,
    interval_unit: "day", start_date: "2026-10-15", logged_time: "00:00", timezone: "UTC" }).schedule;
  const db = getDb();
  db.exec("CREATE TEMP TRIGGER reject_automatic_audit BEFORE INSERT ON finance_audit BEGIN SELECT RAISE(ABORT, 'private database failure'); END;");
  try {
    assert.deepEqual(processAutomaticSchedules(at), { posted_count: 0, failed_count: 1, has_more: false });
  } finally { db.exec("DROP TRIGGER reject_automatic_audit"); }
  assert.equal(listPlans(owner, { schedule_id: schedule.id, status: "all" }).total, 0);
  assert.equal(getAccount(owner, cash.id).balance_cents, 10000);
  assert.notEqual(getSchedule(owner, schedule.id).automatic_error, null);
  assert.doesNotMatch(getSchedule(owner, schedule.id).automatic_error ?? "", /private database failure/);
  assert.equal(processAutomaticSchedules(at).posted_count, 1);
  assert.equal(getSchedule(owner, schedule.id).automatic_error, null);
});

test("automatic handling rejects obligation-linked schedules", () => {
  const obligation = createObligation(owner, { request_id: randomUUID(), kind: "debt", name: "Manual debt reminder", principal: "100" }).obligation;
  assert.throws(() => createSchedule(owner, { request_id: randomUUID(), account_id: account().id, amount: "10", type: "expense",
    obligation_id: obligation.id, handling: "automatic", interval_count: 1, interval_unit: "month", start_date: "2026-01-01" }), { code: "invalid_obligation" });
});

test("raising a total budget adds only complete slots and never changes satisfied history", () => {
  const cash = account(), schedule = createSchedule(owner, { request_id: randomUUID(), account_id: cash.id, amount: "12", total_limit: "30",
    interval_count: 1, interval_unit: "day", start_date: "2026-01-01" }).schedule;
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-01-01" });
  const initial = listPlans(owner, { schedule_id: schedule.id }).plans;
  const posted = postPlan(owner, initial[0].id, { request_id: randomUUID(), version: initial[0].version, account_id: cash.id, amount: "12", transaction_date: "2026-01-01" });
  const pending = listPlans(owner, { schedule_id: schedule.id }).plans[0];
  updateSchedule(owner, schedule.id, { request_id: randomUUID(), version: schedule.version, from_plan_id: pending.id, from_plan_version: pending.version, amount: "10" });
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-01-02" });
  assert.equal(listPlans(owner, { schedule_id: schedule.id, status: "all" }).total, 3);
  assert.equal(listPlans(owner, { schedule_id: schedule.id, status: "all" }).plans.find(plan => plan.id === initial[0].id)?.amount_cents, 1200);
  assert.equal(posted.plan.status, "satisfied");
  assert.ok(listPlans(owner, { schedule_id: schedule.id }).plans.every(plan => plan.amount_cents === 1000));
});

test("cadence edits retain earlier slots and apply occurrence caps to the remaining cadence", () => {
  const cash = account(), schedule = createSchedule(owner, { request_id: randomUUID(), account_id: cash.id, amount: "10", max_occurrences: 4,
    interval_count: 1, interval_unit: "day", start_date: "2026-01-01" }).schedule;
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-01-02" });
  const rows = listPlans(owner, { schedule_id: schedule.id }).plans;
  skipPlans(owner, { request_id: randomUUID(), plans: [{ id: rows[0].id, version: rows[0].version }] });
  const anchor = rows[1];
  updateSchedule(owner, schedule.id, { request_id: randomUUID(), version: schedule.version, from_plan_id: anchor.id,
    from_plan_version: anchor.version, interval_count: 2 });
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-01-10" });
  const all = listPlans(owner, { schedule_id: schedule.id, status: "all" }).plans;
  assert.equal(all.find(plan => plan.id === rows[0].id)?.status, "cancelled", "the earlier skipped slot stays skipped");
  assert.deepEqual(all.filter(plan => plan.status === "pending").map(plan => plan.due_date), ["2026-01-02", "2026-01-04", "2026-01-06"]);
  assert.equal(all.filter(plan => plan.occurrence_date).length, 5, "three remaining capped slots plus preserved skipped/cadence history");
});
