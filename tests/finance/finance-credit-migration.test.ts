import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { after, test } from "node:test";
import { getDb, SCHEMA_VERSION, SchemaTooNewError } from "../../src/lib/db";
import { createNote } from "../../src/lib/notes";
import { createAccount, getAccount } from "../../src/features/finance/accounts";
import { postTransaction } from "../../src/features/finance/activity";
import { postTransfer } from "../../src/features/finance/movements";
import { createGoal, getGoal, setGoalAllocation } from "../../src/features/finance/goals";
import type { FinanceActor } from "../../src/features/finance/types";

// Test decision: add, integration — the schema 4 accounts rebuild runs on real vaults during update.
const vault = mkdtempSync(join(tmpdir(), "chibako-credit-migration-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

// The accounts table exactly as schema 3 shipped it.
const V3_ACCOUNTS = `CREATE TABLE finance_accounts_v3 (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('money', 'asset')),
  currency TEXT NOT NULL CHECK (currency = 'PHP'),
  opening_balance_cents INTEGER NOT NULL CHECK (typeof(opening_balance_cents) = 'integer' AND opening_balance_cents BETWEEN -9007199254740991 AND 9007199254740991),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  maintaining_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (typeof(maintaining_balance_cents) = 'integer' AND maintaining_balance_cents BETWEEN 0 AND 9007199254740991),
  account_group TEXT NOT NULL DEFAULT '', include_in_summary INTEGER NOT NULL DEFAULT 1 CHECK (include_in_summary IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`;
const V3_COLUMNS = "id, name, kind, currency, opening_balance_cents, archived, maintaining_balance_cents, account_group, include_in_summary, version, created_at, updated_at";

function snapshot(db: Database.Database) {
  return {
    accounts: db.prepare(`SELECT ${V3_COLUMNS} FROM finance_accounts ORDER BY id`).all(),
    transactions: db.prepare("SELECT * FROM finance_transactions ORDER BY id").all(),
    movements: db.prepare("SELECT * FROM finance_movements ORDER BY id").all(),
    links: db.prepare("SELECT * FROM finance_note_links ORDER BY activity_id, note_id").all(),
  };
}

test("a schema 3 vault upgrades to 4 with accounts, activity and links intact", () => {
  const account = (name: string, kind: string, extra: object = {}) =>
    createAccount(owner, { request_id: randomUUID(), name, kind, currency: "PHP", opening_balance: "100", ...extra }).account;
  const cash = account("Cash", "money", { maintaining_balance: "10" });
  const bank = account("Bank", "money", { account_group: "Banks" });
  const house = account("House", "asset", { include_in_summary: false });
  const note = createNote({ title: randomUUID(), content: "Receipt" });
  postTransaction(owner, { request_id: randomUUID(), type: "expense", account_id: cash.id, amount: "20", transaction_date: "2026-10-01", note_ids: [note.id] });
  postTransfer(owner, { request_id: randomUUID(), source_account_id: cash.id, destination_account_id: bank.id, amount: "5", transaction_date: "2026-10-02" });
  const balances = [cash, bank, house].map(row => getAccount(owner, row.id).balance_cents);
  const before = snapshot(getDb());
  assert.equal(before.links.length, 1);
  getDb().close();

  const file = join(vault, "brain.db");
  const legacy = new Database(file);
  legacy.exec(`PRAGMA foreign_keys = OFF; BEGIN; ${V3_ACCOUNTS};
    INSERT INTO finance_accounts_v3 SELECT ${V3_COLUMNS} FROM finance_accounts;
    DROP TABLE finance_accounts; ALTER TABLE finance_accounts_v3 RENAME TO finance_accounts;
    CREATE INDEX idx_finance_accounts_list ON finance_accounts (archived, created_at, id);
    COMMIT; PRAGMA user_version = 3;`);
  legacy.close();

  for (let boot = 0; boot < 2; boot++) {
    const db = getDb();
    assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
    assert.deepEqual(snapshot(db), before);
    assert.deepEqual(db.prepare("SELECT DISTINCT credit_limit_cents, statement_day, due_mode, due_value FROM finance_accounts").all(),
      [{ credit_limit_cents: null, statement_day: null, due_mode: null, due_value: null }]);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.ok((db.prepare("PRAGMA foreign_key_list(finance_transactions)").all() as { table: string }[]).every(key => key.table !== "finance_accounts_v4"));
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_finance_accounts_list'").get());
    assert.deepEqual([cash, bank, house].map(row => getAccount(owner, row.id).balance_cents), balances);
    db.close();
  }

  const card = createAccount(owner, { request_id: randomUUID(), name: "Card", kind: "credit", currency: "PHP", opening_balance: "0", credit_limit: "1000" }).account;
  assert.equal(card.credit_limit_cents, 100000);
  assert.throws(() => getDb().prepare("UPDATE finance_accounts SET credit_limit_cents = 5 WHERE id = ?").run(cash.id), /CHECK constraint failed/);
});

test("a vault stamped newer than schema 6 is still refused", () => {
  const newer = mkdtempSync(join(tmpdir(), "chibako-credit-migration-newer-"));
  const previous = process.env.CHIBAKO_DATA_DIR;
  try {
    const seed = new Database(join(newer, "brain.db"));
    seed.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    seed.close();
    process.env.CHIBAKO_DATA_DIR = newer;
    assert.throws(() => getDb(), SchemaTooNewError);
  } finally {
    process.env.CHIBAKO_DATA_DIR = previous;
    rmSync(newer, { recursive: true, force: true });
  }
});

test("schema 6 drops linked goals' contribution rows without changing balances", () => {
  const account = (name: string) => createAccount(owner, { request_id: randomUUID(), name, kind: "money", currency: "PHP", opening_balance: "50" }).account;
  const linkedAccount = account("Linked"), source = account("Source");
  const linked = createGoal(owner, { request_id: randomUUID(), name: "Linked", target: "100", linked_account_id: linkedAccount.id }).goal;
  const held = createGoal(owner, { request_id: randomUUID(), name: "Held", target: "100" }).goal;
  setGoalAllocation(owner, held.id, { request_id: randomUUID(), version: held.version, account_id: source.id, amount: "10" });
  // Schema 5 kept a contribution row on linked goals.
  getDb().prepare("INSERT INTO finance_goal_allocations (goal_id, account_id, amount_cents) VALUES (?,?,?)").run(linked.id, linkedAccount.id, 5000);
  const balances = [linkedAccount, source].map(row => getAccount(owner, row.id).balance_cents);
  getDb().pragma("user_version = 5");
  getDb().close();
  const db = getDb();
  assert.deepEqual(db.prepare("SELECT goal_id, amount_cents FROM finance_goal_allocations").all(), [{ goal_id: held.id, amount_cents: 1000 }]);
  assert.deepEqual([linkedAccount, source].map(row => getAccount(owner, row.id).balance_cents), balances);
  assert.equal(getGoal(owner, linked.id).saved_cents, 5000);
});
