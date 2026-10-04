import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { createAccount, getAccount } from "../src/features/finance/accounts";
import { POST as create, GET as list } from "../src/app/api/finance/plans/route";
import { GET as get, PATCH as edit, DELETE as cancel } from "../src/app/api/finance/plans/[id]/route";
import { POST as post } from "../src/app/api/finance/plans/[id]/post/route";
import { POST as match } from "../src/app/api/finance/plans/[id]/match/route";
import { POST as remote } from "../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-planning-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
const context = (id = "missing") => ({ params: Promise.resolve({ id }) });
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_plans; DELETE FROM finance_transactions; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const request = (key: string, method = "GET", body?: object, query = "") => new Request(`https://chibako.test/api/finance/plans${query}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function rpc(key: string, name: string, args: object) {
  const response = await remote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
  const envelope = await response.json();
  return envelope.result ?? { isError: true, content: [{ text: envelope.error?.message }] };
}
function fixture() {
  const account = createAccount({ kind: "owner" }, { request_id: randomUUID(), name: "Plans", kind: "money", currency: "PHP", opening_balance: "100" }).account;
  return { request_id: randomUUID(), account_id: account.id, amount: "12", due_date: "2026-10-04", text: "Private expected expense" };
}
test("planning REST/MCP read and write permissions are independent of manage and legacy scopes", async () => {
  const payload = fixture();
  for (const scopes of [[], ["*"], ["notes:read"], ["finance:manage"], ["finance:read"], ["finance:write"]]) {
    const { key } = createApiKey("Scope check", scopes), read = scopes.includes("finance:read"), write = scopes.includes("finance:write");
    assert.equal((await list(request(key), context())).status, read ? 200 : 403);
    assert.equal((await get(request(key), context())).status, read ? 404 : 403);
    assert.equal((await create(request(key, "POST", { ...payload, request_id: randomUUID() }), context())).status, write ? 201 : 403);
    for (const [route, body] of [[edit, { request_id: randomUUID(), version: 1, due_date: "2026-11-01" }], [cancel, { request_id: randomUUID(), version: 1 }], [post, { request_id: randomUUID(), version: 1, account_id: payload.account_id, amount: "1", transaction_date: "2026-10-04" }], [match, { request_id: randomUUID(), version: 1, transaction_id: "missing", transaction_version: 1 }]] as const) {
      assert.equal((await route(request(key, "POST", body), context())).status, write ? 404 : 403);
    }
    assert.equal((await rpc(key, "list_finance_plans", {})).isError === true, !read);
    assert.equal((await rpc(key, "create_finance_plan", { ...payload, request_id: randomUUID() })).isError === true, !write);
    for (const name of ["update_finance_plan", "cancel_finance_plan", "post_finance_plan", "match_finance_plan"]) {
      const names = await rpc(key, name, { id: "missing", request_id: randomUUID(), version: 1, ...(name === "update_finance_plan" ? { due_date: "2026-11-01" } : name === "post_finance_plan" ? { account_id: payload.account_id, amount: "1", transaction_date: "2026-10-04" } : name === "match_finance_plan" ? { transaction_id: "missing", transaction_version: 1 } : {}) });
      assert.equal(names.isError, true);
      if (write) assert.match(names.content[0].text, /not_found/);
    }
  }
  assert.equal((await list(request("invalid"), context())).status, 401);
});
test("planning retries, stale versions and compact/detail results are identical through REST and remote MCP", async () => {
  const payload = fixture(), { key, id: keyId } = createApiKey("Full finance", ["finance:read", "finance:write"]);
  const original = await (await create(request(key, "POST", payload), context())).json();
  assert.deepEqual((await rpc(key, "create_finance_plan", payload)).structuredContent, original);
  const id = original.plan.id;
  const detail = await (await get(request(key, "GET", undefined, "?include_details=true"), context(id))).json();
  assert.equal(detail.plan.text, payload.text);
  assert.deepEqual((await rpc(key, "get_finance_plan", { id, include_details: true })).structuredContent, detail);
  assert.equal("text" in original.plan, false);
  const patch = { request_id: randomUUID(), version: 1, due_date: "2026-10-10" };
  const updated = await (await edit(request(key, "PATCH", patch), context(id))).json();
  assert.deepEqual((await rpc(key, "update_finance_plan", { id, ...patch })).structuredContent, updated);
  assert.equal((await edit(request(key, "PATCH", { ...patch, request_id: randomUUID() }), context(id))).status, 409);
  const actual = { request_id: randomUUID(), version: updated.plan.version, amount: "8", account_id: payload.account_id, transaction_date: "2026-11-01" };
  const posted = await (await post(request(key, "POST", actual), context(id))).json();
  assert.deepEqual((await rpc(key, "post_finance_plan", { id, ...actual })).structuredContent, posted);
  assert.equal(getAccount({ kind: "owner" }, payload.account_id).balance_cents, 9200);
  const compact = await (await list(request(key, "GET", undefined, "?status=all&limit=1"), context())).json();
  assert.deepEqual((await rpc(key, "list_finance_plans", { status: "all", limit: 1 })).structuredContent, compact);
  for (const query of ["?limit=101", "?include_details=yes", "?date_from=2026-02-30", "?unknown=true"]) assert.equal((await list(request(key, "GET", undefined, query), context())).status, 400);
  assert.equal((await create(request(key, "POST", { ...payload, amount: "13" }), context())).status, 409);
  const audits = getDb().prepare<[], { actor_id: string; affected_ids: string; before_json: string; after_json: string }>("SELECT * FROM finance_audit WHERE operation LIKE 'plan.%'").all();
  assert.equal(audits.length, 3);
  assert.ok(audits.every(row => row.actor_id === `api-key:${keyId}` && JSON.parse(row.affected_ids).includes(id)));
  assert.equal(JSON.stringify(audits).includes(key), false);
});
