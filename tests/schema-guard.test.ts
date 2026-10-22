import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Test decision: add, integration — a downgrade or maintenance bypass would silently corrupt or lose user data.

test("a vault from a newer schema is refused before any write", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-schema-guard-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const file = join(vault, "brain.db");
  const seed = new Database(file);
  seed.exec("CREATE TABLE future_only (id INTEGER); PRAGMA user_version = 99");
  seed.close();
  const before = createHash("sha256").update(readFileSync(file)).digest("hex");
  const { getDb, checkDatabase, SchemaTooNewError } = await import("../src/lib/db");
  try {
    assert.throws(() => getDb(), SchemaTooNewError);
    assert.throws(() => checkDatabase(), SchemaTooNewError);
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), before, "database bytes untouched");
    assert.deepEqual(readdirSync(vault), ["brain.db"], "no WAL/SHM created and no tables migrated");
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("a fresh vault is stamped, and the maintenance marker fences everything but health", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-maintenance-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const { getDb, checkDatabase, maintenanceMarkerPath, MaintenanceError, SCHEMA_VERSION } = await import("../src/lib/db");
  try {
    const db = getDb();
    assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);

    writeFileSync(maintenanceMarkerPath(), "operation");
    assert.throws(() => getDb(), MaintenanceError, "a long-lived writer is fenced even with the connection already open");
    assert.doesNotThrow(() => checkDatabase(), "health still reaches the database so migrations can validate the new image");

    rmSync(maintenanceMarkerPath());
    assert.doesNotThrow(() => getDb().prepare("SELECT 1").get());
    assert.ok(!existsSync(maintenanceMarkerPath()));
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test("a long-lived process picks up a replaced or newer database even if it never saw the maintenance marker", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-generation-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const { getDb, SchemaTooNewError } = await import("../src/lib/db");
  try {
    const first = getDb();
    first.prepare("INSERT INTO folders(path) VALUES ('before-restore')").run();
    assert.equal(getDb(), first, "unchanged database keeps its connection");

    // A restore: a different database file renamed over brain.db while this process was idle.
    const restored = join(vault, "restored.db");
    const seed = new Database(restored);
    seed.exec("CREATE TABLE marker_only (id INTEGER); PRAGMA user_version = 0");
    seed.close();
    for (const name of ["brain.db-wal", "brain.db-shm"]) rmSync(join(vault, name), { force: true });
    renameSync(restored, join(vault, "brain.db"));
    const second = getDb();
    assert.notEqual(second, first, "the stale handle is not reused");
    assert.equal(first.open, false);
    assert.ok(second.prepare("SELECT 1 FROM sqlite_master WHERE name = 'notes'").get(), "the restored file was validated and migrated");
    assert.equal(second.prepare("SELECT 1 FROM folders WHERE path = 'before-restore'").get(), undefined);

    // A newer release migrated the same file in place.
    const other = new Database(join(vault, "brain.db"));
    other.pragma("user_version = 99");
    other.close();
    assert.throws(() => getDb(), SchemaTooNewError, "schema is verified before the cached handle is reused");
    assert.equal(second.open, false, "a handle on a newer schema is dropped");
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
