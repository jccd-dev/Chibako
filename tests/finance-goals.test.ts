import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { createAccount, getAccount, getFinanceSummary, updateAccount } from "../src/features/finance/accounts";
import { createGoal, getGoal, listGoals, listGoalAccounts, setGoalAllocation, updateGoal } from "../src/features/finance/goals";
import { getActivityTotals, postTransaction } from "../src/features/finance/activity";
import { postTransfer, reconcileAccount } from "../src/features/finance/movements";
import { correctActivity, revertActivity } from "../src/features/finance/corrections";
import { createPlan, postPlan } from "../src/features/finance/planning";
import { GET as list, POST as create } from "../src/app/api/finance/goals/route";
import { GET as inspect, PATCH as update } from "../src/app/api/finance/goals/[id]/route";
import { PUT as allocate } from "../src/app/api/finance/goals/[id]/allocations/route";
import { GET as accounts } from "../src/app/api/finance/goals/accounts/route";
import { POST as remote } from "../src/app/mcp/route";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-goals-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_goal_allocations; DELETE FROM finance_goals; DELETE FROM finance_plans; DELETE FROM finance_movements; DELETE FROM finance_transactions; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const action = (version = 1) => ({ request_id: randomUUID(), version });
const account = (balance = "100", kind = "money") => createAccount(owner, { request_id: randomUUID(), name: "Goal test cash", kind, currency: "PHP", opening_balance: balance }).account;
const goal = (target = "100") => createGoal(owner, { request_id: randomUUID(), name: "Goal test", target }).goal;
const reserve = (id: string, account_id: string, amount: string) => setGoalAllocation(owner, id, { ...action(getGoal(owner, id).version), account_id, amount });
const expense = (account_id: string, amount: string) => postTransaction(owner, { request_id: randomUUID(), account_id, amount, type: "expense", transaction_date: "2026-10-06" });

test("cross-account reservations never reuse money or move cash; release and archive retain achievement history", () => {
  const a = account(), b = account("50"), first = goal(), second = goal();
  const totals = getFinanceSummary(owner), activity = getActivityTotals(owner, { month: "2026-10" });
  const request = { ...action(), account_id: a.id, amount: "60.25" };
  const result = setGoalAllocation(owner, first.id, request);
  assert.deepEqual(setGoalAllocation(owner, first.id, request), result);
  assert.throws(() => setGoalAllocation(owner, first.id, { ...request, amount: "61" }), { code: "request_conflict" });
  assert.throws(() => setGoalAllocation(owner, first.id, { ...request, request_id: randomUUID() }), { code: "version_conflict" });
  assert.throws(() => reserve(second.id, a.id, "40"), { code: "allocation_limit" });
  reserve(second.id, a.id, "39.75");
  const achieved = reserve(first.id, b.id, "39.75").goal;
  assert.equal(achieved.saved_cents, 10000); assert.equal(achieved.achieved, true); assert.equal(achieved.allocations.length, 2);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === a.id)?.available_cents, 0);
  assert.deepEqual(getFinanceSummary(owner), totals); assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), activity);
  const released = reserve(first.id, a.id, "0").goal;
  assert.equal(released.saved_cents, 3975); assert.equal(released.achieved, false);
  reserve(first.id, a.id, "60.25");
  const archive = { ...action(getGoal(owner, first.id).version), archived: true };
  const archived = updateGoal(owner, first.id, archive).goal;
  assert.equal(archived.achieved, true); assert.equal(archived.saved_cents, 10000); assert.equal(archived.allocations.length, 2);
  assert.deepEqual(updateGoal(owner, first.id, archive).goal, archived);
  assert.equal(listGoals(owner).total, 1); assert.equal(listGoals(owner, { archived: "true" }).total, 1);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === a.id)?.reserved_cents, 3975);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === b.id)?.reserved_cents, 0);
  assert.throws(() => reserve(first.id, a.id, "1"), { code: "goal_archived" });
  assert.throws(() => updateGoal(owner, first.id, { ...action(archived.version), archived: false }), { code: "goal_archived" });
  assert.deepEqual(getFinanceSummary(owner), totals);
});

test("spending, transfers, corrections, reconciliation and posted plans warn without blocking; releases work under shortfall", () => {
  const a = account(), b = account("0"), g = goal(); reserve(g.id, a.id, "80");
  const posted = expense(a.id, "30");
  assert.deepEqual(posted.warnings, ["allocation_shortfall"]);
  assert.deepEqual(posted.allocation_shortfalls, [{ account_id: a.id, balance_cents: 7000, reserved_cents: 8000, shortfall_cents: 1000 }]);
  assert.equal(getGoal(owner, g.id).allocations[0].shortfall_cents, 1000);
  assert.throws(() => reserve(g.id, a.id, "81"), { code: "allocation_limit" });
  assert.equal(reserve(g.id, a.id, "75").account.shortfall_cents, 500);
  revertActivity(owner, posted.transaction.id, action());
  assert.equal(getGoal(owner, g.id).allocations[0].shortfall_cents, 0);
  const transfer = postTransfer(owner, { request_id: randomUUID(), source_account_id: a.id, destination_account_id: b.id, amount: "30", transaction_date: "2026-10-06" });
  assert.equal(transfer.allocation_shortfalls?.[0].shortfall_cents, 500);
  revertActivity(owner, transfer.transaction.id, action());
  const edit = expense(a.id, "10");
  const corrected = correctActivity(owner, edit.transaction.id, { ...action(), amount: "40" });
  assert.equal(corrected.allocation_shortfalls?.[0].shortfall_cents, 1500);
  revertActivity(owner, edit.transaction.id, action(corrected.transaction.version));
  const reconciled = reconcileAccount(owner, { request_id: randomUUID(), account_id: a.id, expected_balance_cents: 10000, actual_balance: "65", transaction_date: "2026-10-06" });
  assert.equal(reconciled.allocation_shortfalls?.[0].shortfall_cents, 1000);
  revertActivity(owner, reconciled.transaction.id, action());
  const plan = createPlan(owner, { request_id: randomUUID(), account_id: a.id, amount: "30", due_date: "2026-10-06" }).plan;
  assert.equal(postPlan(owner, plan.id, { ...action(), account_id: a.id, amount: "30", transaction_date: "2026-10-06" }).allocation_shortfalls?.[0].shortfall_cents, 500);
  updateAccount(owner, a.id, { ...action(), archived: true });
  assert.equal(reserve(g.id, a.id, "0").goal.saved_cents, 0);
  assert.throws(() => reserve(g.id, a.id, "1"), { code: "invalid_account" });
});

test("invalid money/accounts and aggregate overflow reject atomically at the exact-cent boundaries", () => {
  const a = account("90071992547409.91"), b = account("1"), asset = account("10", "asset"), g = goal();
  assert.throws(() => reserve(g.id, asset.id, "1"), { code: "invalid_account" });
  assert.throws(() => reserve(g.id, "missing", "1"), { code: "not_found" });
  for (const amount of ["-1", "01", "0.001", "90071992547409.92"]) assert.throws(() => reserve(g.id, a.id, amount));
  assert.throws(() => createGoal(owner, { request_id: randomUUID(), name: "X", target: "0" }), { code: "invalid_input" });
  assert.throws(() => createGoal(owner, { request_id: randomUUID(), name: "X", target: "10", saved: "1" }), { code: "invalid_input" });
  reserve(g.id, a.id, "90071992547409.91");
  const before = getGoal(owner, g.id);
  assert.throws(() => reserve(g.id, b.id, "0.01"), { code: "amount_out_of_range" });
  assert.deepEqual(getGoal(owner, g.id), before);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === b.id)?.reserved_cents, 0);
  assert.equal(expense(a.id, "90071992547409.91").balance_cents, 0);
  const below = expense(a.id, "0.01");
  assert.deepEqual(below.warnings, ["negative_balance", "allocation_shortfall"]);
  assert.equal(below.allocation_shortfalls?.[0].shortfall_cents, Number.MAX_SAFE_INTEGER);
  assert.equal(getAccount(owner, a.id).balance_cents, -1);
});

const context = { params: Promise.resolve({}) };
const goalContext = (id: string) => ({ params: Promise.resolve({ id }) });
function rest(key: string, method: string, path: string, body?: object) {
  return new Request(`https://chibako.test${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function rpc(key: string, method: string, params: object = {}) {
  const response = await remote(new Request("https://chibako.test/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  if (method === "tools/list" && body.error?.code === -32601) return { result: { tools: [] } };
  assert.ok(body.result, JSON.stringify(body.error));
  return body;
}

test("REST/MCP enforce independent scopes and share retries, stale versions, pagination and audit results", async () => {
  const a = account(), g = goal();
  for (const scopes of [[], ["notes:read"], ["finance:write"], ["finance:read"], ["finance:manage"]]) {
    const { key } = createApiKey(`Goal scopes ${scopes.join()}`, scopes);
    const canRead = scopes.includes("finance:read"), canManage = scopes.includes("finance:manage");
    assert.equal((await list(rest(key, "GET", "/api/finance/goals"), context)).status, canRead ? 200 : 403);
    assert.equal((await inspect(rest(key, "GET", `/api/finance/goals/${g.id}`), goalContext(g.id))).status, canRead ? 200 : 403);
    assert.equal((await accounts(rest(key, "GET", "/api/finance/goals/accounts"), context)).status, canRead ? 200 : 403);
    assert.equal((await create(rest(key, "POST", "/api/finance/goals", { request_id: randomUUID(), name: "Scoped", target: "10" }), context)).status, canManage ? 201 : 403);
    assert.equal((await allocate(rest(key, "PUT", `/api/finance/goals/${g.id}/allocations`, { ...action(getGoal(owner, g.id).version), account_id: a.id, amount: "1" }), goalContext(g.id))).status, canManage ? 200 : 403);
    assert.equal((await update(rest(key, "PATCH", `/api/finance/goals/${g.id}`, { ...action(getGoal(owner, g.id).version), name: "Scoped goal" }), goalContext(g.id))).status, canManage ? 200 : 403);
    const tools = (await rpc(key, "tools/list")).result.tools.map((row: { name: string }) => row.name);
    assert.equal(tools.includes("list_finance_goals"), canRead); assert.equal(tools.includes("set_finance_goal_allocation"), canManage);
  }
  assert.equal((await allocate(rest("invalid", "PUT", `/api/finance/goals/${g.id}/allocations`, {}), goalContext(g.id))).status, 401);
  const principal = createApiKey("Goal parity", ["finance:read", "finance:manage"]);
  const input = { request_id: "goal-parity-create", name: "Parity", target: "15" };
  const created = await (await create(rest(principal.key, "POST", "/api/finance/goals", input), context)).json();
  assert.deepEqual((await rpc(principal.key, "tools/call", { name: "create_finance_goal", arguments: input })).result.structuredContent, created);
  const allocation = { request_id: "goal-parity-reserve", version: 1, account_id: a.id, amount: "15" };
  const allocated = await (await allocate(rest(principal.key, "PUT", `/api/finance/goals/${created.goal.id}/allocations`, allocation), goalContext(created.goal.id))).json();
  assert.equal(allocated.goal.achieved, true);
  assert.deepEqual((await rpc(principal.key, "tools/call", { name: "set_finance_goal_allocation", arguments: { id: created.goal.id, ...allocation } })).result.structuredContent, allocated);
  assert.deepEqual((await rpc(principal.key, "tools/call", { name: "get_finance_goal", arguments: { id: created.goal.id } })).result.structuredContent,
    await (await inspect(rest(principal.key, "GET", `/api/finance/goals/${created.goal.id}`), goalContext(created.goal.id))).json());
  const edit = { request_id: "goal-parity-edit", version: 2, target: "20", due_date: "2027-01-01" };
  assert.deepEqual((await rpc(principal.key, "tools/call", { name: "update_finance_goal", arguments: { id: created.goal.id, ...edit } })).result.structuredContent,
    await (await update(rest(principal.key, "PATCH", `/api/finance/goals/${created.goal.id}`, edit), goalContext(created.goal.id))).json());
  assert.equal((await allocate(rest(principal.key, "PUT", `/api/finance/goals/${created.goal.id}/allocations`, { ...allocation, request_id: "goal-stale" }), goalContext(created.goal.id))).status, 409);
  const conflict = await rpc(principal.key, "tools/call", { name: "set_finance_goal_allocation", arguments: { id: created.goal.id, ...allocation, amount: "14" } });
  assert.equal(conflict.result.isError, true); assert.match(conflict.result.content[0].text, /request_conflict/);
  assert.deepEqual((await rpc(principal.key, "tools/call", { name: "list_finance_goals", arguments: { limit: 1, offset: 1 } })).result.structuredContent,
    await (await list(rest(principal.key, "GET", "/api/finance/goals?limit=1&offset=1"), context)).json());
  assert.deepEqual((await rpc(principal.key, "tools/call", { name: "list_finance_goal_accounts", arguments: {} })).result.structuredContent,
    await (await accounts(rest(principal.key, "GET", "/api/finance/goals/accounts"), context)).json());
  const audit = getDb().prepare("SELECT operation, before_json, after_json, affected_ids, created_at FROM finance_audit WHERE actor_id = ?").all(`api-key:${principal.id}`) as { operation: string; before_json: string; after_json: string; affected_ids: string; created_at: number }[];
  assert.deepEqual(audit.map(row => row.operation), ["goal.create", "goal.allocate", "goal.update"]);
  assert.equal(JSON.parse(audit[1].before_json).saved_cents, 0); assert.equal(JSON.parse(audit[1].after_json).saved_cents, 1500);
  assert.ok(JSON.parse(audit[1].affected_ids).includes(a.id)); assert.ok(audit.every(row => row.created_at > 0));
  assert.equal(JSON.stringify(audit).includes(principal.key), false);
});
