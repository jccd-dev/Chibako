import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { createAccount } from "../src/features/finance/accounts";
import { POST as transfer } from "../src/app/api/finance/activity/transfers/route";
import { POST as reconcile } from "../src/app/api/finance/activity/reconciliations/route";
import { POST as value } from "../src/app/api/finance/activity/valuations/route";
import { GET as history } from "../src/app/api/finance/activity/route";
import { POST as remote } from "../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-movements-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const context = { params: Promise.resolve({}) };
function request(key: string, path: string, body?: object) {
  return new Request(`https://chibako.test/api/finance/${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function rpc(key: string, name: string, args: object) {
  const response = await remote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
  assert.equal(response.status, 200);
  const envelope = await response.json();
  return envelope.result ?? { isError: true };
}
test("REST and MCP share movement retries and enforce independent write/read scopes", async () => {
  const owner = { kind: "owner" } as const;
  const create = (name: string, kind = "money") => createAccount(owner, { request_id: name, name, kind, currency: "PHP", opening_balance: "100" }).account;
  const source = create("Source"), destination = create("Destination"), asset = create("Asset", "asset");
  for (const scopes of [[], ["*"], ["notes:write"], ["finance:read"], ["finance:manage"], ["finance:write"]]) {
    const { key, id } = createApiKey(scopes.join(), scopes);
    const permitted = scopes.includes("finance:write");
    const routes = [
      { handler: transfer, path: "transfers", tool: "post_finance_transfer", payload: { request_id: "transfer", source_account_id: source.id, destination_account_id: destination.id, amount: "1.01", transaction_date: "2026-10-03", text: "Private context" } },
      { handler: reconcile, path: "reconciliations", tool: "reconcile_finance_account", payload: { request_id: "reconcile", account_id: source.id, actual_balance: "99", expected_balance_cents: 9899, transaction_date: "2026-10-02" } },
      { handler: value, path: "valuations", tool: "value_finance_asset", payload: { request_id: "value", account_id: asset.id, actual_balance: "101", expected_balance_cents: 10000, transaction_date: "2026-10-01" } },
    ];
    for (const operation of routes) {
      const response = await operation.handler(request(key, `activity/${operation.path}`, operation.payload), context);
      assert.equal(response.status, permitted ? 201 : 403);
      const remoteResult = await rpc(key, operation.tool, operation.payload);
      assert.equal(remoteResult.isError === true, !permitted);
      if (permitted) {
        const result = await response.json();
        assert.deepEqual(remoteResult.structuredContent, result);
        assert.equal("text" in result.transaction, false);
        assert.equal((await operation.handler(request(key, `activity/${operation.path}`, { ...operation.payload, currency: "USD" }), context)).status, 400);
        assert.equal((await rpc(key, operation.tool, { ...operation.payload, transaction_date: "2026-02-30" })).isError, true);
        assert.equal((await operation.handler(request(key, `activity/${operation.path}`, { ...operation.payload, transaction_date: "2026-10-04" }), context)).status, 409);
      }
    }
    assert.equal((await history(request(key, "activity?type=transfer"), context)).status, scopes.includes("finance:read") ? 200 : 403);
    assert.equal((await rpc(key, "list_finance_activity", { type: "valuation" })).isError === true, !scopes.includes("finance:read"));
    if (permitted) {
      const audits = getDb().prepare("SELECT actor_id, affected_ids FROM finance_audit WHERE actor_id = ?").all(`api-key:${id}`) as { actor_id: string; affected_ids: string }[];
      assert.equal(audits.length, 3);
      assert.ok(audits.every(row => !JSON.stringify(row).includes(key)));
    }
  }
  const { key } = createApiKey("Read", ["finance:read"]);
  const result = await (await history(request(key, `activity?type=transfer&account_id=${destination.id}`), context)).json();
  assert.deepEqual((await rpc(key, "list_finance_activity", { type: "transfer", account_id: destination.id })).structuredContent, result);
  assert.equal(result.total, 1);
  assert.equal((await transfer(request("invalid", "activity/transfers", {}), context)).status, 401);
});
