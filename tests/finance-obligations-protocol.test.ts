import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createAccount } from "../src/features/finance/accounts";
import { createObligation, getObligation } from "../src/features/finance/obligations";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { GET as list, POST as create } from "../src/app/api/finance/obligations/route";
import { GET as inspect, PATCH as update } from "../src/app/api/finance/obligations/[id]/route";
import { POST as post } from "../src/app/api/finance/obligations/movements/route";
import { PATCH as correct, DELETE as hide } from "../src/app/api/finance/activity/[id]/route";
import { POST as revert } from "../src/app/api/finance/activity/[id]/revert/route";
import { POST as remote } from "../src/app/mcp/route";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-obligation-protocol-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const context = (id = "") => ({ params: Promise.resolve({ id }) });
const req = (key: string, method: string, path: string, input?: object) => new Request(`https://chibako.test/api/finance/${path}`, { method,
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(input ? { body: JSON.stringify(input) } : {}) });
async function rpc(key: string, method: string, params: object = {}) {
  const response = await remote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  if (method === "tools/list" && body.error?.code === -32601) return { tools: [] };
  if (method === "tools/call" && body.error?.code === -32601) return { isError: true };
  assert.ok(body.result, JSON.stringify(body.error));
  return body.result;
}

test("REST/MCP obligation reads, definitions and actual cash enforce independent scopes", async () => {
  const account = createAccount(owner, { request_id: randomUUID(), name: "Scoped cash", opening_balance: "100", kind: "money", currency: "PHP" }).account;
  const obligation = createObligation(owner, { request_id: randomUUID(), name: "Scoped debt", kind: "debt" }).obligation;
  for (const scopes of [[], ["notes:read"], ["finance:read"], ["finance:manage"], ["finance:write"]]) {
    const { key } = createApiKey(`Obligation scopes ${scopes.join()}`, scopes);
    const read = scopes.includes("finance:read"), manage = scopes.includes("finance:manage"), write = scopes.includes("finance:write");
    assert.equal((await list(req(key, "GET", "obligations"), context())).status, read ? 200 : 403);
    assert.equal((await inspect(req(key, "GET", `obligations/${obligation.id}`), context(obligation.id))).status, read ? 200 : 403);
    assert.equal((await create(req(key, "POST", "obligations", { request_id: randomUUID(), kind: "receivable", name: "Scoped definition" }), context())).status, manage ? 201 : 403);
    assert.equal((await update(req(key, "PATCH", `obligations/${obligation.id}`, { request_id: randomUUID(), version: getObligation(owner, obligation.id).version, due_date: "2027-01-01" }), context(obligation.id))).status, manage ? 200 : 403);
    assert.equal((await post(req(key, "POST", "obligations/movements", { request_id: randomUUID(), type: "borrowing", obligation_id: obligation.id, version: getObligation(owner, obligation.id).version, account_id: account.id, amount: "1", transaction_date: "2026-10-02" }), context())).status, write ? 201 : 403);
    assert.equal((await post(req(key, "POST", "obligations/movements", { request_id: randomUUID(), type: "lending", name: "Scoped lending", account_id: account.id, amount: "1", transaction_date: "2026-10-02" }), context())).status, 403);
    const tools = (await rpc(key, "tools/list")).tools.map((tool: { name: string }) => tool.name);
    assert.equal(tools.includes("list_finance_obligations"), read);
    assert.equal(tools.includes("create_finance_obligation"), manage);
    assert.equal(tools.includes("record_finance_borrowing_lending"), write);
    const denied = await rpc(key, "tools/call", { name: write ? "create_finance_obligation" : "record_finance_borrowing_lending", arguments: {} });
    assert.equal(denied.isError, true);
  }
  assert.equal((await post(req("invalid", "POST", "obligations/movements", {}), context())).status, 401);
});

test("REST/MCP share retries, versions, linked corrections, principal results, dates and audit", async () => {
  const principal = createApiKey("Obligation parity", ["finance:read", "finance:write", "finance:manage"]), key = principal.key;
  const cash = createAccount(owner, { request_id: randomUUID(), name: "Parity cash", opening_balance: "0", kind: "money", currency: "PHP" }).account;
  const definition = { request_id: "definition-parity", kind: "debt", name: "Parity debt", due_date: "2026-10-01" };
  const created = await (await create(req(key, "POST", "obligations", definition), context())).json();
  assert.deepEqual((await rpc(key, "tools/call", { name: "create_finance_obligation", arguments: definition })).structuredContent, created);
  const input = { request_id: "movement-parity", type: "borrowing", obligation_id: created.obligation.id, version: 1, account_id: cash.id, amount: "25.50", transaction_date: "2026-09-30", text: "Explicit private text" };
  const posted = await (await post(req(key, "POST", "obligations/movements", input), context())).json();
  assert.deepEqual((await rpc(key, "tools/call", { name: "record_finance_borrowing_lending", arguments: input })).structuredContent, posted);
  assert.equal(posted.balances[0].balance_cents, 2550); assert.equal(posted.obligation.outstanding_cents, 2550);
  assert.equal(posted.transaction.transaction_date, "2026-09-30"); assert.equal(posted.transaction.text, undefined);
  const readPath = `obligations/${created.obligation.id}?as_of=2026-10-02`;
  const detail = await (await inspect(req(key, "GET", readPath), context(created.obligation.id))).json();
  assert.equal(detail.obligation.overdue, true);
  assert.deepEqual((await rpc(key, "tools/call", { name: "get_finance_obligation", arguments: { id: created.obligation.id, as_of: "2026-10-02" } })).structuredContent, detail);
  const listQuery = { overdue: true, as_of: "2026-10-02", limit: 1, offset: 0 };
  assert.deepEqual((await rpc(key, "tools/call", { name: "list_finance_obligations", arguments: listQuery })).structuredContent,
    await (await list(req(key, "GET", "obligations?overdue=true&as_of=2026-10-02&limit=1&offset=0"), context())).json());
  const patch = { request_id: "correction-parity", version: 1, obligation_version: 2, amount: "30" };
  const corrected = await (await correct(req(key, "PATCH", `activity/${posted.transaction.id}`, patch), context(posted.transaction.id))).json();
  assert.deepEqual((await rpc(key, "tools/call", { name: "correct_finance_activity", arguments: { id: posted.transaction.id, ...patch } })).structuredContent, corrected);
  assert.equal(corrected.obligation.outstanding_cents, 3000); assert.equal(corrected.principal_change_cents, 450);
  assert.equal((await post(req(key, "POST", "obligations/movements", { ...input, request_id: "stale" }), context())).status, 409);
  assert.equal((await post(req(key, "POST", "obligations/movements", { ...input, amount: "26" }), context())).status, 409);
  const action = { request_id: "hide-parity", version: 2, obligation_version: 3 };
  const hidden = await (await hide(req(key, "DELETE", `activity/${posted.transaction.id}`, action), context(posted.transaction.id))).json();
  assert.deepEqual((await rpc(key, "tools/call", { name: "hide_finance_activity", arguments: { id: posted.transaction.id, ...action } })).structuredContent, hidden);
  const undo = { request_id: "revert-parity", version: 3, obligation_version: 4 };
  const undone = await (await revert(req(key, "POST", `activity/${posted.transaction.id}/revert`, undo), context(posted.transaction.id))).json();
  assert.deepEqual((await rpc(key, "tools/call", { name: "revert_finance_activity", arguments: { id: posted.transaction.id, ...undo } })).structuredContent, undone);
  assert.equal(undone.obligation.outstanding_cents, 0); assert.equal(undone.balances[0].balance_cents, 0);
  const audit = getDb().prepare("SELECT actor_id,operation,before_json,after_json,affected_ids,created_at FROM finance_audit WHERE actor_id = ?").all(`api-key:${principal.id}`) as { operation: string; before_json: string; after_json: string; affected_ids: string; created_at: number }[];
  assert.deepEqual(audit.map(row => row.operation), ["obligation.create", "obligation.post", "activity.correct", "activity.hide", "activity.revert"]);
  assert.equal(JSON.parse(audit[2].before_json).obligation.outstanding_cents, 2550);
  assert.equal(JSON.parse(audit[2].after_json).obligation.outstanding_cents, 3000);
  assert.ok(JSON.parse(audit[2].affected_ids).includes(created.obligation.id));
  assert.ok(audit.every(row => row.created_at > 0)); assert.equal(JSON.stringify(audit).includes(key), false);
});
