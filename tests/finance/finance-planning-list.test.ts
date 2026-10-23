import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createAccount } from "../../src/features/finance/accounts";
import { cancelPlan, createPlan, listPlans, postPlan } from "../../src/features/finance/planning";
import { listPlanning } from "../../src/features/finance/planning-list";
import { catchUpPlans, createSchedule, pauseSchedule, skipPlans, updateSchedule } from "../../src/features/finance/recurrence";
import type { FinanceActor } from "../../src/features/finance/types";
import { getDb } from "../../src/lib/db";

const vault = mkdtempSync(join(tmpdir(), "chibako-planning-list-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
const as_of = "2026-02-15";
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_plans; DELETE FROM finance_schedules; DELETE FROM finance_transactions; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

function account() {
  return createAccount(owner, { request_id: randomUUID(), name: "Grouped planning fixture", kind: "money", currency: "PHP", opening_balance: "1000" }).account;
}
function schedule(account_id: string, extra: object = {}) {
  return createSchedule(owner, { request_id: randomUUID(), account_id, amount: "10", interval_count: 1,
    interval_unit: "day", start_date: "2026-01-01", ...extra }).schedule;
}
function oneTime(account_id: string, due_date: string, text = "One-time fixture") {
  return createPlan(owner, { request_id: randomUUID(), account_id, amount: "10", due_date, text }).plan;
}
function skipAll(schedule_id: string) {
  skipPlans(owner, { request_id: randomUUID(), plans: listPlans(owner, { schedule_id, limit: 100 }).plans.map(({ id, version }) => ({ id, version })) });
}

test("a schedule is one row with every pending count beyond the occurrence page", () => {
  const cash = account(), recurring = schedule(cash.id, { text: "Daily fixture" });
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-02-28" });
  const page = listPlanning(owner, { as_of, limit: 1 });
  assert.equal(page.total, 1);
  assert.equal(page.items.length, 1);
  const [row] = page.items;
  assert.deepEqual([row.id, row.kind, row.title, row.interval_count, row.interval_unit], [recurring.id, "schedule", "Daily fixture", 1, "day"]);
  assert.deepEqual([row.pending_count, row.overdue_count, row.due_today_count, row.manual_due_count], [60, 45, 1, 46]);
  assert.equal(row.next_due_date, "2026-01-01");
  assert.equal(row.first_pending_id, listPlans(owner, { schedule_id: recurring.id, limit: 1 }).plans[0].id);
  assert.equal(row.status, "overdue");
  assert.equal("text" in row, false);
});

test("filters and totals cover the whole list before bounded stable pagination", () => {
  const cash = account();
  for (let i = 0; i < 30; i++) oneTime(cash.id, "2027-01-01", `Upcoming fixture ${String(i).padStart(2, "0")}`);
  const due = oneTime(cash.id, as_of), late = oneTime(cash.id, "2026-02-14");
  const automatic = schedule(cash.id, { start_date: "2027-02-01", handling: "automatic" });
  getDb().prepare("UPDATE finance_schedules SET automatic_error=? WHERE id=?").run("Automatic posting needs review", automatic.id);
  const first = listPlanning(owner, { as_of }), second = listPlanning(owner, { as_of, offset: 25 });
  assert.deepEqual([first.total, first.limit, first.offset, first.items.length, second.items.length], [33, 25, 0, 25, 8]);
  assert.equal(new Set([...first.items, ...second.items].map(row => `${row.kind}:${row.id}`)).size, 33);
  const attention = listPlanning(owner, { as_of, filter: "attention", limit: 1 });
  assert.equal(attention.total, 3);
  assert.equal(attention.items[0].id, late.id);
  assert.equal(listPlanning(owner, { as_of, filter: "attention", limit: 1, offset: 1 }).items[0].id, due.id);
  assert.equal(listPlanning(owner, { as_of, filter: "attention", limit: 1, offset: 2 }).items[0].id, automatic.id);
  assert.equal(listPlanning(owner, { as_of, filter: "upcoming" }).total, 31);
  assert.deepEqual(listPlanning(owner, { as_of, offset: 100 }).items, []);
  assert.equal(listPlanning(owner, { as_of, offset: 100 }).total, 33);
});

test("active projected manual dues need attention before catch-up without inventing pending counts", () => {
  const cash = account(), overdue = schedule(cash.id), dueToday = schedule(cash.id, { start_date: as_of });
  const paused = schedule(cash.id, { paused: true });
  schedule(cash.id, { start_date: "2027-01-01" });
  schedule(cash.id, { handling: "automatic" });
  const attention = listPlanning(owner, { as_of, filter: "attention" });
  assert.equal(attention.total, 2);
  assert.deepEqual(attention.items.map(row => [row.id, row.status]), [[overdue.id, "overdue"], [dueToday.id, "due-today"]]);
  assert.ok(attention.items.every(row => row.pending_count === 0 && row.manual_due_count === 0
    && row.overdue_count === 0 && row.due_today_count === 0 && row.first_pending_id === null));
  assert.deepEqual(listPlanning(owner, { as_of, filter: "paused" }).items.map(row => row.id), [paused.id]);
  assert.equal(listPlans(owner, { status: "all" }).total, 0);
});

test("paused manual dues and manually reverted automatic occurrences still need attention", () => {
  const cash = account(), paused = schedule(cash.id), automatic = schedule(cash.id, { handling: "automatic" });
  catchUpPlans(owner, { request_id: randomUUID(), through_date: as_of });
  pauseSchedule(owner, paused.id, { request_id: randomUUID(), version: paused.version });
  const occurrence = listPlans(owner, { schedule_id: automatic.id, limit: 1 }).plans[0];
  getDb().prepare("UPDATE finance_plans SET automatic_eligible=0 WHERE id=?").run(occurrence.id);
  const attention = listPlanning(owner, { as_of, filter: "attention" });
  assert.equal(attention.total, 2);
  assert.equal(attention.items.find(row => row.id === paused.id)?.status, "paused");
  assert.equal(attention.items.find(row => row.id === automatic.id)?.manual_due_count, 1);
  assert.deepEqual(listPlanning(owner, { as_of, filter: "paused" }).items.map(row => row.id), [paused.id]);
  assert.equal(listPlanning(owner, { as_of, filter: "upcoming" }).total, 0);
});

test("all preserves terminal one-offs and ended schedules without counting their history as pending", () => {
  const cash = account(), posted = oneTime(cash.id, as_of), cancelled = oneTime(cash.id, as_of);
  postPlan(owner, posted.id, { request_id: randomUUID(), version: posted.version, account_id: cash.id, amount: "10", transaction_date: as_of });
  cancelPlan(owner, cancelled.id, { request_id: randomUUID(), version: cancelled.version });
  const ended = schedule(cash.id, { max_occurrences: 1 });
  catchUpPlans(owner, { request_id: randomUUID(), through_date: as_of });
  skipAll(ended.id);
  const page = listPlanning(owner, { as_of });
  assert.equal(page.total, 3);
  assert.deepEqual(new Set(page.items.map(row => row.status)), new Set(["recorded", "cancelled", "ended"]));
  assert.ok(page.items.every(row => row.next_due_date === null && row.pending_count === 0 && row.first_pending_id === null));
  assert.equal(listPlanning(owner, { as_of, filter: "attention" }).total, 0);
  assert.equal(listPlanning(owner, { as_of, filter: "upcoming" }).total, 0);
});

test("projected dates share month-end, end-date, occurrence and total caps including cadence slot offsets", () => {
  const cash = account();
  const monthly = schedule(cash.id, { start_date: "2026-01-31", interval_unit: "month", max_occurrences: 2 });
  const total = schedule(cash.id, { start_date: "2026-01-31", interval_unit: "month", total_limit: "25" });
  const boundary = schedule(cash.id, { start_date: "2026-01-31", interval_unit: "month", end_date: "2026-01-31" });
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-01-31" });
  skipAll(monthly.id); skipAll(total.id); skipAll(boundary.id);
  assert.ok(listPlanning(owner, { as_of }).items.every(row => row.status === "ended" && row.next_due_date === null));
  const moved = schedule(cash.id, { max_occurrences: 4 });
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-01-02" });
  const plans = listPlans(owner, { schedule_id: moved.id }).plans;
  skipPlans(owner, { request_id: randomUUID(), plans: [{ id: plans[0].id, version: plans[0].version }] });
  updateSchedule(owner, moved.id, { request_id: randomUUID(), version: moved.version, from_plan_id: plans[1].id,
    from_plan_version: plans[1].version, interval_count: 2 });
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-01-04" });
  const pending = listPlans(owner, { schedule_id: moved.id }).plans;
  assert.deepEqual(pending.map(row => row.due_date), ["2026-01-02", "2026-01-04", "2026-01-06"]);
  skipAll(moved.id);
  assert.equal(listPlanning(owner, { as_of }).items.find(row => row.id === moved.id)?.next_due_date, null);
  const fresh = schedule(cash.id, { start_date: "2026-01-31", interval_unit: "month" });
  assert.equal(listPlanning(owner, { as_of }).items.find(row => row.id === fresh.id)?.next_due_date, "2026-01-31");
  assert.equal(listPlans(owner, { schedule_id: fresh.id }).total, 0, "projection must not create occurrences");
  catchUpPlans(owner, { request_id: randomUUID(), through_date: "2026-01-31" });
  skipAll(fresh.id);
  assert.equal(listPlanning(owner, { as_of }).items.find(row => row.id === fresh.id)?.next_due_date, "2026-03-31", "projection uses the original month-end anchor");
});

test("read scopes, calendar input, pagination bounds and a read-only database are enforced", () => {
  const cash = account();
  schedule(cash.id);
  for (const scopes of [[], ["*"], ["notes:read"], ["finance:manage"], ["finance:write"]])
    assert.throws(() => listPlanning({ kind: "api-key", id: "planning-list-scope", scopes }), { status: 403 });
  for (const invalid of [{ filter: "pending" }, { as_of: "2026-02-30" }, { limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: Number.MAX_SAFE_INTEGER + 1 }, { unknown: true }])
    assert.throws(() => listPlanning(owner, invalid), { status: 400 });
  const changes = getDb().prepare("SELECT total_changes() AS total").get();
  getDb().pragma("query_only=ON");
  try {
    assert.equal(listPlanning({ kind: "api-key", id: "planning-list-reader", scopes: ["finance:read"] }).total, 1);
    assert.equal(listPlanning({ kind: "trusted-local" }, { as_of }).total, 1);
    assert.equal(listPlanning(owner, { as_of, offset: Number.MAX_SAFE_INTEGER }).total, 1);
  } finally { getDb().pragma("query_only=OFF"); }
  assert.deepEqual(getDb().prepare("SELECT total_changes() AS total").get(), changes);
});
