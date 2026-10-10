import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { createMcpServer } from "../src/mcp/create-server";
import { GET as listImports } from "../src/app/api/finance/import/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-import-read-"));
process.env.CHIBAKO_DATA_DIR = vault;
const context = { params: Promise.resolve({}) };

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM finance_import_records; DELETE FROM finance_import_migrations;");
  db.prepare("INSERT INTO finance_import_migrations (id,source_hash,proposal_hash,created_at,result_json) VALUES (?,?,?,?,?)")
    .run("migration-read-test", "a".repeat(64), "b".repeat(64), 123, JSON.stringify({ counts: { imported: 1, skipped: 2, conflicts: 0, excluded: 3 }, records: [{ text: "PRIVATE_RESULT" }] }));
  db.prepare("INSERT INTO finance_import_records (migration_id,collection,source_id,source_path,status,reason,source_json) VALUES (?,?,?,?,?,?,?)")
    .run("migration-read-test", "expenses", "secret-expense", "expenses[0]", "imported", null, JSON.stringify({ note: "PRIVATE_SOURCE" }));
});

after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

function request(key: string, query = "") {
  return new Request(`https://chibako.test/api/finance/import${query}`, { headers: { authorization: `Bearer ${key}` } });
}

async function callMcp(scopes: string[], name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ exposure: "remote", scopes, financeActor: { kind: "api-key", id: "import-reader", scopes } });
  const client = new Client({ name: "finance-import-read-test", version: "1" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    if (name === "tools/list") return await client.listTools();
    return await client.callTool({ name, arguments: args });
  } finally { await client.close(); await server.close(); }
}

test("finance:read exposes compact import summaries by default and private details only on request", async () => {
  const reader = createApiKey("Import reader", ["finance:read"]);
  const compact = await (await listImports(request(reader.key), context)).json();
  assert.deepEqual(compact.migrations, [{ migration_id: "migration-read-test", created_at: 123, counts: { imported: 1, skipped: 2, conflicts: 0, excluded: 3 } }]);
  assert.equal(JSON.stringify(compact).includes("PRIVATE"), false);

  const detailed = await (await listImports(request(reader.key, "?include_details=true"), context)).json();
  assert.equal(JSON.stringify(detailed).includes("PRIVATE_RESULT"), true);
  assert.equal(JSON.stringify(detailed).includes("PRIVATE_SOURCE"), true);
  assert.equal((await listImports(request(createApiKey("Manager only", ["finance:manage"]).key), context)).status, 403);
});

test("MCP exposes the same compact reader to finance:read and never exposes commit or restoration tools", async () => {
  const listed = await callMcp(["finance:read"], "tools/list") as { tools: { name: string }[] };
  const names = listed.tools.map(tool => tool.name);
  assert.ok(names.includes("list_finance_imports"));
  assert.equal(names.some(name => /import.*(?:commit|restore)|(?:commit|restore).*import/i.test(name)), false);
  const result = await callMcp(["finance:read"], "list_finance_imports") as { structuredContent: { migrations: { counts: { imported: number } }[] } };
  assert.equal(result.structuredContent.migrations[0].counts.imported, 1);
  assert.equal(JSON.stringify(result.structuredContent).includes("PRIVATE"), false);
  const details = await callMcp(["finance:read"], "list_finance_imports", { include_details: true }) as { structuredContent: unknown };
  assert.equal(JSON.stringify(details.structuredContent).includes("PRIVATE_SOURCE"), true);
  const managerOnly = await callMcp(["finance:manage"], "tools/list") as { tools: { name: string }[] };
  assert.equal(managerOnly.tools.some(tool => tool.name === "list_finance_imports"), false);
});
