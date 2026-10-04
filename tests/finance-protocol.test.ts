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
import { GET as list, POST as create } from "../src/app/api/finance/accounts/route";
import { PATCH as update } from "../src/app/api/finance/accounts/[id]/route";
import { GET as summary } from "../src/app/api/finance/summary/route";
import { POST as remote } from "../src/app/mcp/route";

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
  assert.equal(mcpSummary.result.structuredContent.money.balance_cents, 12345);
  assert.equal(getDb().prepare<[string], { count: number }>("SELECT COUNT(*) AS count FROM finance_audit WHERE actor_id = ?").get(`api-key:${principal.id}`)?.count, 2);
  const manager = createApiKey("Manage only", ["finance:manage"]);
  const reader = createApiKey("Read only", ["finance:read"]);
  for (const [key, expected] of [[manager.key, ["create_finance_account", "update_finance_account", "create_finance_classification", "update_finance_classification", "set_finance_budget", "create_finance_schedule", "update_finance_schedule", "pause_finance_schedule", "resume_finance_schedule"]], [reader.key, ["get_finance_account", "get_finance_summary", "list_finance_accounts", "list_finance_activity", "get_finance_transaction", "get_finance_activity_totals", "list_finance_classifications", "get_finance_report", "get_finance_budget", "list_finance_plans", "get_finance_plan", "list_finance_schedules", "get_finance_schedule"]]] as const) {
    const catalog = await rpc(key, "tools/list");
    assert.deepEqual(catalog.result.tools.map((tool: { name: string }) => tool.name).filter((name: string) => name.includes("finance")).sort(), [...expected].sort());
  }
  const forbidden = await rpc(reader.key, "tools/call", { name: "create_finance_account", arguments: opening });
  assert.equal(forbidden.result.isError, true);
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
