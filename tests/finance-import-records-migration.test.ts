import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { test } from "node:test";

test("existing import records migrate to stable IDs without losing source identity", () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-import-records-migration-"));
  try {
    const legacy = new Database(join(vault, "brain.db"));
    legacy.exec(`
      CREATE TABLE finance_import_migrations (
        id TEXT PRIMARY KEY, source_hash TEXT NOT NULL UNIQUE, proposal_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, result_json TEXT NOT NULL
      );
      CREATE TABLE finance_import_records (
        migration_id TEXT NOT NULL REFERENCES finance_import_migrations(id), collection TEXT NOT NULL,
        source_id TEXT NOT NULL, source_path TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('imported','skipped','excluded')),
        reason TEXT, source_json TEXT NOT NULL, PRIMARY KEY (migration_id, source_path)
      );
      INSERT INTO finance_import_migrations VALUES ('migration-legacy','source-hash','proposal-hash',123,'{}');
      INSERT INTO finance_import_records VALUES ('migration-legacy','expenses','expense-legacy','expenses[0]','imported',NULL,'{"amount":123}');
    `);
    legacy.close();

    const env = { ...process.env, CHIBAKO_DATA_DIR: vault };
    const initialize = `import { getDb } from "./src/lib/db.ts"; getDb().close();`;
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", initialize], { env });
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", initialize], { env });

    const migrated = new Database(join(vault, "brain.db"), { readonly: true });
    try {
      assert.deepEqual(migrated.prepare(`SELECT id,migration_id,collection,source_id,source_path,status,source_json
        FROM finance_import_records`).get(), {
        id: 1, migration_id: "migration-legacy", collection: "expenses", source_id: "expense-legacy",
        source_path: "expenses[0]", status: "imported", source_json: '{"amount":123}',
      });
      const { count } = migrated.prepare("SELECT COUNT(*) AS count FROM finance_import_records").get() as { count: number };
      assert.equal(count, 1);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
