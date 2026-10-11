import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { test } from "node:test";

test("legacy accounts gain included and ungrouped defaults without losing balances on repeated boots", () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-account-settings-migration-"));
  try {
    const legacy = new Database(join(vault, "brain.db"));
    legacy.exec(`CREATE TABLE finance_accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, currency TEXT NOT NULL,
      opening_balance_cents INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO finance_accounts VALUES ('legacy','Old savings','money','PHP',12345,1,7,100,200);`);
    legacy.close();
    for (let boot = 0; boot < 2; boot++) execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", 'import { getDb } from "./src/lib/db.ts"; getDb().close();'], { env: { ...process.env, CHIBAKO_DATA_DIR: vault } });
    const migrated = new Database(join(vault, "brain.db"), { readonly: true });
    try {
      assert.deepEqual(migrated.prepare("SELECT * FROM finance_accounts").get(), {
        id: "legacy", name: "Old savings", kind: "money", currency: "PHP", opening_balance_cents: 12345,
        archived: 1, version: 7, created_at: 100, updated_at: 200, account_group: "", include_in_summary: 1,
      });
    } finally { migrated.close(); }
  } finally { rmSync(vault, { recursive: true, force: true }); }
});
