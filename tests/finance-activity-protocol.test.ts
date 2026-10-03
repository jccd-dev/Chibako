import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { createAccount } from "../src/features/finance/accounts";
import { POST as post, GET as history } from "../src/app/api/finance/activity/route";
import { GET as inspect } from "../src/app/api/finance/activity/[id]/route";
import { GET as totals } from "../src/app/api/finance/activity/totals/route";
import { POST as classify, GET as classifications } from "../src/app/api/finance/classifications/route";
import { PATCH as rename } from "../src/app/api/finance/classifications/[id]/route";
import { POST as remote } from "../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-activity-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
const context = { params: Promise.resolve({}) };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_transactions; DELETE FROM finance_classifications; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
function rest(key: string, path: string, body?: object) {
  return new Request(`https://chibako.test/api/finance/${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function rpc(key: string, name: string, args: object) {
  const response = await remote(new Request("https://chibako.test/mcp", {
    method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  assert.equal(response.status, 200);
  const envelope = await response.json();
  return envelope.result ?? { isError: true, content: [{ type: "text", text: envelope.error?.message }] };
}
function fixture() {
  const account = createAccount({ kind: "owner" }, { request_id: "account", name: "Cash", kind: "money", currency: "PHP", opening_balance: "10.00" }).account;
  return { request_id: "post", account_id: account.id, amount: "12.01", transaction_date: "2026-10-03", text: "Private transaction details" };
}

test("REST and remote MCP independently enforce read, write and manage with compact defaults", async () => {
  const payload = fixture();
  for (const scopes of [[], ["*"], ["notes:read"], ["finance:read"], ["finance:write"], ["finance:manage"]]) {
    const { key } = createApiKey(scopes.join(), scopes);
    assert.equal((await history(rest(key, "activity"), context)).status, scopes.includes("finance:read") ? 200 : 403);
    assert.equal((await totals(rest(key, "activity/totals"), context)).status, scopes.includes("finance:read") ? 200 : 403);
    assert.equal((await classifications(rest(key, "classifications"), context)).status, scopes.includes("finance:read") ? 200 : 403);
    assert.equal((await post(rest(key, "activity", payload), context)).status, scopes.includes("finance:write") ? 201 : 403);
    assert.equal((await classify(rest(key, "classifications", { request_id: "tag", kind: "tag", name: "Travel" }), context)).status, scopes.includes("finance:manage") ? 201 : 403);
    assert.equal((await rename(rest(key, "classifications/id", { request_id: "rename", version: 1, name: "Other" }), { params: Promise.resolve({ id: "missing" }) })).status, scopes.includes("finance:manage") ? 404 : 403);
    assert.equal((await rpc(key, "post_finance_transaction", payload)).isError === true, !scopes.includes("finance:write"));
    assert.equal((await rpc(key, "list_finance_activity", {})).isError === true, !scopes.includes("finance:read"));
    assert.equal((await rpc(key, "create_finance_classification", { request_id: "tag", kind: "tag", name: "Travel" })).isError === true, !scopes.includes("finance:manage"));
  }
  assert.equal((await post(rest("invalid", "activity", payload), context)).status, 401);
});

test("REST and MCP share post retries, classification versions, details, bounded filters and month results", async () => {
  const payload = fixture();
  const { key, id } = createApiKey("Full finance", ["finance:read", "finance:write", "finance:manage"]);
  const posted = await (await post(rest(key, "activity", payload), context)).json();
  assert.equal(posted.balance_cents, -201);
  assert.deepEqual(posted.warnings, ["negative_balance"]);
  assert.equal("text" in posted.transaction, false);
  assert.deepEqual((await rpc(key, "post_finance_transaction", payload)).structuredContent, posted);
  const conflict = await rpc(key, "post_finance_transaction", { ...payload, amount: "1" });
  assert.equal(conflict.isError, true);
  assert.match(conflict.content[0].text, /request_conflict/);
  const tagPayload = { request_id: "tag", kind: "tag", name: "Receipt" };
  const tag = await (await classify(rest(key, "classifications", tagPayload), context)).json();
  assert.deepEqual((await rpc(key, "create_finance_classification", tagPayload)).structuredContent, tag);
  const patch = { request_id: "rename", version: 1, name: "Receipts" };
  const renamed = await (await rename(rest(key, "classifications/id", patch), { params: Promise.resolve({ id: tag.classification.id }) })).json();
  assert.deepEqual((await rpc(key, "update_finance_classification", { id: tag.classification.id, ...patch })).structuredContent, renamed);
  const query = { q: "Private", type: "expense", date_from: "2026-10-01", date_to: "2026-10-31", limit: 1, account_id: payload.account_id };
  const compact = await (await history(rest(key, "activity?" + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))), context)).json();
  assert.equal(compact.total, 1);
  assert.equal("text" in compact.transactions[0], false);
  assert.deepEqual((await rpc(key, "list_finance_activity", query)).structuredContent, compact);
  const detail = await (await inspect(rest(key, "activity/id?include_details=true"), { params: Promise.resolve({ id: posted.transaction.id }) })).json();
  assert.equal(detail.transaction.text, payload.text);
  assert.deepEqual((await rpc(key, "get_finance_transaction", { id: posted.transaction.id, include_details: true })).structuredContent, detail);
  assert.deepEqual((await rpc(key, "get_finance_activity_totals", { month: "2026-10" })).structuredContent, await (await totals(rest(key, "activity/totals?month=2026-10"), context)).json());
  for (const query of ["limit=101", "include_details=yes", "offset=-1", "date_from=2026-02-30", "unknown=true"]) assert.equal((await history(rest(key, "activity?" + query), context)).status, 400);
  const audits = getDb().prepare<[], { actor_id: string }>("SELECT * FROM finance_audit WHERE operation != 'account.create'").all();
  assert.equal(audits.length, 3);
  assert.ok(audits.every(row => row.actor_id === `api-key:${id}`));
  assert.equal(JSON.stringify(audits).includes(key), false);
});
