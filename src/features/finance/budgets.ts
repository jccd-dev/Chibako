import { getDb } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { readClassification } from "./classifications";
import { parseFinance, financeMutation } from "./mutations";
import { decimalCents, exactCents } from "./money";
import { getBudgetSchema, setBudgetSchema, financeReportSchema, type BudgetSnapshot, type FinanceReport, type CategoryReport } from "./budget-types";

function readBudget(categoryId: string, month: string): BudgetSnapshot {
  const db = getDb();
  const plan = db.prepare("SELECT version FROM finance_budget_plans WHERE category_id = ?").get(categoryId) as { version: number } | undefined;
  const limit = db.prepare(`SELECT amount_cents FROM finance_budget_limits WHERE category_id = ? AND
    ((mode = 'correction' AND month = ?) OR (mode = 'forward' AND month <= ?))
    ORDER BY CASE mode WHEN 'correction' THEN 0 ELSE 1 END, month DESC LIMIT 1`).get(categoryId, month, month) as { amount_cents: number } | undefined;
  return { category_id: categoryId, month, version: plan?.version ?? 0, limit_cents: limit?.amount_cents ?? null, currency: "PHP" };
}
function expenseCategory(id: string) {
  const category = readClassification(id);
  if (category.kind !== "category" || category.type !== "expense" || category.parent_id) throw new FinanceError("Budgets require a top-level expense category", 400, "invalid_category");
  return category;
}
export function getBudget(actor: FinanceActor, input: unknown): BudgetSnapshot {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(getBudgetSchema, input);
  return getDb().transaction(() => { expenseCategory(query.category_id); return readBudget(query.category_id, query.month); })();
}
export function setBudget(actor: FinanceActor, input: unknown): { budget: BudgetSnapshot } {
  authorizeFinance(actor, "finance:manage");
  const { request_id, ...payload } = parseFinance(setBudgetSchema, input);
  const amount = decimalCents(payload.amount);
  return financeMutation(actor, request_id, "budget.set", payload, () => {
    expenseCategory(payload.category_id);
    const db = getDb(), before = readBudget(payload.category_id, payload.month);
    if (before.version !== payload.version || before.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Budget changed; refresh before editing", 409, "version_conflict");
    // The version covers the entire category schedule, including future limits and month corrections.
    const scheduleBefore = db.prepare("SELECT month, mode, amount_cents FROM finance_budget_limits WHERE category_id = ? ORDER BY month, mode").all(payload.category_id);
    db.prepare("INSERT INTO finance_budget_plans (category_id, version) VALUES (?, 1) ON CONFLICT(category_id) DO UPDATE SET version = version + 1").run(payload.category_id);
    if (payload.mode === "forward") db.prepare("DELETE FROM finance_budget_limits WHERE category_id = ? AND month >= ?").run(payload.category_id, payload.month);
    db.prepare(`INSERT INTO finance_budget_limits (category_id, month, mode, amount_cents) VALUES (?,?,?,?)
      ON CONFLICT(category_id, month, mode) DO UPDATE SET amount_cents = excluded.amount_cents`).run(payload.category_id, payload.month, payload.mode, amount);
    const budget = readBudget(payload.category_id, payload.month);
    const scheduleAfter = db.prepare("SELECT month, mode, amount_cents FROM finance_budget_limits WHERE category_id = ? ORDER BY month, mode").all(payload.category_id);
    return { result: { budget }, affectedIds: [payload.category_id], before: { ...before, schedule: scheduleBefore }, after: { ...budget, schedule: scheduleAfter } };
  });
}
function reportDates(input: unknown) {
  const query = parseFinance(financeReportSchema, input);
  const today = new Date(), month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const from = query.date_from ?? `${query.date_to?.slice(0, 7) ?? month}-01`;
  const endMonth = query.date_to?.slice(0, 7) ?? from.slice(0, 7);
  const to = query.date_to ?? new Date(Date.UTC(Number(endMonth.slice(0, 4)), Number(endMonth.slice(5)), 0)).toISOString().slice(0, 10);
  const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  if (from > to || monthIndex(to) - monthIndex(from) >= 12) throw new FinanceError("Choose an ordered report range of at most 12 calendar months", 400, "invalid_input");
  const months: string[] = [];
  for (let index = monthIndex(from); index <= monthIndex(to); index++) months.push(`${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`);
  return { ...query, from, to, months };
}
export function listAttentionBudgetOverruns(actor: FinanceActor, input: { month: string; limit: number }) {
  authorizeFinance(actor, "finance:read");
  const from = `${input.month}-01`;
  const [year, month] = input.month.split("-").map(Number);
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const cte = `WITH activity_spending AS (
    SELECT CASE WHEN c.parent_id IS NULL THEN t.category_id ELSE c.parent_id END AS category_id, SUM(t.amount_cents) AS spending_cents
    FROM finance_transactions t LEFT JOIN finance_classifications c ON c.id = t.category_id
    WHERE t.reverted = 0 AND t.type <> 'income' AND t.transaction_date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM finance_obligation_payments p WHERE p.cash_activity_id = t.id)
    GROUP BY CASE WHEN c.parent_id IS NULL THEN t.category_id ELSE c.parent_id END
    UNION ALL
    SELECT CASE WHEN c.parent_id IS NULL THEN t.category_id ELSE c.parent_id END AS category_id, -SUM(r.amount_cents) AS spending_cents
    FROM finance_refunds r JOIN finance_transactions t ON t.id = r.expense_id
      LEFT JOIN finance_classifications c ON c.id = t.category_id
    WHERE r.reverted = 0 AND t.reverted = 0 AND r.transaction_date BETWEEN ? AND ?
    GROUP BY CASE WHEN c.parent_id IS NULL THEN t.category_id ELSE c.parent_id END
  ), spending AS (
    SELECT category_id, SUM(spending_cents) AS spending_cents
    FROM activity_spending GROUP BY category_id
  ), category_spending AS (
    SELECT c.id AS category_id, c.name,
      COALESCE(s.spending_cents, 0) AS spending_cents,
      (SELECT l.amount_cents FROM finance_budget_limits l
       WHERE l.category_id = c.id
         AND ((l.mode = 'correction' AND l.month = ?) OR (l.mode = 'forward' AND l.month <= ?))
       ORDER BY CASE l.mode WHEN 'correction' THEN 0 ELSE 1 END, l.month DESC LIMIT 1) AS budget_cents
    FROM finance_classifications c LEFT JOIN spending s ON s.category_id = c.id
    WHERE c.kind = 'category' AND c.type = 'expense' AND c.parent_id IS NULL
  ), overruns AS (
    SELECT category_id, name, spending_cents, budget_cents
    FROM category_spending
    WHERE budget_cents IS NOT NULL AND spending_cents > budget_cents
  )`;
  const values = [from, to, from, to, input.month, input.month];
  const db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare(`${cte} SELECT COUNT(*) AS total FROM overruns`).get(...values) as { total: number };
    const rows = db.prepare(`${cte} SELECT category_id, name, spending_cents, budget_cents FROM overruns ORDER BY name, category_id LIMIT ?`)
      .safeIntegers().all(...values, input.limit) as { category_id: string; name: string; spending_cents: bigint; budget_cents: bigint }[];
    return {
      categories: rows.map(row => ({ category_id: row.category_id, name: row.name, spending_cents: exactCents(row.spending_cents), budget_cents: exactCents(row.budget_cents) })),
      total,
    };
  })();
}

export function getFinanceReport(actor: FinanceActor, input: unknown = {}): FinanceReport {
  authorizeFinance(actor, "finance:read");
  const query = reportDates(input), db = getDb();
  return db.transaction((): FinanceReport => {
    const months = new Map(query.months.map(month => [month, { income: 0n, spending: 0n }]));
    const days = new Map<string, { income: bigint; spending: bigint }>();
    const spending = new Map<string | null, Map<string, bigint>>();
    const rows = db.prepare(`SELECT t.type, CASE WHEN c.parent_id IS NULL THEN t.category_id ELSE c.parent_id END AS category_id, t.amount_cents, t.transaction_date
      FROM finance_transactions t LEFT JOIN finance_classifications c ON c.id = t.category_id
      WHERE t.reverted = 0 AND t.transaction_date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM finance_obligation_payments p WHERE p.cash_activity_id=t.id)
      UNION ALL SELECT 'refund', CASE WHEN c.parent_id IS NULL THEN t.category_id ELSE c.parent_id END, -r.amount_cents, r.transaction_date
      FROM finance_refunds r JOIN finance_transactions t ON t.id = r.expense_id LEFT JOIN finance_classifications c ON c.id = t.category_id
      WHERE r.reverted = 0 AND t.reverted = 0 AND r.transaction_date BETWEEN ? AND ?`)
      .safeIntegers().iterate(query.from, query.to, query.from, query.to) as Iterable<{ type: string; category_id: string | null; amount_cents: bigint; transaction_date: string }>;
    for (const row of rows) {
      const month = row.transaction_date.slice(0, 7), totals = months.get(month)!;
      const day = days.get(row.transaction_date) ?? { income: 0n, spending: 0n };
      days.set(row.transaction_date, day);
      if (row.type === "income") {
        totals.income += row.amount_cents;
        day.income += row.amount_cents;
      }
      else {
        totals.spending += row.amount_cents;
        day.spending += row.amount_cents;
        let category = spending.get(row.category_id);
        if (!category) { category = new Map(); spending.set(row.category_id, category); }
        category.set(month, (category.get(month) ?? 0n) + row.amount_cents);
      }
    }
    const daily: FinanceReport["daily"] = [];
    for (const cursor = new Date(`${query.from}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= query.to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10);
      const day = days.get(date);
      daily.push({ date, income_cents: exactCents(day?.income ?? 0n), spending_cents: exactCents(day?.spending ?? 0n) });
    }
    const categories = db.prepare("SELECT id, name FROM finance_classifications WHERE kind = 'category' AND type = 'expense' AND parent_id IS NULL ORDER BY name, id").all() as { id: string; name: string }[];
    const categoryRows: CategoryReport[] = [];
    let unbudgeted = 0n;
    for (const category of [...categories, { id: null, name: "Uncategorized" }]) {
      let actual = 0n, limits = 0n, withoutBudget = 0n, hasBudget = false, overspent = false, version = 0;
      for (const month of query.months) {
        const value = spending.get(category.id)?.get(month) ?? 0n;
        const budget = category.id ? readBudget(category.id, month) : null;
        version = budget?.version ?? 0;
        actual += value;
        if (budget?.limit_cents !== null && budget?.limit_cents !== undefined) {
          hasBudget = true; limits += BigInt(budget.limit_cents);
          if (value > BigInt(budget.limit_cents)) overspent = true;
        } else withoutBudget += value;
      }
      unbudgeted += withoutBudget;
      if (hasBudget || spending.has(category.id)) categoryRows.push({ category_id: category.id, name: category.name, spending_cents: exactCents(actual), budget_cents: hasBudget ? exactCents(limits) : null, budget_version: version, unbudgeted_cents: exactCents(withoutBudget), overspent });
    }
    const forecast = { income: 0n, spending: 0n };
    const pending = db.prepare("SELECT type, amount_cents FROM finance_plans WHERE status = 'pending' AND due_date BETWEEN ? AND ?")
      .safeIntegers().iterate(query.from, query.to) as Iterable<{ type: string; amount_cents: bigint }>;
    for (const plan of pending) forecast[plan.type === "income" ? "income" : "spending"] += plan.amount_cents;
    const totals = [...months.values()].reduce((sum, value) => ({ income: sum.income + value.income, spending: sum.spending + value.spending }), { income: 0n, spending: 0n });
    return { currency: "PHP", date_from: query.from, date_to: query.to, categories: categoryRows.slice(query.offset, query.offset + query.limit), total: categoryRows.length, limit: query.limit, offset: query.offset,
      income_cents: exactCents(totals.income), spending_cents: exactCents(totals.spending), unbudgeted_cents: exactCents(unbudgeted),
      daily,
      months: [...months].map(([month, value]) => ({ month, income_cents: exactCents(value.income), spending_cents: exactCents(value.spending) })), forecast: { available: true, spending_cents: exactCents(forecast.spending), income_cents: exactCents(forecast.income) } };
  })();
}
