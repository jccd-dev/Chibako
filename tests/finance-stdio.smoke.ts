import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import type { FinanceAccount } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-stdio-"));
process.env.CHIBAKO_DATA_DIR = vault;
const manager = createApiKey("Manage only", ["finance:manage"]);
const reader = createApiKey("Read only", ["finance:read"]);
const opening = { request_id: "stdio-create", name: "Cash", kind: "money", currency: "PHP", opening_balance: "123.45" };

async function connect(configuredKey: string | undefined, check: (client: Client) => Promise<void>) {
  const env: Record<string, string> = { ...getDefaultEnvironment(), CHIBAKO_DATA_DIR: vault };
  delete env.CHIBAKO_API_KEY;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist/mcp/server.mjs")],
    env: { ...env, ...(configuredKey === undefined ? {} : { CHIBAKO_API_KEY: configuredKey }) },
    stderr: "pipe",
  });
  const client = new Client({ name: "finance-stdio-test", version: "1" });
  try { await client.connect(transport); await check(client); }
  finally { await client.close(); }
}

async function main() {
try {
  await connect(undefined, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes("list_notes"));
    assert.ok(names.includes("create_finance_account"));
    assert.ok(names.includes("get_finance_summary"));
    const result = await client.callTool({ name: "create_finance_account", arguments: opening });
    assert.equal(result.isError, undefined);
    const original = result.structuredContent as { account: FinanceAccount };
    assert.equal(original.account.balance_cents, 12345);
    for (const [version, archived] of [[1, true], [2, false]] as const) {
      const edited = await client.callTool({ name: "update_finance_account", arguments: { id: original.account.id, request_id: "edit-" + version, version, name: "Wallet", archived } });
      assert.equal(edited.isError, undefined);
      const account = (edited.structuredContent as { account: FinanceAccount }).account;
      assert.equal(account.balance_cents, 12345);
      assert.equal(account.archived, archived);
    }
    assert.deepEqual((await client.callTool({ name: "create_finance_account", arguments: opening })).structuredContent, original);
    assert.equal(getDb().prepare<[], { actor_id: string }>("SELECT actor_id FROM finance_audit LIMIT 1").get()?.actor_id, "trusted-local-mcp");
  });
  await connect(manager.key, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes("create_finance_account"));
    assert.ok(!names.includes("get_finance_summary"));
    assert.equal((await client.callTool({ name: "create_finance_account", arguments: opening })).isError, undefined);
  });
  await connect(reader.key, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes("get_finance_summary"));
    assert.ok(!names.includes("create_finance_account"));
    const result = await client.callTool({ name: "get_finance_summary", arguments: {} });
    assert.equal((result.structuredContent as { money: { balance_cents: number } }).money.balance_cents, 24690);
  });
  for (const key of ["", "invalid"]) await connect(key, async client => {
    assert.equal(client.getServerCapabilities()?.tools, undefined);
    await assert.rejects(client.listTools(), /Method not found/);
  });
  console.log("PASS finance stdio: trusted, scoped, invalid/empty key, exact cents, retry, archive/restore");
} finally { getDb().close(); rmSync(vault, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
