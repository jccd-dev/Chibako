import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { createAccount, getAccount } from "../src/features/finance/accounts";
import { POST as create, GET as list } from "../src/app/api/finance/schedules/route";
import { GET as get, PATCH as edit } from "../src/app/api/finance/schedules/[id]/route";
import { POST as pause } from "../src/app/api/finance/schedules/[id]/pause/route";
import { POST as resume } from "../src/app/api/finance/schedules/[id]/resume/route";
import { POST as catchup } from "../src/app/api/finance/plans/catch-up/route";
import { POST as skip } from "../src/app/api/finance/plans/skip/route";
import { GET as plans } from "../src/app/api/finance/plans/route";
import { POST as remote } from "../src/app/mcp/route";

const vault = mkdtempSync(join(tmpdir(), "chibako-recurrence-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
const context = (id = "missing") => ({ params: Promise.resolve({ id }) });
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_plans; DELETE FROM finance_schedules; DELETE FROM finance_transactions; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const request = (key: string, method = "GET", body?: object, query = "") => new Request(`https://chibako.test/api/finance/schedules${query}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function rpc(key: string, name: string, args: object) {
  const response = await remote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
  const envelope = await response.json();
  return envelope.result ?? { isError: true, content: [{ text: envelope.error?.message }] };
}
function fixture() {
  const account = createAccount({ kind: "owner" }, { request_id: randomUUID(), name: "Recurring cash", kind: "money", currency: "PHP", opening_balance: "100" }).account;
  return { request_id: randomUUID(), account_id: account.id, amount: "12", interval_unit: "month", interval_count: 1, start_date: "2026-01-31", end_date: "2026-04-30", text: "Private recurring expense" };
}
test("schedule manage, pending write and read remain independent through REST and remote MCP", async () => {
  const payload = fixture();
  for (const scopes of [[], ["*"], ["notes:read"], ["finance:manage"], ["finance:read"], ["finance:write"]]) {
    const { key } = createApiKey("Recurrence scopes", scopes), read = scopes.includes("finance:read"), write = scopes.includes("finance:write"), manage = scopes.includes("finance:manage");
    assert.equal((await list(request(key), context())).status, read ? 200 : 403);
    assert.equal((await get(request(key), context())).status, read ? 404 : 403);
    assert.equal((await create(request(key, "POST", { ...payload, request_id: randomUUID() }), context())).status, manage ? 201 : 403);
    const scheduleBody = { request_id: randomUUID(), version: 1 };
    for (const [route, body] of [[pause, scheduleBody], [resume, scheduleBody], [edit, { ...scheduleBody, from_plan_id: "missing", from_plan_version: 1, amount: "15" }]] as const)
      assert.equal((await route(request(key, "POST", body), context())).status, manage ? 404 : 403);
    assert.equal((await catchup(request(key, "POST", { request_id: randomUUID(), through_date: "2026-04-30" }), context())).status, write ? 200 : 403);
    assert.equal((await skip(request(key, "POST", { request_id: randomUUID(), plans: [{ id: "missing", version: 1 }] }), context())).status, write ? 404 : 403);
    assert.equal((await rpc(key, "list_finance_schedules", {})).isError === true, !read);
    assert.equal((await rpc(key, "create_finance_schedule", { ...payload, request_id: randomUUID() })).isError === true, !manage);
    assert.equal((await rpc(key, "catch_up_finance_plans", { request_id: randomUUID() })).isError === true, !write);
    for (const name of ["pause_finance_schedule", "resume_finance_schedule", "update_finance_schedule"]) {
      const result = await rpc(key, name, { id: "missing", ...scheduleBody, ...(name === "update_finance_schedule" ? { from_plan_id: "missing", from_plan_version: 1, amount: "15" } : {}) });
      assert.equal(result.isError, true);
      if (manage) assert.match(result.content[0].text, /not_found/);
    }
  }
  assert.equal((await list(request("invalid"), context())).status, 401);
});

test("schedule management, catchup and skipping use shared retry/version/audit contracts across REST and MCP", async () => {
  const payload = fixture(), { key, id: keyId } = createApiKey("Recurrence full", ["finance:read", "finance:write", "finance:manage"]);
  const original = await (await create(request(key, "POST", payload), context())).json();
  assert.deepEqual((await rpc(key, "create_finance_schedule", payload)).structuredContent, original);
  const id = original.schedule.id;
  assert.equal("text" in original.schedule, false);
  const detail = await (await get(request(key, "GET", undefined, "?include_details=true"), context(id))).json();
  assert.equal(detail.schedule.text, payload.text);
  assert.deepEqual((await rpc(key, "get_finance_schedule", { id, include_details: true })).structuredContent, detail);
  const generation = { request_id: randomUUID(), through_date: "2026-04-30" };
  const generated = await (await catchup(request(key, "POST", generation), context())).json();
  assert.equal(generated.created_count, 4);
  assert.deepEqual((await rpc(key, "catch_up_finance_plans", generation)).structuredContent, generated);
  const page = await (await plans(request(key, "GET", undefined, `?schedule_id=${id}`), context())).json();
  assert.equal(page.total, 4);
  const patch = { request_id: randomUUID(), version: 1, from_plan_id: page.plans[2].id, from_plan_version: 1, amount: "20" };
  const changed = await (await edit(request(key, "PATCH", patch), context(id))).json();
  assert.deepEqual((await rpc(key, "update_finance_schedule", { id, ...patch })).structuredContent, changed);
  assert.equal((await edit(request(key, "PATCH", { ...patch, request_id: randomUUID() }), context(id))).status, 409);
  const pausedBody = { request_id: randomUUID(), version: changed.schedule.version };
  const paused = await (await pause(request(key, "POST", pausedBody), context(id))).json();
  assert.deepEqual((await rpc(key, "pause_finance_schedule", { id, ...pausedBody })).structuredContent, paused);
  const resumedBody = { request_id: randomUUID(), version: paused.schedule.version };
  const resumed = await (await resume(request(key, "POST", resumedBody), context(id))).json();
  assert.deepEqual((await rpc(key, "resume_finance_schedule", { id, ...resumedBody })).structuredContent, resumed);
  const pending = await (await plans(request(key, "GET", undefined, `?schedule_id=${id}`), context())).json();
  const skipping = { request_id: randomUUID(), plans: pending.plans.map((plan: { id: string; version: number }) => ({ id: plan.id, version: plan.version })) };
  const skipped = await (await skip(request(key, "POST", skipping), context())).json();
  assert.equal(skipped.plans.length, 4);
  assert.deepEqual((await rpc(key, "skip_finance_plans", skipping)).structuredContent, skipped);
  assert.equal(getAccount({ kind: "owner" }, payload.account_id).balance_cents, 10000);
  const compact = await (await list(request(key), context())).json();
  assert.deepEqual((await rpc(key, "list_finance_schedules", {})).structuredContent, compact);
  for (const query of ["?limit=101", "?include_details=yes", "?paused=yes", "?unknown=true"]) assert.equal((await list(request(key, "GET", undefined, query), context())).status, 400);
  const audits = getDb().prepare<[], { actor_id: string; before_json: string; after_json: string }>("SELECT * FROM finance_audit WHERE operation LIKE 'schedule.%' OR operation IN ('plan.catch_up','plan.bulk_skip')").all();
  assert.equal(audits.length, 6); assert.ok(audits.every(row => row.actor_id === `api-key:${keyId}`));
  assert.equal(JSON.stringify(audits).includes(key), false);
});
