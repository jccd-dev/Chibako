import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("API-key authorization hashes keys, parses scopes, and records recognized use", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-api-key-test-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const auth = await import("../src/server/auth/api-key-authorization");
  const { getDb } = await import("../src/lib/db");
  try {
    const created = auth.createApiKey("Agent", ["notes:read", "", "search:read"]);
    const row = getDb().prepare("SELECT key_hash, scopes, last_used_at FROM api_keys WHERE id = ?").get(created.id) as {
      key_hash: string;
      scopes: string;
      last_used_at: number | null;
    };
    assert.equal(row.key_hash, auth.hashApiKey(created.key));
    assert.notEqual(row.key_hash, created.key);
    assert.equal(row.scopes, "notes:read,,search:read");
    assert.equal(row.last_used_at, null);

    const principal = auth.authenticateApiKey(created.key);
    assert.deepEqual(principal, { id: created.id, scopes: ["notes:read", "search:read"] });
    const used = getDb().prepare("SELECT last_used_at FROM api_keys WHERE id = ?").get(created.id) as { last_used_at: number | null };
    assert.equal(typeof used.last_used_at, "number");

    getDb().prepare("UPDATE api_keys SET last_used_at = 0 WHERE id = ?").run(created.id);
    assert.deepEqual(auth.authenticateApiKey(created.key), { id: created.id, scopes: ["notes:read", "search:read"] });
    assert.ok((getDb().prepare("SELECT last_used_at FROM api_keys WHERE id = ?").get(created.id) as { last_used_at: number }).last_used_at > 0);

    assert.equal(auth.authenticateApiKey("not-a-key"), null);
    assert.equal(auth.authenticateApiKey("Bearer "), null);
    assert.equal(auth.hasScope(["notes:read"], "notes:read"), true);
    assert.equal(auth.hasScope(["notes:read"], "notes:write"), false);
    assert.equal(auth.hasScope(["*"], "notes:write"), true);
    assert.equal(auth.hasScope(["notes:write"], "*"), false);
    assert.equal(auth.hasAnyScope(["search:read"], ["notes:read", "search:read"]), true);
    assert.equal(auth.hasAnyScope(["notes:write"], ["notes:read", "search:read"]), false);
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
