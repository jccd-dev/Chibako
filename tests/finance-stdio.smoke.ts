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
const writer = createApiKey("Write only", ["finance:write"]);
let postedAccountId = "";
let linkedTransactionId = "";
let linkedNoteId = "";
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
    for (const name of ["correct_finance_activity", "hide_finance_activity", "revert_finance_activity", "record_finance_refund"]) assert.ok(names.includes(name));
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
    postedAccountId = original.account.id;
    const payload = { request_id: "stdio-post", account_id: postedAccountId, amount: "1.01", transaction_date: "2026-10-03", text: "Private receipt" };
    const posted = await client.callTool({ name: "post_finance_transaction", arguments: payload });
    assert.equal(posted.isError, undefined);
    assert.equal((posted.structuredContent as { balance_cents: number }).balance_cents, 12244);
    assert.deepEqual((await client.callTool({ name: "post_finance_transaction", arguments: payload })).structuredContent, posted.structuredContent);
    const history = await client.callTool({ name: "list_finance_activity", arguments: {} });
    const compact = (history.structuredContent as { transactions: object[] }).transactions[0];
    assert.equal("text" in compact, false);
    linkedTransactionId = (compact as { id: string }).id;
    const noteResult = await client.callTool({ name: "create_note", arguments: { title: "Synthetic finance link", content: "Note must stay unchanged" } });
    assert.equal(noteResult.isError, undefined);
    linkedNoteId = (noteResult.structuredContent as { id: string }).id;
    const attach = { id: linkedTransactionId, request_id: "stdio-link", version: 1, note_ids: [linkedNoteId] };
    const linked = await client.callTool({ name: "set_finance_note_links", arguments: attach });
    assert.equal(linked.isError, undefined);
    assert.deepEqual((await client.callTool({ name: "set_finance_note_links", arguments: attach })).structuredContent, linked.structuredContent);
    assert.deepEqual((await client.callTool({ name: "get_finance_note_links", arguments: { id: linkedTransactionId } })).structuredContent, { id: linkedTransactionId, version: 2, notes: [{ id: linkedNoteId, title: "Synthetic finance link" }] });
    const detailed = await client.callTool({ name: "list_finance_activity", arguments: { include_details: true } });
    assert.equal((detailed.structuredContent as { transactions: { text: string }[] }).transactions[0].text, "Private receipt");
    assert.equal(getDb().prepare<[], { actor_id: string }>("SELECT actor_id FROM finance_audit LIMIT 1").get()?.actor_id, "trusted-local-mcp");
    const destination = await client.callTool({ name: "create_finance_account", arguments: { ...opening, request_id: "stdio-destination", name: "Bank", opening_balance: "0" } });
    const destinationId = (destination.structuredContent as { account: FinanceAccount }).account.id;
    const movement = { request_id: "stdio-transfer", source_account_id: postedAccountId, destination_account_id: destinationId, amount: "1.01", transaction_date: "2026-10-03" };
    const moved = await client.callTool({ name: "post_finance_transfer", arguments: movement });
    assert.equal(moved.isError, undefined);
    assert.deepEqual((moved.structuredContent as { balances: object[] }).balances, [{ account_id: postedAccountId, balance_cents: 12143 }, { account_id: destinationId, balance_cents: 101 }]);
    assert.deepEqual((await client.callTool({ name: "post_finance_transfer", arguments: movement })).structuredContent, moved.structuredContent);
    assert.equal((await client.callTool({ name: "reconcile_finance_account", arguments: { request_id: "stdio-reconcile", account_id: postedAccountId, actual_balance: "121.43", expected_balance_cents: 12143, transaction_date: "2026-10-03" } })).isError, undefined);
    const asset = await client.callTool({ name: "create_finance_account", arguments: { ...opening, request_id: "stdio-asset", name: "Asset", kind: "asset", opening_balance: "0" } });
    assert.equal((await client.callTool({ name: "value_finance_asset", arguments: { request_id: "stdio-value", account_id: (asset.structuredContent as { account: FinanceAccount }).account.id, actual_balance: "5", expected_balance_cents: 0, transaction_date: "2026-10-03" } })).isError, undefined);
  });
  await connect(manager.key, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes("create_finance_account"));
    assert.ok(!names.includes("get_finance_summary"));
    assert.equal((await client.callTool({ name: "create_finance_account", arguments: opening })).isError, undefined);
  });
  await connect(writer.key, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes("post_finance_transaction"));
    assert.ok(names.includes("post_finance_transfer"));
    assert.ok(names.includes("reconcile_finance_account"));
    assert.ok(names.includes("value_finance_asset"));
    for (const name of ["correct_finance_activity", "hide_finance_activity", "revert_finance_activity", "record_finance_refund"]) assert.ok(names.includes(name));
    assert.ok(!names.includes("list_finance_activity"));
    assert.ok(!names.includes("set_finance_note_links"));
    assert.equal((await client.callTool({ name: "post_finance_transaction", arguments: { request_id: "denied-note-link", account_id: postedAccountId, amount: "1", transaction_date: "2026-10-04", note_ids: [linkedNoteId] } })).isError, true);
    assert.ok(!names.includes("create_finance_classification"));
    assert.equal((await client.callTool({ name: "post_finance_transaction", arguments: { request_id: "keyed-post", account_id: postedAccountId, amount: "0.01", type: "income", transaction_date: "2026-10-04" } })).isError, undefined);
  });
  await connect(reader.key, async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(names.includes("get_finance_summary"));
    assert.ok(!names.includes("create_finance_account"));
    assert.ok(!names.includes("get_finance_note_links"));
    assert.equal((await client.callTool({ name: "get_finance_note_links", arguments: { id: linkedTransactionId } })).isError, true);
    const detail = await client.callTool({ name: "get_finance_transaction", arguments: { id: linkedTransactionId, include_details: true } });
    assert.equal(JSON.stringify(detail.structuredContent).includes("Synthetic finance link"), false);
    for (const name of ["correct_finance_activity", "hide_finance_activity", "revert_finance_activity", "record_finance_refund"]) assert.ok(!names.includes(name));
    const result = await client.callTool({ name: "get_finance_summary", arguments: {} });
    assert.equal((result.structuredContent as { money: { balance_cents: number } }).money.balance_cents, 24590);
  });
  for (const key of ["", "invalid"]) await connect(key, async client => {
    assert.equal(client.getServerCapabilities()?.tools, undefined);
    await assert.rejects(client.listTools(), /Method not found/);
  });
  console.log("PASS finance stdio: trusted, independent read/write/manage, invalid/empty key, exact cents, post/retry, compact/details, archive/restore");
} finally { getDb().close(); rmSync(vault, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
