import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb, SCHEMA_VERSION } from "../../src/lib/db";
import { createAccount, updateAccount, getAccount } from "../../src/features/finance/accounts";
import { calculateInterest, interestPercent, interestPayoutDate } from "../../src/features/finance/interest-calculation";
import { readInterestClosingBalance } from "../../src/features/finance/interest-balances";

const vault = mkdtempSync(join(tmpdir(), "chibako-TEST-interest-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const owner = { kind: "owner" } as const;

test("exact completed-day accrual, partial activation, tax and changing balances", () => {
  const result = calculateInterest({ start_date: "2024-02-28", end_date: "2024-03-02", through_date: "2024-03-01", annual_rate: "36.5", withholding_tax: "20", closingBalance: day => day === "2024-02-28" ? 10000 : 20000 });
  assert.equal(result.amount_cents, 24); // 8 cents + 16 cents, including leap day at divisor 365.
  assert.equal(result.carry, 0n);
  assert.equal(calculateInterest({ start_date: "2024-01-01", end_date: "2024-01-03", through_date: "2024-01-03", annual_rate: "36.5", withholding_tax: "0", closingBalance: () => -100 }).amount_cents, 0);
});

test("half-up payout retains signed carry, zero payouts and range validation", () => {
  const input = { start_date: "2024-01-01", end_date: "2024-01-02", through_date: "2024-01-02", annual_rate: "36.5", withholding_tax: "0", closingBalance: () => 500 };
  const first = calculateInterest(input);
  assert.equal(first.amount_cents, 1);
  assert.equal(calculateInterest({ ...input, carry: first.carry }).amount_cents, 0);
  assert.equal(calculateInterest({ ...input, closingBalance: () => 0 }).amount_cents, 0);
  for (const value of ["-1", "NaN", "Infinity", "1e2", "1.00001", "", "9007199254740992"]) assert.throws(() => interestPercent(value));
  assert.throws(() => interestPercent("100.0001", true));
  assert.equal(interestPercent("1.2345"), 12345n);
  assert.throws(() => calculateInterest({ ...input, annual_rate: "900719925474", closingBalance: () => Number.MAX_SAFE_INTEGER }));
  assert.throws(() => calculateInterest({ ...input, start_date: "2024-02-30" }));
});

test("calendar payout boundaries", () => {
  for (const [day, frequency, expected] of [["2024-02-29", "daily", "2024-03-01"], ["2024-01-31", "monthly", "2024-02-01"], ["2024-02-29", "quarterly", "2024-04-01"], ["2024-12-31", "yearly", "2025-01-01"]] as const) assert.equal(interestPayoutDate(day, frequency), expected);
});

test("storage defaults disabled; cash projection uses dates, hidden/reverted rows and maintaining audit", () => {
  const account = createAccount(owner, { request_id: "create", name: "TEST interest", kind: "money", currency: "PHP", opening_balance: "100", maintaining_balance: "20" }).account;
  const db = getDb();
  db.prepare("UPDATE finance_accounts SET created_at=? WHERE id=?").run(Date.parse("2024-01-01T00:00:00Z") / 1000, account.id);
  updateAccount(owner, account.id, { request_id: "maintaining", version: 1, maintaining_balance: "30" });
  db.prepare("UPDATE finance_audit SET created_at=? WHERE request_id='maintaining'").run(Date.parse("2024-01-02T16:00:00Z") / 1000);
  const insert = db.prepare("INSERT INTO finance_transactions(id,type,account_id,amount_cents,transaction_date,created_at,updated_at,hidden,reverted) VALUES (?, 'income', ?, ?, ?, 0, 0, ?, ?)");
  insert.run("hidden", account.id, 100, "2024-01-02", 1, 0);
  insert.run("future", account.id, 200, "2024-02-01", 0, 0);
  insert.run("reverted", account.id, 400, "2024-01-02", 0, 1);
  assert.equal(readInterestClosingBalance(account.id, "2023-12-31"), 0);
  assert.equal(readInterestClosingBalance(account.id, "2024-01-02"), 12100);
  assert.equal(readInterestClosingBalance(account.id, "2024-01-03"), 13100);
  assert.equal(getAccount(owner, account.id).balance_cents, 13300);
  assert.equal(db.prepare("SELECT * FROM finance_interest_configurations").all().length, 0);
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
});

test("dated cash includes both transfer legs, fees, refunds, principal, goals and signed adjustments once", () => {
  const db = getDb();
  const id = (db.prepare("SELECT id FROM finance_accounts LIMIT 1").get() as { id: string }).id;
  const other = createAccount(owner, { request_id: "other", name: "TEST other", kind: "money", currency: "PHP", opening_balance: "0" }).account.id;
  const movement = db.prepare("INSERT INTO finance_movements(id,type,account_id,destination_account_id,amount_cents,transaction_date,created_at,updated_at,compared_balance_cents,actual_balance_cents) VALUES (?, ?, ?, ?, ?, '2024-01-04', 0, 0, ?, ?)");
  movement.run("out", "transfer", id, other, 1000, null, null);
  movement.run("in", "transfer", other, id, 300, null, null);
  movement.run("reconcile", "reconciliation", id, null, -50, 0, -50);
  db.prepare("INSERT INTO finance_transactions(id,type,account_id,amount_cents,transaction_date,created_at,updated_at) VALUES ('fee','expense',?,10,'2024-01-04',0,0)").run(id);
  db.prepare("UPDATE finance_movements SET fee_transaction_id='fee' WHERE id='out'").run();
  db.prepare("INSERT INTO finance_refunds(id,expense_id,account_id,amount_cents,transaction_date,created_at,updated_at) VALUES ('refund','fee',?,5,'2024-01-04',0,0)").run(id);
  db.prepare("INSERT INTO finance_obligations(id,kind,name,opening_principal_cents,created_at,updated_at) VALUES ('obligation','debt','TEST debt',0,0,0)").run();
  db.prepare("INSERT INTO finance_obligation_movements(id,obligation_id,type,account_id,amount_cents,transaction_date,created_at,updated_at) VALUES ('borrow','obligation','borrowing',?,200,'2024-01-04',0,0)").run(id);
  db.prepare("INSERT INTO finance_goals(id,name,target_cents,saved_cents,created_at,updated_at) VALUES ('goal','TEST goal',1000,0,0,0)").run();
  const goal = db.prepare("INSERT INTO finance_goal_movements(id,goal_id,type,source_account_id,destination_account_id,amount_cents,created_at) VALUES (?,'goal',?,?,?, ?, ?)");
  const midnight = Date.parse("2024-01-03T16:00:00Z") / 1000;
  goal.run("deposit", "deposit", id, null, 100, midnight);
  goal.run("withdraw", "withdrawal", null, id, 20, midnight);
  assert.equal(readInterestClosingBalance(id, "2024-01-03"), 13100);
  assert.equal(readInterestClosingBalance(id, "2024-01-04"), 12465);
  const config = db.prepare("INSERT INTO finance_interest_configurations(id,account_id,start_date,annual_rate_scaled,tax_scaled,frequency,actor_id,request_id,created_at) VALUES (?,?,'2024-01-01',10000,200000,'monthly','owner','test',0)");
  config.run("config", id);
  assert.throws(() => config.run("duplicate", id));
  const period = db.prepare("INSERT INTO finance_interest_periods(id,account_id,configuration_id,start_date,end_date,payout_date,amount_cents,carry_numerator,processed_at) VALUES (?,?,'config','2024-01-01','2024-02-01','2024-02-01',0,'0',0)");
  period.run("period", id);
  assert.throws(() => period.run("duplicate", id));
  db.prepare("INSERT INTO finance_interest_adjustments(id,period_id,account_id,amount_cents,transaction_date,created_at) VALUES ('adjustment','period',?,-25,'2024-01-05',0)").run(id);
  assert.equal(readInterestClosingBalance(id, "2024-01-04"), 12465);
  assert.equal(readInterestClosingBalance(id, "2024-01-05"), 12440);
  assert.throws(() => db.prepare("INSERT INTO finance_interest_adjustments(id,period_id,account_id,amount_cents,transaction_date,created_at) VALUES ('wrong','period',?,1,'2024-01-05',0)").run(other));
});

test("schema 8 migration preserves holdings and leaves interest disabled", () => {
  const db = getDb();
  const id = (db.prepare("SELECT id FROM finance_accounts WHERE name='TEST interest'").get() as { id: string }).id;
  db.exec("DELETE FROM finance_interest_adjustments; DELETE FROM finance_interest_periods; DELETE FROM finance_interest_configurations");
  const before = getAccount(owner, id);
  db.exec("DELETE FROM finance_interest_adjustments; DELETE FROM finance_interest_periods; DELETE FROM finance_interest_configurations; DROP TABLE finance_interest_adjustments; DROP TABLE finance_interest_periods; DROP TABLE finance_interest_configurations; PRAGMA user_version=8;");
  assert.deepEqual(getAccount(owner, id), before);
  assert.equal(getDb().prepare("SELECT * FROM finance_interest_configurations").all().length, 0);
  assert.equal(getDb().pragma("user_version", { simple: true }), SCHEMA_VERSION);
});

test("configuration cutoff preserves accrued days and full withholding produces no credit", () => {
  const input = { start_date: "2024-01-15", end_date: "2024-01-17", through_date: "2024-02-01", annual_rate: "36.5", withholding_tax: "0", closingBalance: () => 10000 };
  assert.equal(calculateInterest(input).amount_cents, 20);
  assert.equal(interestPayoutDate("2024-01-16", "monthly"), "2024-02-01");
  assert.equal(calculateInterest({ ...input, withholding_tax: "100" }).amount_cents, 0);
  assert.equal(calculateInterest({ ...input, annual_rate: "0" }).amount_cents, 0);
});
