import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getDb } from "../../src/lib/db";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { createMcpServer } from "../../src/mcp/create-server";
import { GET as list, POST as create } from "../../src/app/api/finance/accounts/route";
import { PATCH as update } from "../../src/app/api/finance/accounts/[id]/route";
import { GET as summary } from "../../src/app/api/finance/summary/route";
import { POST as remote } from "../../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
const context = { params: Promise.resolve({}) };
const opening = { request_id: "create-1", name: "Cash", kind: "money", currency: "PHP", opening_balance: "123.45" };

beforeEach(() => getDb().transaction(() => {
  getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_accounts;");
})());
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

function rest(key: string, body?: object) {
  return new Request("https://chibako.test/api/finance/accounts", {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function rpc(key: string, method: string, params: object = {}) {
  const response = await remote(new Request("https://chibako.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  assert.equal(response.status, 200);
  return response.json();
}

test("keyed REST enforces independent scopes and never trusts invalid credentials", async () => {
  for (const scopes of [[], ["*"], ["notes:read"], ["finance:write"], ["finance:read"], ["finance:manage"]]) {
    const { key } = createApiKey(`Scopes ${scopes.join()}`, scopes);
    assert.equal((await list(rest(key), context)).status, scopes.includes("finance:read") ? 200 : 403);
    assert.equal((await summary(rest(key), context)).status, scopes.includes("finance:read") ? 200 : 403);
    assert.equal((await create(rest(key, opening), context)).status, scopes.includes("finance:manage") ? 201 : 403);
    if (!scopes.includes("finance:manage")) assert.equal((await update(rest(key, { request_id: "edit", version: 1, name: "Changed" }), { params: Promise.resolve({ id: "account" }) })).status, 403);
  }
  for (const key of ["invalid", ""]) assert.equal((await create(rest(key, opening), context)).status, 401);
  for (const authorization of ["Basic invalid", "Bearer", "Bearer invalid extra"]) {
    const request = rest("invalid", opening);
    request.headers.set("authorization", authorization);
    assert.equal((await create(request, context)).status, 401);
  }
  const { key } = createApiKey("Manager", ["finance:manage"]);
  const bad = await create(rest(key, { ...opening, currency: "USD" }), context);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "invalid_input");
});

test("REST and request-scoped remote MCP share results, retries, edits, and attribution", async () => {
  const principal = createApiKey("Full finance", ["finance:read", "finance:manage"]);
  const created = await (await create(rest(principal.key, opening), context)).json();
  const retry = await rpc(principal.key, "tools/call", { name: "create_finance_account", arguments: opening });
  assert.deepEqual(retry.result.structuredContent, created);
  const renamed = await (await update(rest(principal.key, { request_id: "rename-1", version: 1, name: "Wallet" }), {
    params: Promise.resolve({ id: created.account.id }),
  })).json();
  assert.equal(renamed.account.version, 2);
  const original = await rpc(principal.key, "tools/call", { name: "create_finance_account", arguments: opening });
  assert.deepEqual(original.result.structuredContent, created);
  const conflict = await rpc(principal.key, "tools/call", { name: "create_finance_account", arguments: { ...opening, name: "Different" } });
  assert.equal(conflict.result.isError, true);
  assert.match(conflict.result.content[0].text, /request_conflict/);
  const mcpSummary = await rpc(principal.key, "tools/call", { name: "get_finance_summary", arguments: {} });
  assert.deepEqual(mcpSummary.result.structuredContent, await (await summary(rest(principal.key), context)).json());
  assert.equal(mcpSummary.result.content[0].text, JSON.stringify(mcpSummary.result.structuredContent));
  assert.equal(mcpSummary.result.structuredContent.money.balance_cents, 12345);
  assert.equal(getDb().prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM finance_audit WHERE actor_id = ?").get(`api-key:${principal.id}`)?.count, 2);
  const manager = createApiKey("Manage only", ["finance:manage"]);
  const reader = createApiKey("Read only", ["finance:read"]);
  for (const [key, expected] of [[manager.key, ["create_finance_account", "update_finance_account", "create_finance_classification", "update_finance_classification", "set_finance_budget", "create_finance_schedule", "update_finance_schedule", "pause_finance_schedule", "resume_finance_schedule", "create_finance_goal", "update_finance_goal", "delete_finance_goal", "create_finance_obligation", "update_finance_obligation", "close_finance_obligation", "delete_finance_obligation"]], [reader.key, ["get_finance_account", "get_finance_summary", "get_finance_overview", "get_finance_attention", "list_finance_accounts", "list_finance_activity", "get_finance_transaction", "get_finance_activity_totals", "list_finance_classifications", "get_finance_report", "get_finance_budget", "list_finance_plans", "get_finance_plan", "list_finance_schedules", "get_finance_schedule", "list_finance_goals", "get_finance_goal", "list_finance_goal_accounts", "list_finance_obligations", "get_finance_obligation", "get_finance_obligation_history"]]] as const) {
    const catalog = await rpc(key, "tools/list");
    assert.deepEqual(catalog.result.tools.map((tool: { name: string }) => tool.name).filter((name: string) => name.includes("finance")).sort(), [...expected].sort());
  }
  for (const scopes of [["finance:manage", "finance:write"], ["finance:manage", "finance:write", "finance:read"]]) {
    const { key } = createApiKey("Goal money access", scopes);
    const names = (await rpc(key, "tools/list")).result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(names.includes("set_finance_goal_allocation"));
    assert.ok(names.includes("move_finance_goal_money"));
  }
  for (const key of [manager.key, createApiKey("Write only", ["finance:write"]).key]) {
    const names = (await rpc(key, "tools/list")).result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(!names.includes("set_finance_goal_allocation"));
    assert.ok(!names.includes("move_finance_goal_money"));
  }
  const forbidden = await rpc(reader.key, "tools/call", { name: "create_finance_account", arguments: opening });
  assert.equal(forbidden.result.isError, true);
});

test("REST and MCP persist account settings and agree on summary exclusion", async () => {
  const principal = createApiKey("Account settings", ["finance:read", "finance:manage"]);
  const created = await (await create(rest(principal.key, { ...opening, account_group: "Savings", include_in_summary: false }), context)).json();
  assert.equal(created.account.account_group, "Savings");
  assert.equal(created.account.include_in_summary, false);
  const restSummary = await (await summary(rest(principal.key), context)).json();
  assert.deepEqual(restSummary.money, { balance_cents: 0, account_count: 0 });
  const mcpSummary = await rpc(principal.key, "tools/call", { name: "get_finance_summary", arguments: {} });
  assert.deepEqual(mcpSummary.result.structuredContent, restSummary);
  const patched = await rpc(principal.key, "tools/call", { name: "update_finance_account", arguments: { id: created.account.id, request_id: "include-settings", version: 1, account_group: "Emergency", include_in_summary: true } });
  assert.equal(patched.result.isError, undefined);
  const listed = await (await list(rest(principal.key), context)).json();
  assert.equal(listed.accounts[0].account_group, "Emergency");
  assert.equal(listed.accounts[0].include_in_summary, true);
  assert.equal((await (await summary(rest(principal.key), context)).json()).money.balance_cents, 12345);
  const reader = createApiKey("Read settings", ["finance:read"]);
  const denied = await rpc(reader.key, "tools/call", { name: "update_finance_account", arguments: { id: created.account.id, request_id: "denied-settings", version: 2, include_in_summary: false } });
  assert.ok(denied.error || denied.result?.isError);
  assert.equal((await (await list(rest(principal.key), context)).json()).accounts[0].include_in_summary, true);
});

test("REST and MCP create and update nonzero maintaining balances with the same account contract", async () => {
  const principal = createApiKey("Maintaining balances", ["finance:read", "finance:manage"]);
  const restCreated = await (await create(rest(principal.key, { ...opening, request_id: "rest-maintaining", opening_balance: "8000", maintaining_balance: "2000" }), context)).json();
  const mcpCreated = await rpc(principal.key, "tools/call", { name: "create_finance_account", arguments: { ...opening, request_id: "mcp-maintaining", opening_balance: "1000", maintaining_balance: "250" } });
  assert.equal(mcpCreated.result.isError, undefined);

  const restUpdated = await update(new Request(`https://chibako.test/api/finance/accounts/${restCreated.account.id}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${principal.key}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: "rest-maintaining-edit", version: 1, maintaining_balance: "3000" }),
  }), { params: Promise.resolve({ id: restCreated.account.id }) });
  assert.equal(restUpdated.status, 200);
  const mcpUpdated = await rpc(principal.key, "tools/call", { name: "update_finance_account", arguments: {
    id: mcpCreated.result.structuredContent.account.id, request_id: "mcp-maintaining-edit", version: 1, maintaining_balance: "350",
  } });
  assert.equal(mcpUpdated.result.isError, undefined);

  const restAccount = (await (await list(rest(principal.key), context)).json()).accounts.find((account: { id: string }) => account.id === restCreated.account.id);
  assert.equal(restAccount.maintaining_balance_cents, 300000);
  assert.equal(restAccount.balance_cents, 1100000);
  assert.equal(restAccount.spendable_cents, 800000);
  assert.equal(mcpUpdated.result.structuredContent.account.maintaining_balance_cents, 35000);
  assert.equal(mcpUpdated.result.structuredContent.account.balance_cents, 135000);
  assert.equal(mcpUpdated.result.structuredContent.account.spendable_cents, 100000);
});

test("MCP local trust stays local and keyed catalogs cannot widen finance scopes", async () => {
  for (const options of [
    { exposure: "local" as const, scopes: null },
    { exposure: "remote" as const, scopes: null },
    { exposure: "local" as const, scopes: ["*"], financeActor: { kind: "api-key" as const, id: "legacy", scopes: ["finance:read", "finance:manage"] } },
  ]) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(options);
    const client = new Client({ name: "finance-test", version: "1" });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      if (options.exposure === "remote" && options.scopes === null) {
        await assert.rejects(client.listTools(), /Method not found/);
        continue;
      }
      const names = (await client.listTools()).tools.map(tool => tool.name);
      assert.equal(names.includes("create_finance_account"), options.exposure === "local" && options.scopes === null);
      assert.equal(names.includes("get_finance_summary"), options.exposure === "local" && options.scopes === null);
      if (options.scopes === null && options.exposure === "local") {
        const result = await client.callTool({ name: "create_finance_account", arguments: opening });
        assert.equal(result.isError, undefined);
        assert.equal(getDb().prepare<[], { actor_id: string }>("SELECT actor_id FROM finance_audit").get()?.actor_id, "trusted-local-mcp");
      }
    } finally { await client.close(); await server.close(); }
  }
});
