import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("database health probe completes for an initialized vault", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-health-test-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const { checkDatabase, getDb } = await import("../src/lib/db");
  try {
    assert.doesNotThrow(() => checkDatabase());
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
