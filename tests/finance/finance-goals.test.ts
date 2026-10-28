import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../../src/lib/db";
import { createApiKey } from "../../src/server/auth/api-key-authorization";
import { createAccount, getAccount, getFinanceSummary, updateAccount } from "../../src/features/finance/accounts";
import { createGoal, deleteGoal, getGoal, listGoals, listGoalAccounts, moveGoalMoney, setGoalAllocation, updateGoal } from "../../src/features/finance/goals";
import { getActivityTotals, postTransaction } from "../../src/features/finance/activity";
import { postTransfer, reconcileAccount } from "../../src/features/finance/movements";
import { correctActivity, revertActivity } from "../../src/features/finance/corrections";
import { createPlan, postPlan } from "../../src/features/finance/planning";
import { GET as list, POST as create } from "../../src/app/api/finance/goals/route";
import { GET as inspect, PATCH as update, DELETE as destroy } from "../../src/app/api/finance/goals/[id]/route";
import { PUT as allocate } from "../../src/app/api/finance/goals/[id]/allocations/route";
import { GET as accounts } from "../../src/app/api/finance/goals/accounts/route";
import { POST as remote } from "../../src/app/mcp/route";
import type { FinanceActor } from "../../src/features/finance/types";
import type { FinanceGoal } from "../../src/features/finance/goal-types";

const vault = mkdtempSync(join(tmpdir(), "chibako-goals-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };
beforeEach(() => getDb().exec("DELETE FROM finance_audit; DELETE FROM finance_requests; DELETE FROM finance_goal_movements; DELETE FROM finance_goal_allocations; DELETE FROM finance_goals; DELETE FROM finance_plans; DELETE FROM finance_movements; DELETE FROM finance_transactions; DELETE FROM finance_accounts;"));
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });
const action = (version = 1) => ({ request_id: randomUUID(), version });
const account = (balance = "100", kind = "money") => createAccount(owner, { request_id: randomUUID(), name: "Goal test cash", kind, currency: "PHP", opening_balance: balance }).account;
const goal = (target = "100") => createGoal(owner, { request_id: randomUUID(), name: "Goal test", target }).goal;
const setAmount = (id: string, account_id: string, amount: string) => setGoalAllocation(owner, id, { ...action(getGoal(owner, id).version), account_id, amount });
const expense = (account_id: string, amount: string) => postTransaction(owner, { request_id: randomUUID(), account_id, amount, type: "expense", transaction_date: "2026-10-06" });

test("goal allocations move cash, preserve total money, and require a zero balance before archive", () => {
  const a = account(), b = account("50"), first = goal(), second = goal();
  const totals = getFinanceSummary(owner), activity = getActivityTotals(owner, { month: "2026-10" });
  const request = { ...action(), account_id: a.id, amount: "60.25" };
  const result = setGoalAllocation(owner, first.id, request);
  assert.deepEqual(setGoalAllocation(owner, first.id, request), result);
  assert.throws(() => setGoalAllocation(owner, first.id, { ...request, amount: "61" }), { code: "request_conflict" });
  assert.throws(() => setGoalAllocation(owner, first.id, { ...request, request_id: randomUUID() }), { code: "version_conflict" });
  assert.equal(getAccount(owner, a.id).balance_cents, 3975);
  assert.throws(() => setAmount(second.id, a.id, "40"), { code: "insufficient_funds" });
  setAmount(second.id, a.id, "39.75");
  assert.equal(getAccount(owner, a.id).balance_cents, 0);
  const achieved = setAmount(first.id, b.id, "39.75").goal;
  assert.equal(achieved.saved_cents, 10000); assert.equal(achieved.achieved, true); assert.equal(achieved.allocations.length, 2);
  assert.equal(getAccount(owner, b.id).balance_cents, 1025);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === a.id)?.balance_cents, 0);
  assert.deepEqual(getFinanceSummary(owner), totals); assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), activity);
  assert.throws(() => updateGoal(owner, first.id, { ...action(getGoal(owner, first.id).version), archived: true }), { code: "goal_has_money" });
  const withdrawn = moveGoalMoney(owner, first.id, { ...action(getGoal(owner, first.id).version), direction: "withdrawal", account_id: b.id, amount: "100" }).goal;
  assert.equal(withdrawn.saved_cents, 0); assert.equal(withdrawn.achieved, false);
  assert.equal(getAccount(owner, b.id).balance_cents, 11025);
  assert.deepEqual(getFinanceSummary(owner), totals); assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), activity);
  const archive = { ...action(withdrawn.version), archived: true };
  const archived = updateGoal(owner, first.id, archive).goal;
  assert.equal(archived.saved_cents, 0); assert.equal(archived.allocations.length, 0);
  assert.deepEqual(updateGoal(owner, first.id, archive).goal, archived);
  assert.equal(listGoals(owner).total, 1); assert.equal(listGoals(owner, { archived: "true" }).total, 1);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === a.id)?.reserved_cents, 0);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === b.id)?.reserved_cents, 0);
  assert.throws(() => setAmount(first.id, a.id, "1"), { code: "goal_archived" });
  assert.throws(() => updateGoal(owner, first.id, { ...action(archived.version), archived: false }), { code: "goal_archived" });
  assert.deepEqual(getFinanceSummary(owner), totals);
});

test("linked creation reserves existing positive cents without moving cash or double counting reservations", () => {
  const a = account("20.25"), b = account("100");
  const totals = getFinanceSummary(owner), activity = getActivityTotals(owner, { month: "2026-10" });
  const input = { request_id: randomUUID(), name: "Linked seed", target: "10", linked_account_id: a.id };
  const created = createGoal(owner, input);
  assert.equal(created.goal.saved_cents, 2025);
  assert.equal(created.goal.achieved, true);
  assert.equal(created.goal.allocations[0].account_id, a.id);
  assert.equal(created.goal.allocations[0].amount_cents, 2025);
  assert.deepEqual(createGoal(owner, input), created);
  assert.throws(() => createGoal(owner, { ...input, target: "11" }), { code: "request_conflict" });
  assert.equal(getAccount(owner, a.id).balance_cents, 2025);
  assert.deepEqual(getFinanceSummary(owner), totals);
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), activity);
  assert.deepEqual(getDb().prepare("SELECT COUNT(*) AS count FROM finance_goal_movements").get(), { count: 0 });
  const counts = getDb().prepare("SELECT (SELECT COUNT(*) FROM finance_goals) AS goals, (SELECT COUNT(*) FROM finance_audit) AS audits, (SELECT COUNT(*) FROM finance_requests) AS requests").get();
  assert.throws(() => createGoal(owner, { ...input, request_id: randomUUID() }), { code: "insufficient_funds" });
  assert.deepEqual(getDb().prepare("SELECT (SELECT COUNT(*) FROM finance_goals) AS goals, (SELECT COUNT(*) FROM finance_audit) AS audits, (SELECT COUNT(*) FROM finance_requests) AS requests").get(), counts);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === a.id)?.reserved_cents, 2025);
  const before = getGoal(owner, created.goal.id);
  const movementCount = getDb().prepare("SELECT COUNT(*) AS count FROM finance_goal_movements").get();
  for (const direction of ["deposit", "withdrawal"]) {
    assert.throws(() => moveGoalMoney(owner, before.id, { ...action(before.version), direction, account_id: a.id, amount: "1" }), { code: "invalid_account" });
  }
  assert.throws(() => setAmount(before.id, a.id, "19.25"), { code: "invalid_account" });
  assert.deepEqual(getGoal(owner, before.id), before);
  assert.deepEqual(getDb().prepare("SELECT COUNT(*) AS count FROM finance_goal_movements").get(), movementCount);
  assert.deepEqual(getDb().prepare("SELECT (SELECT COUNT(*) FROM finance_goals) AS goals, (SELECT COUNT(*) FROM finance_audit) AS audits, (SELECT COUNT(*) FROM finance_requests) AS requests").get(), counts);
  const deposit = { ...action(before.version), direction: "deposit", account_id: b.id, amount: "5.10" };
  const deposited = moveGoalMoney(owner, before.id, deposit);
  assert.deepEqual(moveGoalMoney(owner, before.id, deposit), deposited);
  assert.equal(deposited.goal.saved_cents, 2535);
  assert.equal(getAccount(owner, a.id).balance_cents, 2535);
  assert.equal(getAccount(owner, b.id).balance_cents, 9490);
  const withdrawal = { ...action(deposited.goal.version), direction: "withdrawal", account_id: b.id, amount: "25.35" };
  const withdrawn = moveGoalMoney(owner, before.id, withdrawal);
  assert.deepEqual(moveGoalMoney(owner, before.id, withdrawal), withdrawn);
  assert.equal(withdrawn.goal.saved_cents, 0);
  assert.equal(getAccount(owner, a.id).balance_cents, 0);
  assert.equal(getAccount(owner, b.id).balance_cents, 12025);
  assert.deepEqual(getFinanceSummary(owner), totals);
  assert.deepEqual(getActivityTotals(owner, { month: "2026-10" }), activity);
  for (const balance of ["0", "-1.25"]) {
    const cash = account(balance);
    const empty: FinanceGoal = createGoal(owner, { ...input, request_id: randomUUID(), linked_account_id: cash.id }).goal;
    assert.equal(empty.saved_cents, 0);
    assert.equal(empty.allocations.length, 0);
    assert.equal(getAccount(owner, cash.id).balance_cents, balance === "0" ? 0 : -125);
  }
});

test("linked goal shortfalls warn after spending, and movements preserve holdings through account changes", () => {
  const a = account("20"), b = account("100");
  const g = goal();
  setAmount(g.id, b.id, "80");
  updateGoal(owner, g.id, { ...action(getGoal(owner, g.id).version), linked_account_id: a.id });
  assert.equal(getAccount(owner, a.id).balance_cents, 10000);
  assert.equal(getAccount(owner, b.id).balance_cents, 2000);
  const posted = expense(a.id, "30");
  assert.deepEqual(posted.warnings, ["allocation_shortfall"]);
  assert.deepEqual(posted.allocation_shortfalls, [{ account_id: a.id, balance_cents: 7000, reserved_cents: 8000, shortfall_cents: 1000 }]);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === a.id)?.shortfall_cents, 1000);
  assert.throws(() => setAmount(g.id, b.id, "101"), { code: "insufficient_funds" });
  assert.equal(setAmount(g.id, b.id, "75").account.shortfall_cents, 0);
  assert.equal(getAccount(owner, a.id).balance_cents, 6500);
  assert.equal(getAccount(owner, b.id).balance_cents, 2500);
  revertActivity(owner, posted.transaction.id, action());
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === a.id)?.shortfall_cents, 0);
  const transfer = postTransfer(owner, { request_id: randomUUID(), source_account_id: a.id, destination_account_id: b.id, amount: "30", transaction_date: "2026-10-06" });
  assert.equal(transfer.allocation_shortfalls?.[0].shortfall_cents, 1000);
  revertActivity(owner, transfer.transaction.id, action());
  const edit = expense(a.id, "10");
  const corrected = correctActivity(owner, edit.transaction.id, { ...action(), amount: "40" });
  assert.equal(corrected.allocation_shortfalls?.[0].shortfall_cents, 2000);
  revertActivity(owner, edit.transaction.id, action(corrected.transaction.version));
  const reconciled = reconcileAccount(owner, { request_id: randomUUID(), account_id: a.id, expected_balance_cents: 9500, actual_balance: "65", transaction_date: "2026-10-06" });
  assert.equal(reconciled.allocation_shortfalls?.[0].shortfall_cents, 1000);
  revertActivity(owner, reconciled.transaction.id, action());
  const plan = createPlan(owner, { request_id: randomUUID(), account_id: a.id, amount: "30", due_date: "2026-10-06" }).plan;
  const planned = postPlan(owner, plan.id, { ...action(), account_id: a.id, amount: "30", transaction_date: "2026-10-06" });
  assert.equal(planned.allocation_shortfalls?.[0].shortfall_cents, 1000);
  assert.throws(() => setAmount(g.id, b.id, "0"), { code: "insufficient_funds" });
  assert.throws(() => moveGoalMoney(owner, g.id, { ...action(getGoal(owner, g.id).version), direction: "withdrawal", account_id: a.id, amount: "75" }), { code: "invalid_account" });
  revertActivity(owner, planned.transaction.id, action());
  assert.equal(moveGoalMoney(owner, g.id, { ...action(getGoal(owner, g.id).version), direction: "withdrawal", account_id: b.id, amount: "75" }).goal.saved_cents, 0);
  assert.equal(getAccount(owner, a.id).balance_cents, 2000);
  updateAccount(owner, a.id, { ...action(), archived: true });
  assert.throws(() => setAmount(g.id, b.id, "1"), { code: "invalid_account" });
});

test("invalid money/accounts and aggregate overflow reject atomically at the exact-cent boundaries", () => {
  const a = account("90071992547409.91"), b = account("1"), asset = account("10", "asset"), g = goal();
  assert.throws(() => setAmount(g.id, asset.id, "1"), { code: "invalid_account" });
  assert.throws(() => setAmount(g.id, "missing", "1"), { code: "not_found" });
  for (const amount of ["-1", "01", "0.001", "90071992547409.92"]) assert.throws(() => setAmount(g.id, a.id, amount));
  assert.throws(() => createGoal(owner, { request_id: randomUUID(), name: "X", target: "0" }), { code: "invalid_input" });
  assert.throws(() => createGoal(owner, { request_id: randomUUID(), name: "X", target: "10", saved: "1" }), { code: "invalid_input" });
  setAmount(g.id, a.id, "90071992547409.91");
  const before = getGoal(owner, g.id);
  assert.throws(() => setAmount(g.id, b.id, "0.01"), { code: "amount_out_of_range" });
  assert.deepEqual(getGoal(owner, g.id), before);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === b.id)?.reserved_cents, 0);
  assert.equal(expense(b.id, "1").balance_cents, 0);
  assert.throws(() => expense(b.id, "0.01"), { code: "insufficient_funds" });
  assert.equal(getAccount(owner, a.id).balance_cents, 0);
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
  for (const scopes of [[], ["notes:read"], ["finance:write"], ["finance:read"], ["finance:manage"], ["finance:manage", "finance:write"]]) {
    const { key } = createApiKey(`Goal scopes ${scopes.join()}`, scopes);
    const canRead = scopes.includes("finance:read"), canManage = scopes.includes("finance:manage");
    const canAllocate = canManage && scopes.includes("finance:write");
    assert.equal((await list(rest(key, "GET", "/api/finance/goals"), context)).status, canRead ? 200 : 403);
    assert.equal((await inspect(rest(key, "GET", `/api/finance/goals/${g.id}`), goalContext(g.id))).status, canRead ? 200 : 403);
    assert.equal((await accounts(rest(key, "GET", "/api/finance/goals/accounts"), context)).status, canRead ? 200 : 403);
    assert.equal((await create(rest(key, "POST", "/api/finance/goals", { request_id: randomUUID(), name: "Scoped", target: "10" }), context)).status, canManage ? 201 : 403);
    assert.equal((await allocate(rest(key, "PUT", `/api/finance/goals/${g.id}/allocations`, { ...action(getGoal(owner, g.id).version), account_id: a.id, amount: "1" }), goalContext(g.id))).status, canAllocate ? 200 : 403);
    assert.equal((await update(rest(key, "PATCH", `/api/finance/goals/${g.id}`, { ...action(getGoal(owner, g.id).version), name: "Scoped goal" }), goalContext(g.id))).status, canManage ? 200 : 403);
    const tools = (await rpc(key, "tools/list")).result.tools.map((row: { name: string }) => row.name);
    assert.equal(tools.includes("list_finance_goals"), canRead); assert.equal(tools.includes("set_finance_goal_allocation"), canAllocate);
  }
  assert.equal((await allocate(rest("invalid", "PUT", `/api/finance/goals/${g.id}/allocations`, {}), goalContext(g.id))).status, 401);
  const principal = createApiKey("Goal parity", ["finance:read", "finance:manage", "finance:write"]);
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

test("delete removes a mistaken goal only when no account balance would change", async () => {
  const a = account(), b = account("50");
  const move = (id: string, direction: "deposit" | "withdrawal", account_id: string, amount: string) =>
    moveGoalMoney(owner, id, { ...action(getGoal(owner, id).version), direction, account_id, amount });
  const remove = (id: string) => deleteGoal(owner, id, action(getGoal(owner, id).version));
  const returned = goal();
  move(returned.id, "deposit", a.id, "30"); move(returned.id, "withdrawal", a.id, "30");
  assert.throws(() => deleteGoal(owner, returned.id, action(1)), { code: "version_conflict" });
  assert.deepEqual(remove(returned.id), { deleted: true, id: returned.id });
  assert.throws(() => getGoal(owner, returned.id), { code: "not_found" });
  assert.equal(getAccount(owner, a.id).balance_cents, 10000);
  const shifted = goal();
  move(shifted.id, "deposit", a.id, "20"); move(shifted.id, "withdrawal", b.id, "20");
  assert.throws(() => remove(shifted.id), { code: "has_cash_activity" });
  const held = goal();
  move(held.id, "deposit", a.id, "5");
  assert.throws(() => remove(held.id), { code: "has_cash_activity" });
  const reserved = createGoal(owner, { request_id: randomUUID(), name: "Reserved", target: "10", linked_account_id: b.id }).goal;
  assert.ok(reserved.saved_cents > 0);
  remove(reserved.id);
  assert.equal(getAccount(owner, b.id).balance_cents, 7000);
  assert.equal(listGoalAccounts(owner).accounts.find(row => row.account_id === b.id)?.reserved_cents, 0);
  const { key: reader } = createApiKey("Goal delete reader", ["finance:read", "finance:write"]);
  const { key: manager } = createApiKey("Goal delete manager", ["finance:read", "finance:manage"]);
  const viaRest = goal(), viaMcp = goal();
  assert.equal((await destroy(rest(reader, "DELETE", `/api/finance/goals/${viaRest.id}`, action()), goalContext(viaRest.id))).status, 403);
  assert.equal((await rpc(reader, "tools/list")).result.tools.some((row: { name: string }) => row.name === "delete_finance_goal"), false);
  assert.equal((await destroy(rest(manager, "DELETE", `/api/finance/goals/${viaRest.id}`, action()), goalContext(viaRest.id))).status, 200);
  assert.notEqual((await rpc(manager, "tools/call", { name: "delete_finance_goal", arguments: { id: viaMcp.id, ...action() } })).result.isError, true);
  assert.equal(listGoals(owner, { archived: "all" }).goals.some(row => row.id === viaRest.id || row.id === viaMcp.id), false);
});
