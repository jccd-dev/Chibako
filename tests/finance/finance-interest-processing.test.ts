import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb, maintenanceMarkerPath, MaintenanceError } from "../../src/lib/db";
import { createAccount, getAccount, getFinanceSummary, updateAccount } from "../../src/features/finance/accounts";
import { getActivityTotals, listTransactions, postTransaction, readTransaction } from "../../src/features/finance/activity";
import { correctActivity, hideActivity, recordRefund, revertActivity } from "../../src/features/finance/corrections";
import { processAutomaticInterest, getInterestProcessingStatus } from "../../src/features/finance/interest-processing";
import { readInterestClosingBalance } from "../../src/features/finance/interest-balances";
import { createGoal, getGoal, listGoalAllocationShortfalls } from "../../src/features/finance/goals";
import { getFinanceReport } from "../../src/features/finance/budgets";
import { createPlan, matchPlan } from "../../src/features/finance/planning";
import { createObligation, postObligationPayment } from "../../src/features/finance/obligations";

const vault = mkdtempSync(join(tmpdir(), "chibako-TEST-interest-processing-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner = { kind: "owner" } as const;
const at = (day: string) => new Date(`${day}T00:00:00+08:00`);
beforeEach(() => {
  const db = getDb();
  db.exec(`DELETE FROM finance_note_links; DELETE FROM finance_obligation_payments; DELETE FROM finance_obligation_movements;
    DELETE FROM finance_plans; DELETE FROM finance_obligations; DELETE FROM finance_goal_allocations; DELETE FROM finance_goals; DELETE FROM finance_interest_cursors; DELETE FROM finance_interest_adjustments;
    DELETE FROM finance_interest_periods; DELETE FROM finance_interest_configurations; DELETE FROM finance_interest_state;
    DELETE FROM finance_transactions; DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_accounts;`);
});
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

function fixture(balance = "100", rate = 365000, frequency = "daily", end: string | null = null) {
  const account = createAccount(owner, { request_id: randomUUID(), name: "TEST interest", kind: "money", currency: "PHP", opening_balance: balance }).account;
  getDb().prepare("UPDATE finance_accounts SET created_at=? WHERE id=?").run(at("2024-01-01").getTime() / 1000, account.id);
  const config = randomUUID();
  getDb().prepare(`INSERT INTO finance_interest_configurations(id,account_id,start_date,end_date,annual_rate_scaled,tax_scaled,frequency,actor_id,request_id,created_at)
    VALUES (?,?,'2024-01-01',?,?,0,?,'owner','TEST-enable',0)`).run(config, account.id, end, rate, frequency);
  return { id: account.id, config };
}
function periods() {
  return getDb().prepare("SELECT * FROM finance_interest_periods ORDER BY payout_date,start_date").all() as { id: string; payout_transaction_id: string | null; amount_cents: number; payout_date: string }[];
}
function adjustments() {
  return getDb().prepare("SELECT * FROM finance_interest_adjustments ORDER BY transaction_date,id").all() as { id: string; amount_cents: number; transaction_date: string }[];
}

test("catch-up compounds actual-dated payouts, preserves originals and replays without writes", () => {
  const { id } = fixture("100", 3650000);
  assert.equal(processAutomaticInterest(at("2024-01-04")).posted_count, 3);
  assert.deepEqual(periods().map(p => [p.payout_date, p.amount_cents]), [["2024-01-02", 100], ["2024-01-03", 101], ["2024-01-04", 102]]);
  assert.equal(getAccount(owner, id).balance_cents, 10303);
  const original = periods();
  const audit = getDb().prepare("SELECT * FROM finance_audit").all();
  assert.equal(processAutomaticInterest(at("2024-01-04")).posted_count, 0);
  assert.deepEqual(periods(), original);
  assert.deepEqual(getDb().prepare("SELECT * FROM finance_audit").all(), audit);
  assert.equal(getDb().prepare("SELECT * FROM finance_audit WHERE operation='interest.payout'").all().length, 3);
});

test("backdated income causes positive and negative dated income adjustments without self-triggering", () => {
  const { id } = fixture();
  processAutomaticInterest(at("2024-01-02"));
  const payout = periods()[0];
  const source = postTransaction(owner, { request_id: "TEST-backdated", type: "income", account_id: id, amount: "100", transaction_date: "2024-01-01" }).transaction;
  assert.equal(processAutomaticInterest(at("2024-01-03")).adjusted_count, 1);
  assert.deepEqual(adjustments().map(p => [p.amount_cents, p.transaction_date]), [[10, "2024-01-03"]]);
  assert.equal(periods()[0].payout_transaction_id, payout.payout_transaction_id);
  assert.equal(readTransaction(payout.payout_transaction_id!, true).amount_cents, 10);
  const correction = adjustments()[0];
  assert.equal(readTransaction(correction.id, true).interest_adjustment, true);
  assert.equal(readTransaction(correction.id, true).interest_period_id, payout.id);
  assert.equal(processAutomaticInterest(at("2024-01-03")).adjusted_count, 0);
  revertActivity(owner, source.id, { request_id: "TEST-revert", version: source.version });
  assert.equal(processAutomaticInterest(at("2024-01-03")).adjusted_count, 2);
  assert.equal(adjustments().reduce((sum, entry) => sum + entry.amount_cents, 0), -10);
  assert.equal(processAutomaticInterest(at("2024-01-03")).adjusted_count, 0);
  assert.equal(getActivityTotals(owner, { month: "2024-01" }).income_cents, 20);
  const report = getFinanceReport(owner, { date_from: "2024-01-01", date_to: "2024-01-31" });
  assert.equal(report.income_cents, 20);
  assert.equal(report.spending_cents, 0);
  assert.equal(getFinanceSummary(owner).money.balance_cents, getAccount(owner, id).balance_cents);
  assert.equal(readInterestClosingBalance(id, "2024-01-02"), 10010);
});

test("managed records reject correction, revert, refund, and plan/obligation matching but allow hide", () => {
  const { id } = fixture();
  processAutomaticInterest(at("2024-01-02"));
  const payoutId = periods()[0].payout_transaction_id!;
  const plan = createPlan(owner, { request_id: "TEST-plan", account_id: id, type: "income", amount: "0.10", due_date: "2024-01-02" }).plan;
  const obligation = createObligation(owner, { request_id: "TEST-obligation", kind: "receivable", name: "TEST principal", principal: "1" }).obligation;
  assert.throws(() => matchPlan(owner, plan.id, { request_id: "TEST-match", version: plan.version, transaction_id: payoutId, transaction_version: 1 }), { code: "invalid_match" });
  assert.throws(() => postObligationPayment(owner, { request_id: "TEST-payment", obligation_id: obligation.id, obligation_version: obligation.version, account_id: id, amount: "0.10", transaction_date: "2024-01-02", cash_activity_id: payoutId, cash_activity_version: 1 }), { code: "invalid_cash_activity" });
  for (const action of [() => correctActivity(owner, payoutId, { request_id: "TEST-correct", version: 1, amount: "1" }), () => revertActivity(owner, payoutId, { request_id: "TEST-revert-payout", version: 1 }), () => recordRefund(owner, payoutId, { request_id: "TEST-refund", version: 1, account_id: id, amount: "0.01", transaction_date: "2024-01-02" })]) assert.throws(action, { code: "managed_interest" });
  assert.equal(listTransactions(owner, { matchable: true }).transactions.length, 0);
  assert.equal(listTransactions(owner, { payment_matchable: true }).transactions.length, 0);
  hideActivity(owner, payoutId, { request_id: "TEST-hide", version: 1 });
  assert.equal(readTransaction(payoutId, false).hidden, true);
  assert.equal(processAutomaticInterest(at("2024-01-02")).posted_count, 0);
});

test("closed configurations pay final accrual on schedule even on archived accounts", () => {
  const { id } = fixture("100", 365000, "monthly", "2024-01-03");
  updateAccount(owner, id, { request_id: "TEST-archive", version: 1, archived: true });
  assert.equal(processAutomaticInterest(at("2024-01-31")).posted_count, 0);
  assert.equal(processAutomaticInterest(at("2024-02-01")).posted_count, 1);
  assert.equal(periods()[0].amount_cents, 20);
  assert.equal(getAccount(owner, id).balance_cents, 10020);
});

test("per-account failures roll back payouts, cursors and audit, then recover after maintenance", () => {
  const bad = fixture("90071992547409.91", 9007199254740991);
  const good = fixture();
  const result = processAutomaticInterest(at("2024-01-02"));
  assert.equal(result.failed_count, 1);
  assert.equal(result.posted_count, 1);
  assert.equal(getAccount(owner, bad.id).balance_cents, Number.MAX_SAFE_INTEGER);
  assert.match(getInterestProcessingStatus(owner, bad.id).automatic_error!, /range/);
  assert.equal(getAccount(owner, good.id).balance_cents, 10010);
  writeFileSync(maintenanceMarkerPath(), "TEST interest maintenance");
  assert.throws(() => processAutomaticInterest(at("2024-01-03")), MaintenanceError);
  rmSync(maintenanceMarkerPath());
  getDb().prepare("UPDATE finance_interest_configurations SET annual_rate_scaled=0 WHERE id=?").run(bad.config);
  assert.equal(processAutomaticInterest(at("2024-01-03")).failed_count, 0);
  assert.equal(getInterestProcessingStatus(owner, bad.id).automatic_error, null);
  assert.equal(getAccount(owner, good.id).balance_cents, 10020);
});

test("bounded zero-cent catch-up resumes from durable cursors across processes", async () => {
  fixture("100", 0);
  const result = processAutomaticInterest(at("2024-04-15"));
  assert.equal(result.has_more, true);
  assert.equal(periods().length, 100);
  assert.equal(periods().filter(period => period.payout_transaction_id !== null).length, 0);
  const run = promisify(execFile);
  const script = `import { processAutomaticInterest } from './src/features/finance/interest-processing.ts';
    console.log(JSON.stringify(processAutomaticInterest(new Date('2024-04-15T00:00:00+08:00'))));`;
  await run(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd(), env: { ...process.env, CHIBAKO_DATA_DIR: vault } });
  assert.equal(periods().length, 105);
  assert.equal(processAutomaticInterest(at("2024-04-15")).posted_count, 0);
  assert.equal(periods().length, 105);
});

test("two independent workers serialize duplicate prevention on the same disposable vault", async () => {
  const { id } = fixture("100", 3650000);
  const run = promisify(execFile);
  const script = `import { processAutomaticInterest } from './src/features/finance/interest-processing.ts';
    processAutomaticInterest(new Date('2024-01-04T00:00:00+08:00'));`;
  await Promise.all([1, 2].map(() => run(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd(), env: { ...process.env, CHIBAKO_DATA_DIR: vault } })));
  assert.equal(periods().length, 3);
  assert.equal(getAccount(owner, id).balance_cents, 10303);
});

test("audit failure rolls back financial records and cursor before successful retry", () => {
  fixture();
  getDb().exec("CREATE TRIGGER TEST_interest_audit_failure BEFORE INSERT ON finance_audit WHEN NEW.operation='interest.payout' BEGIN SELECT RAISE(ABORT, 'TEST audit unavailable'); END;");
  try {
    assert.equal(processAutomaticInterest(at("2024-01-02")).failed_count, 1);
    assert.equal(periods().length, 0);
    assert.equal(getDb().prepare("SELECT * FROM finance_transactions").all().length, 0);
    assert.equal(getDb().prepare("SELECT * FROM finance_interest_cursors").all().length, 0);
    assert.equal(getDb().prepare("SELECT * FROM finance_requests WHERE operation='interest.payout'").all().length, 0);
  } finally { getDb().exec("DROP TRIGGER TEST_interest_audit_failure"); }
  assert.equal(processAutomaticInterest(at("2024-01-02")).posted_count, 1);
});

test("archived interest category falls back without recreating it, and adjustments can be hidden", () => {
  const { id } = fixture();
  processAutomaticInterest(at("2024-01-02"));
  const category = readTransaction(periods()[0].payout_transaction_id!, false).category_id!;
  const categoryCount = getDb().prepare("SELECT id FROM finance_classifications WHERE name='Interest'").all().length;
  getDb().prepare("UPDATE finance_classifications SET archived=1 WHERE id=?").run(category);
  processAutomaticInterest(at("2024-01-03"));
  assert.equal(readTransaction(periods()[1].payout_transaction_id!, true).category_id, null);
  assert.equal(getDb().prepare("SELECT id FROM finance_classifications WHERE name='Interest'").all().length, categoryCount);
  postTransaction(owner, { request_id: "TEST-source", type: "income", account_id: id, amount: "100", transaction_date: "2024-01-01" });
  processAutomaticInterest(at("2024-01-03"));
  const correction = adjustments()[0];
  assert.throws(() => revertActivity(owner, correction.id, { request_id: "TEST-revert-adjustment", version: 1 }), { code: "managed_interest" });
  assert.throws(() => correctActivity(owner, correction.id, { request_id: "TEST-edit-adjustment", version: 1, amount: "1" }), { code: "managed_interest" });
  const before = getAccount(owner, id).balance_cents;
  hideActivity(owner, correction.id, { request_id: "TEST-hide-adjustment", version: 1 });
  assert.equal(readTransaction(correction.id, true).hidden, true);
  assert.equal(getAccount(owner, id).balance_cents, before);
  assert.equal(processAutomaticInterest(at("2024-01-03")).adjusted_count, 0);
});

test("negative correction affects linked goals, shortfall projections and audit warnings", () => {
  const { id } = fixture();
  const source = postTransaction(owner, { request_id: "TEST-source", type: "income", account_id: id, amount: "100", transaction_date: "2024-01-01" }).transaction;
  processAutomaticInterest(at("2024-01-02"));
  const goal = createGoal(owner, { request_id: "TEST-goal", name: "TEST linked goal", target: "300", linked_account_id: id }).goal;
  getDb().prepare("INSERT INTO finance_goal_allocations(goal_id,account_id,amount_cents) VALUES (?,?,20020)").run(goal.id, id);
  revertActivity(owner, source.id, { request_id: "TEST-revert-source", version: source.version });
  processAutomaticInterest(at("2024-01-02"));
  assert.equal(getGoal(owner, goal.id).saved_cents, 10010);
  const shortfall = listGoalAllocationShortfalls(owner, { limit: 10 }).accounts[0];
  assert.equal(shortfall.balance_cents, 10010);
  assert.equal(shortfall.shortfall_cents, 10010);
  const audit = getDb().prepare("SELECT after_json FROM finance_audit WHERE operation='interest.adjust'").get() as { after_json: string };
  assert.match(audit.after_json, /allocation_shortfall/);
  assert.equal(getActivityTotals(owner, { month: "2024-01" }).income_cents, 10);
});

test("late corrections compound only from their actual posting day", () => {
  const { id } = fixture("100", 3650000);
  processAutomaticInterest(at("2024-01-03")); // Original January 2 credit 100; January 3 credit 101.
  postTransaction(owner, { request_id: "TEST-backdate", type: "income", account_id: id, amount: "100", transaction_date: "2024-01-01" });
  processAutomaticInterest(at("2024-01-04"));
  assert.deepEqual(periods().map(period => period.amount_cents), [100, 101, 202]);
  assert.deepEqual(adjustments().map(row => row.amount_cents), [100, 100]);
  // January 3 held 20201 cents; the January 4 corrections were not held then.
  assert.equal(readInterestClosingBalance(id, "2024-01-03"), 20201);
  processAutomaticInterest(at("2024-01-05"));
  assert.equal(periods()[3].amount_cents, 206); // January 4 held 20603 cents.
  assert.equal(adjustments().length, 2);
});

test("archiving closes an active segment today, preserves its due date, and unarchiving does not resume", () => {
  const { id, config } = fixture("100", 365000, "monthly");
  const archived = updateAccount(owner, id, { request_id: "TEST-archive", version: 1, archived: true }).account;
  const closed = getDb().prepare("SELECT end_date FROM finance_interest_configurations WHERE id=?").get(config) as { end_date: string };
  assert.match(closed.end_date, /^\d{4}-\d{2}-\d{2}$/);
  updateAccount(owner, id, { request_id: "TEST-unarchive", version: archived.version, archived: false });
  assert.deepEqual(getDb().prepare("SELECT end_date FROM finance_interest_configurations WHERE id=?").get(config), closed);
  assert.equal(getDb().prepare("SELECT id FROM finance_interest_configurations WHERE account_id=? AND end_date IS NULL").all(id).length, 0);
});

test("fractional carry survives configuration changes", () => {
  const { id } = fixture("5", 365000, "daily", "2024-01-02");
  getDb().prepare("INSERT INTO finance_interest_configurations(id,account_id,start_date,end_date,annual_rate_scaled,tax_scaled,frequency,actor_id,request_id,created_at) VALUES (?,?,'2024-01-02','2024-01-03',365000,0,'daily','owner','TEST-reenable',0)").run(randomUUID(), id);
  processAutomaticInterest(at("2024-01-03"));
  assert.deepEqual(periods().map(period => period.amount_cents), [1, 0]);
  assert.equal(getAccount(owner, id).balance_cents, 501);
});

test("current cash changes between bounded batches do not restart settled history", () => {
  const { id } = fixture("100", 0);
  processAutomaticInterest(at("2024-08-01"));
  assert.equal(periods().length, 100);
  postTransaction(owner, { request_id: "TEST-current", type: "income", account_id: id, amount: "1", transaction_date: "2024-08-01" });
  processAutomaticInterest(at("2024-08-01"));
  assert.equal(periods().length, 200);
  postTransaction(owner, { request_id: "TEST-current-2", type: "income", account_id: id, amount: "1", transaction_date: "2024-08-01" });
  assert.equal(processAutomaticInterest(at("2024-08-01")).has_more, false);
  assert.equal(periods().length, 213);
});

test("new current activity cannot skip an unfinished historical correction scan", () => {
  const { id } = fixture();
  for (let i = 0; i < 3; i++) processAutomaticInterest(at("2024-08-01"));
  assert.equal(periods().length, 213);
  postTransaction(owner, { request_id: "TEST-past", type: "income", account_id: id, amount: "100", transaction_date: "2024-01-01" });
  processAutomaticInterest(at("2024-08-01"));
  assert.equal(adjustments().length, 100);
  postTransaction(owner, { request_id: "TEST-present", type: "income", account_id: id, amount: "1", transaction_date: "2024-08-01" });
  processAutomaticInterest(at("2024-08-01"));
  assert.equal(adjustments().length, 200);
  processAutomaticInterest(at("2024-08-01"));
  assert.equal(adjustments().length, 213);
  assert.equal(processAutomaticInterest(at("2024-08-01")).adjusted_count, 0);
});
