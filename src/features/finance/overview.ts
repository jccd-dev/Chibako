import { getDb } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { getFinanceSummary, readAccountBalance } from "./accounts";
import { listAttentionBudgetOverruns } from "./budgets";
import { listGoalAllocationShortfalls } from "./goals";
import { listDueAttentionObligations, listObligations } from "./obligations";
import { listAttentionPlans } from "./planning";
import { exactCents } from "./money";
import { parseFinance } from "./mutations";
import {
  financeAttentionSchema,
  type FinanceAttentionItem,
  type FinanceAttentionPage,
  type FinanceOverview,
} from "./overview-types";

function today(): string {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function endOfMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function urgencyFor(asOf: string, dueDate: string): FinanceAttentionItem["urgency"] {
  if (dueDate < asOf) return "overdue";
  if (dueDate === asOf) return "due";
  return "upcoming";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function getFinanceOverview(actor: FinanceActor): FinanceOverview {
  authorizeFinance(actor, "finance:read");
  const summary = getFinanceSummary(actor);
  const db = getDb();
  const allocation = db.prepare(`
    SELECT COUNT(DISTINCT g.id) AS goal_count, COALESCE(SUM(a.amount_cents), 0) AS reserved_cents
    FROM finance_goals g
    LEFT JOIN finance_goal_allocations a ON a.goal_id = g.id
    WHERE g.archived = 0
  `).safeIntegers().get() as { goal_count: number | bigint; reserved_cents: bigint };
  const accounts = db.prepare("SELECT id FROM finance_accounts WHERE kind = 'money' AND include_in_summary = 1").all() as { id: string }[];
  let spendable = 0n;
  for (const account of accounts) spendable += BigInt(readAccountBalance(account.id).spendable_cents);
  const obligations = listObligations(actor, { limit: 1, offset: 0, archived: "all" });
  return {
    ...summary,
    spendable_cents: exactCents(spendable),
    allocations: {
      reserved_cents: exactCents(allocation.reserved_cents),
      goal_count: Number(allocation.goal_count),
    },
    obligations: {
      debt_cents: obligations.debt_cents,
      receivable_cents: obligations.receivable_cents,
    },
  };
}

export function getFinanceAttention(actor: FinanceActor, input: unknown = {}): FinanceAttentionPage {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(financeAttentionSchema, input);
  const asOf = query.as_of ?? today();
  const throughDate = query.through_date ?? addDays(asOf, 30);
  if (throughDate < asOf || daysBetween(asOf, throughDate) > 92) {
    throw new FinanceError("Choose an ordered attention horizon of at most 92 days", 400, "invalid_input");
  }

  const items: FinanceAttentionItem[] = [];
  const candidateLimit = query.offset + query.limit;
  const planPage = listAttentionPlans(actor, { through_date: throughDate, limit: candidateLimit });
  for (const plan of planPage.plans) {
    items.push({
      id: `plan:${plan.id}`,
      kind: "pending_plan",
      reference_id: plan.id,
      title: plan.category_name ?? (plan.type === "income" ? "Income plan" : "Expense plan"),
      target: "planning",
      urgency: urgencyFor(asOf, plan.due_date),
      due_date: plan.due_date,
      amount_cents: plan.amount_cents,
      currency: "PHP",
    });
  }

  const obligations = listDueAttentionObligations(actor, { as_of: asOf, through_date: throughDate, limit: candidateLimit });
  for (const obligation of obligations.obligations) {
    if (obligation.status !== "open" || !obligation.due_date || obligation.due_date > throughDate) continue;
    items.push({
      id: `obligation:${obligation.id}`,
      kind: "obligation_due",
      reference_id: obligation.id,
      title: obligation.kind === "debt" ? "Debt payment due" : "Receivable due",
      target: "obligations",
      urgency: urgencyFor(asOf, obligation.due_date),
      due_date: obligation.due_date,
      amount_cents: obligation.outstanding_cents,
      currency: "PHP",
    });
  }

  const categories = listAttentionBudgetOverruns(actor, { month: asOf.slice(0, 7), limit: candidateLimit });
  for (const category of categories.categories) {
    if (category.category_id === null || category.budget_cents === null) continue;
    items.push({
      id: `budget:${category.category_id}`,
      kind: "budget_overrun",
      reference_id: category.category_id,
      title: category.name,
      target: "budgets",
      urgency: "warning",
      due_date: endOfMonth(asOf),
      amount_cents: category.spending_cents - category.budget_cents,
      currency: "PHP",
    });
  }

  const goalAccounts = listGoalAllocationShortfalls(actor, { limit: candidateLimit });
  for (const account of goalAccounts.accounts) {
    if (account.shortfall_cents <= 0) continue;
    items.push({
      id: `allocation:${account.account_id}`,
      kind: "allocation_shortfall",
      reference_id: account.account_id,
      title: "Goal allocation shortfall",
      target: "goals",
      urgency: "warning",
      due_date: null,
      amount_cents: account.shortfall_cents,
      currency: "PHP",
    });
  }

  const urgencyRank: Record<FinanceAttentionItem["urgency"], number> = {
    overdue: 0,
    due: 1,
    warning: 2,
    upcoming: 3,
  };
  items.sort((left, right) => urgencyRank[left.urgency] - urgencyRank[right.urgency]
    || compareText(left.due_date ?? "9999-12-31", right.due_date ?? "9999-12-31")
    || compareText(left.title, right.title)
    || compareText(left.id, right.id));

  return {
    items: items.slice(query.offset, query.offset + query.limit),
    total: planPage.total + obligations.total + categories.total + goalAccounts.total,
    limit: query.limit,
    offset: query.offset,
    as_of: asOf,
    through_date: throughDate,
    currency: "PHP",
  };
}
