import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { createAccount, getAccount } from "../src/features/finance/accounts";
import { getTransaction, postTransaction } from "../src/features/finance/activity";
import { PATCH as correct, DELETE as hide } from "../src/app/api/finance/activity/[id]/route";
import { POST as refund } from "../src/app/api/finance/activity/[id]/refund/route";
import { POST as revert } from "../src/app/api/finance/activity/[id]/revert/route";
import { GET as history } from "../src/app/api/finance/activity/route";
import { POST as remote } from "../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-corrections-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_refunds; DELETE FROM finance_movements; DELETE FROM finance_transactions; DELETE FROM finance_classifications; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
function rest(key: string, method: string, body?: object, query = "") {
  return new Request(`https://chibako.test/api/finance/activity/id${query}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function rpc(key: string, name: string, args: object) {
  const response = await remote(new Request("https://chibako.test/mcp", {
    method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  assert.equal(response.status, 200);
  const envelope = await response.json();
  return envelope.result ?? { isError: true, content: [{ text: envelope.error?.message }] };
}
function fixture() {
  const account = createAccount({ kind: "owner" }, { request_id: "account", name: "Cash", kind: "money", currency: "PHP", opening_balance: "100" }).account;
  const transaction = postTransaction({ kind: "owner" }, { request_id: "post", account_id: account.id, amount: "20", transaction_date: "2026-09-30", text: "Private receipt" }).transaction;
  return { account, transaction, context: { params: Promise.resolve({ id: transaction.id }) } };
}

test("new correction operations require finance:write, never implicitly grant read or manage, and reject invalid authentication", async () => {
  const { account, transaction, context } = fixture();
  const cases = [
    { route: correct, method: "PATCH", tool: "correct_finance_activity", body: { request_id: "correct", version: 1, amount: "19" } },
    { route: hide, method: "DELETE", tool: "hide_finance_activity", body: { request_id: "hide", version: 1 } },
    { route: revert, method: "POST", tool: "revert_finance_activity", body: { request_id: "revert", version: 1 } },
    { route: refund, method: "POST", tool: "record_finance_refund", body: { request_id: "refund", version: 1, account_id: account.id, amount: "1", transaction_date: "2026-10-01" } },
  ];
  for (const scopes of [[], ["*"], ["notes:read"], ["finance:read"], ["finance:manage"]]) {
    const { key } = createApiKey(scopes.join(), scopes);
    for (const item of cases) {
      assert.equal((await item.route(rest(key, item.method, item.body), context)).status, 403);
      assert.equal((await rpc(key, item.tool, { id: transaction.id, ...item.body })).isError, true);
    }
  }
  const writer = createApiKey("Write only", ["finance:write"]);
  assert.equal((await history(rest(writer.key, "GET"), { params: Promise.resolve({}) })).status, 403);
  assert.equal((await rpc(writer.key, "list_finance_activity", {})).isError, true);
  assert.equal((await correct(rest(writer.key, "PATCH", cases[0].body), context)).status, 200);
  assert.equal((await rpc(writer.key, cases[0].tool, { id: transaction.id, ...cases[0].body })).isError, undefined);
  assert.equal((await hide(rest("invalid", "DELETE", { request_id: "invalid", version: 2 }), context)).status, 401);
});

test("REST/remote MCP corrections, refunds, hiding and reversion have identical retry/error contracts and keyed audits", async () => {
  const { account, transaction, context } = fixture();
  const { key, id } = createApiKey("Finance", ["finance:write", "finance:read"]);
  async function parity(route: typeof correct, method: string, tool: string, target: string, body: object) {
    const response = await route(rest(key, method, body), { params: Promise.resolve({ id: target }) });
    assert.ok(response.ok);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.deepEqual((await rpc(key, tool, { id: target, ...body })).structuredContent, result);
    assert.equal("text" in result.transaction, false);
    return result;
  }
  const noop = { request_id: "noop", version: 1 };
  assert.equal((await correct(rest(key, "PATCH", noop), context)).status, 400);
  assert.equal((await rpc(key, "correct_finance_activity", { id: transaction.id, ...noop })).isError, true);
  assert.equal(getTransaction({ kind: "owner" }, transaction.id).version, 1);
  assert.equal(getDb().prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM finance_audit WHERE request_id = 'noop'").get()?.total, 0);
  const corrected = await parity(correct, "PATCH", "correct_finance_activity", transaction.id, { request_id: "correct", version: 1, amount: "30" });
  const refundBody = { request_id: "refund", version: corrected.transaction.version, account_id: account.id, amount: "10", transaction_date: "2026-10-01" };
  const refunded = await parity(refund, "POST", "record_finance_refund", transaction.id, refundBody);
  assert.equal(refunded.balances[0].balance_cents, 8000);
  const conflict = await rpc(key, "record_finance_refund", { id: transaction.id, ...refundBody, amount: "11" });
  assert.equal(conflict.isError, true);
  assert.match(conflict.content[0].text, /request_conflict/);
  const staleBody = { request_id: "stale", version: 1, text: "stale" };
  assert.equal((await correct(rest(key, "PATCH", staleBody), context)).status, 409);
  assert.match((await rpc(key, "correct_finance_activity", { id: transaction.id, ...staleBody })).content[0].text, /version_conflict/);
  const hidden = await parity(hide, "DELETE", "hide_finance_activity", refunded.transaction.id, { request_id: "hide", version: 1 });
  const filtered = await (await history(rest(key, "GET", undefined, "?hidden=true&type=refund"), context)).json();
  assert.equal(filtered.total, 1);
  assert.deepEqual((await rpc(key, "list_finance_activity", { hidden: "true", type: "refund" })).structuredContent, filtered);
  await parity(revert, "POST", "revert_finance_activity", refunded.transaction.id, { request_id: "revert-refund", version: hidden.transaction.version });
  const current = getTransaction({ kind: "owner" }, transaction.id);
  const reverted = await parity(revert, "POST", "revert_finance_activity", transaction.id, { request_id: "revert-expense", version: current.version });
  assert.equal(getAccount({ kind: "owner" }, account.id).balance_cents, 10000);
  const second = { request_id: "second-revert", version: reverted.transaction.version };
  assert.equal((await revert(rest(key, "POST", second), context)).status, 409);
  assert.match((await rpc(key, "revert_finance_activity", { id: transaction.id, ...second })).content[0].text, /already_reverted/);
  const audits = getDb().prepare("SELECT * FROM finance_audit WHERE operation LIKE 'activity.%'").all() as { actor_id: string }[];
  assert.equal(audits.length, 5);
  assert.ok(audits.every(audit => audit.actor_id === `api-key:${id}`));
  assert.equal(JSON.stringify(audits).includes(key), false);
});
