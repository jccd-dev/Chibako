import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../src/lib/db";
import { createApiKey } from "../src/server/auth/api-key-authorization";
import { GET as overviewRoute } from "../src/app/api/finance/overview/route";
import { GET as attentionRoute } from "../src/app/api/finance/attention/route";
import { POST as remote } from "../src/app/mcp/route";
import { createAccount } from "../src/features/finance/accounts";
import { postTransaction } from "../src/features/finance/activity";
import { setBudget, getFinanceReport } from "../src/features/finance/budgets";
import { createClassification } from "../src/features/finance/classifications";
import { createGoal, setGoalAllocation } from "../src/features/finance/goals";
import { createObligation } from "../src/features/finance/obligations";
import { cancelPlan, createPlan, postPlan } from "../src/features/finance/planning";
import { catchUpPlans, createSchedule } from "../src/features/finance/recurrence";
import { getAccount } from "../src/features/finance/accounts";
import { getFinanceAttention, getFinanceOverview } from "../src/features/finance/overview";
import type { FinanceActor } from "../src/features/finance/types";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-overview-"));
process.env.CHIBAKO_DATA_DIR = vault;
const owner: FinanceActor = { kind: "owner" };

beforeEach(() => getDb().exec(`
  DELETE FROM finance_audit;
  DELETE FROM finance_requests;
  DELETE FROM finance_obligation_payments;
  DELETE FROM finance_obligation_writeoffs;
  DELETE FROM finance_obligation_movements;
  DELETE FROM finance_obligations;
  DELETE FROM finance_goal_allocations;
  DELETE FROM finance_goals;
  DELETE FROM finance_plans;
  DELETE FROM finance_schedules;
  DELETE FROM finance_budget_limits;
  DELETE FROM finance_budget_plans;
  DELETE FROM finance_transactions;
  DELETE FROM finance_classifications;
  DELETE FROM finance_accounts;
`));
after(() => {
  getDb().close();
  rmSync(vault, { recursive: true, force: true });
});

const request = () => randomUUID();
const context = { params: Promise.resolve({}) };

async function rpc(key: string, name: string, arguments_: object) {
  const response = await remote(new Request("https://chibako.test/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: arguments_ } }),
  }));
  assert.equal(response.status, 200);
  return response.json();
}

test("overview keeps reserved money and obligations separate while attention aggregates actionable issues", () => {
  const account = createAccount(owner, {
    request_id: request(),
    name: "Overview cash",
    kind: "money",
    currency: "PHP",
    opening_balance: "100",
  }).account;
  const food = createClassification(owner, {
    request_id: request(),
    kind: "category",
    type: "expense",
    name: "Food",
  }).classification;
  const groceries = createClassification(owner, {
    request_id: request(),
    kind: "category",
    type: "expense",
    name: "Groceries",
    parent_id: food.id,
  }).classification;
  setBudget(owner, {
    request_id: request(),
    category_id: food.id,
    month: "2026-10",
    amount: "10",
    version: 0,
    mode: "forward",
  });
  const goal = createGoal(owner, {
    request_id: request(),
    name: "Emergency fund",
    target: "100",
  }).goal;
  setGoalAllocation(owner, goal.id, {
    request_id: request(),
    version: goal.version,
    account_id: account.id,
    amount: "80",
  });
  postTransaction(owner, {
    request_id: request(),
    account_id: account.id,
    amount: "30",
    transaction_date: "2026-10-10",
    category_id: food.id,
  });
  postTransaction(owner, {
    request_id: request(),
    account_id: account.id,
    amount: "5",
    transaction_date: "2026-10-10",
    category_id: food.id,
    subcategory_id: groceries.id,
  });
  const overduePlan = createPlan(owner, {
    request_id: request(),
    type: "expense",
    account_id: account.id,
    amount: "12",
    due_date: "2026-10-09",
    text: "Private plan text must stay out of compact attention reads",
  }).plan;
  const upcomingPlan = createPlan(owner, {
    request_id: request(),
    type: "income",
    account_id: account.id,
    amount: "20",
    due_date: "2026-10-20",
  }).plan;
  const debt = createObligation(owner, {
    request_id: request(),
    kind: "debt",
    name: "Private debt name",
    principal: "50",
    due_date: "2026-10-08",
  }).obligation;
  const settledDebt = createObligation(owner, {
    request_id: request(),
    kind: "debt",
    name: "Settled imported debt",
    principal: "25",
    due_date: "2026-10-07",
  }).obligation;
  getDb().prepare("UPDATE finance_obligations SET starting_progress_cents = opening_principal_cents WHERE id = ?").run(settledDebt.id);

  const overview = getFinanceOverview(owner);
  assert.equal(overview.money.balance_cents, 6500);
  assert.equal(overview.assets.balance_cents, 0);
  assert.deepEqual(overview.allocations, {
    reserved_cents: 8000,
    goal_count: 1,
  });
  assert.deepEqual(overview.obligations, {
    debt_cents: 5000,
    receivable_cents: 0,
  });

  const attention = getFinanceAttention(owner, {
    as_of: "2026-10-10",
    through_date: "2026-10-31",
    limit: 20,
  });
  assert.equal(attention.total, 5);
  assert.equal(attention.items.some((item) => item.reference_id === overduePlan.id && item.urgency === "overdue"), true);
  assert.equal(attention.items.some((item) => item.reference_id === upcomingPlan.id && item.urgency === "upcoming"), true);
  assert.equal(attention.items.some((item) => item.kind === "obligation_due" && item.reference_id === debt.id), true);
  assert.equal(attention.items.some((item) => item.reference_id === settledDebt.id), false);
  assert.deepEqual(attention.items.find((item) => item.kind === "budget_overrun"), {
    id: `budget:${food.id}`,
    kind: "budget_overrun",
    reference_id: food.id,
    title: "Food",
    target: "budgets",
    urgency: "warning",
    due_date: "2026-10-31",
    amount_cents: 2500,
    currency: "PHP",
  });
  assert.deepEqual(attention.items.find((item) => item.kind === "allocation_shortfall"), {
    id: `allocation:${account.id}`,
    kind: "allocation_shortfall",
    reference_id: account.id,
    title: "Goal allocation shortfall",
    target: "goals",
    urgency: "warning",
    due_date: null,
    amount_cents: 1500,
    currency: "PHP",
  });
  assert.equal(JSON.stringify(attention).includes("Private plan text"), false);
  assert.equal(JSON.stringify(attention).includes("Private debt name"), false);
  assert.equal(JSON.stringify(attention).includes("Overview cash"), false);
  assert.throws(() => getFinanceAttention(owner, { as_of: "2026-10-10", through_date: "2026-10-09" }), { code: "invalid_input" });
  assert.throws(() => getFinanceAttention(owner, { as_of: "2026-10-10", through_date: "2027-01-11" }), { code: "invalid_input" });
  const report = getFinanceReport(owner, { date_from: "2026-10-01", date_to: "2026-10-31" });
  assert.equal(report.spending_cents, 3500);
  assert.equal(report.categories.find((category) => category.category_id === food.id)?.spending_cents, 3500);
});

test("spendable subtracts current-month pending account expenses, including generated recurrence", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T12:00:00+08:00") });
  const account = createAccount(owner, {
    request_id: request(), name: "Spendable cash", kind: "money", currency: "PHP",
    opening_balance: "8000", maintaining_balance: "2000",
  }).account;
  createPlan(owner, {
    request_id: request(), type: "expense", account_id: account.id, amount: "10", due_date: "2026-10-20",
  });
  createPlan(owner, { request_id: request(), type: "expense", account_id: account.id, amount: "4", due_date: "2026-10-01" });
  createPlan(owner, { request_id: request(), type: "expense", account_id: account.id, amount: "2", due_date: "2026-10-12" });
  createPlan(owner, { request_id: request(), type: "expense", account_id: account.id, amount: "3", due_date: "2026-10-31" });
  createPlan(owner, { request_id: request(), type: "expense", account_id: account.id, amount: "100", due_date: "2026-09-30" });
  createPlan(owner, { request_id: request(), type: "expense", account_id: account.id, amount: "200", due_date: "2026-11-01" });
  const income = createPlan(owner, {
    request_id: request(), type: "income", account_id: account.id, amount: "999", due_date: "2026-10-20",
  }).plan;
  const cancelled = createPlan(owner, {
    request_id: request(), type: "expense", account_id: account.id, amount: "30", due_date: "2026-10-20",
  }).plan;
  cancelPlan(owner, cancelled.id, { request_id: request(), version: cancelled.version });
  const satisfied = createPlan(owner, {
    request_id: request(), type: "expense", account_id: account.id, amount: "20", due_date: "2026-10-20",
  }).plan;
  postPlan(owner, satisfied.id, {
    request_id: request(), version: satisfied.version, account_id: account.id, amount: "20", transaction_date: "2026-10-12",
  });
  const schedule = createSchedule(owner, {
    request_id: request(), type: "expense", account_id: account.id, amount: "8", interval_count: 1,
    interval_unit: "month", start_date: "2026-10-20",
  }).schedule;
  const nextMonthSchedule = createSchedule(owner, {
    request_id: request(), type: "expense", account_id: account.id, amount: "6", interval_count: 1,
    interval_unit: "month", start_date: "2026-11-20",
  }).schedule;
  catchUpPlans(owner, { request_id: request(), through_date: "2026-10-12" });

  const current = getAccount(owner, account.id);
  assert.equal(current.balance_cents, 998000);
  assert.equal(current.planned_expense_cents, 2700);
  assert.equal(current.spendable_cents, 795300);
  assert.equal(getFinanceOverview(owner).spendable_cents, 795300);
  assert.equal(getFinanceOverview(owner).money.balance_cents, 998000);
  assert.equal(income.type, "income");
  assert.equal(schedule.account_id, account.id);
  assert.equal(nextMonthSchedule.account_id, account.id);
});

test("attention pagination returns complete bounded pages", () => {
  const account = createAccount(owner, {
    request_id: request(),
    name: "Pagination cash",
    kind: "money",
    currency: "PHP",
    opening_balance: "100",
  }).account;
  const category = createClassification(owner, {
    request_id: request(),
    kind: "category",
    type: "expense",
    name: "Pagination category",
  }).classification;
  setBudget(owner, {
    request_id: request(),
    category_id: category.id,
    month: "2026-10",
    amount: "0",
    version: 0,
    mode: "forward",
  });
  postTransaction(owner, {
    request_id: request(),
    account_id: account.id,
    amount: "1",
    transaction_date: "2026-10-10",
    category_id: category.id,
  });
  createObligation(owner, {
    request_id: request(),
    kind: "debt",
    name: "Pagination debt",
    principal: "1",
    due_date: "2026-10-10",
  });
  for (let index = 0; index < 55; index++) {
    createPlan(owner, {
      request_id: request(),
      type: "expense",
      account_id: account.id,
      amount: "1",
      due_date: "2026-10-20",
    });
  }

  const first = getFinanceAttention(owner, { as_of: "2026-10-10", through_date: "2026-10-31", limit: 50 });
  const second = getFinanceAttention(owner, { as_of: "2026-10-10", through_date: "2026-10-31", limit: 50, offset: 50 });
  const ids = [...first.items, ...second.items].map((item) => item.id);
  assert.equal(first.total, 57);
  assert.equal(second.total, 57);
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 7);
  assert.equal(first.items[0]?.kind, "obligation_due");
  assert.equal(first.items[1]?.kind, "budget_overrun");
  assert.equal(first.items.slice(2).every((item) => item.kind === "pending_plan"), true);
  assert.equal(second.items.every((item) => item.kind === "pending_plan"), true);
  assert.equal(new Set(ids).size, 57);
});

test("REST and MCP expose bounded overview and attention reads only with finance:read", async () => {
  const reader = createApiKey("Overview reader", ["finance:read"]);
  const manager = createApiKey("Overview manager", ["finance:manage"]);
  const overviewResponse = await overviewRoute(new Request("https://chibako.test/api/finance/overview", {
    headers: { authorization: `Bearer ${reader.key}` },
  }), context);
  const attentionResponse = await attentionRoute(new Request("https://chibako.test/api/finance/attention?as_of=2026-10-10&through_date=2026-10-31&limit=10", {
    headers: { authorization: `Bearer ${reader.key}` },
  }), context);
  assert.equal(overviewResponse.status, 200);
  assert.equal(attentionResponse.status, 200);
  const overview = await overviewResponse.json();
  const attention = await attentionResponse.json();
  assert.deepEqual((await rpc(reader.key, "get_finance_overview", {})).result.structuredContent, overview);
  assert.deepEqual((await rpc(reader.key, "get_finance_attention", {
    as_of: "2026-10-10",
    through_date: "2026-10-31",
    limit: 10,
  })).result.structuredContent, attention);
  const tools = (await (async () => {
    const response = await remote(new Request("https://chibako.test/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${reader.key}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/list", params: {} }),
    }));
    return response.json();
  })()).result.tools.map((tool: { name: string }) => tool.name);
  assert.equal(tools.includes("get_finance_overview"), true);
  assert.equal(tools.includes("get_finance_attention"), true);
  assert.equal((await overviewRoute(new Request("https://chibako.test/api/finance/overview", {
    headers: { authorization: `Bearer ${manager.key}` },
  }), context)).status, 403);
});
