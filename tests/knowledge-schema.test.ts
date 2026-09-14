import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("knowledge schema reads the canonical fallback and preserves stored values", async () => {
  const vault = mkdtempSync(join(tmpdir(), "chibako-schema-test-"));
  process.env.CHIBAKO_DATA_DIR = vault;
  const schema = await import("../src/features/schema/knowledge-schema");
  const { getDb } = await import("../src/lib/db");
  try {
    assert.match(schema.getKnowledgeSchema(), /^# Chibako Vault Schema \(AGENTS\.md\)/);
    assert.equal(schema.getKnowledgeSchema(), schema.DEFAULT_KNOWLEDGE_SCHEMA);

    schema.setKnowledgeSchema("# Custom\nUse [[links]].");
    assert.equal(schema.getKnowledgeSchema(), "# Custom\nUse [[links]].");

    schema.setKnowledgeSchema("");
    assert.equal(schema.getKnowledgeSchema(), "", "an explicitly empty schema is still configured");

    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'knowledge_schema'").get() as { value: string };
    assert.equal(row.value, "");
  } finally {
    getDb().close();
    rmSync(vault, { recursive: true, force: true });
  }
});
