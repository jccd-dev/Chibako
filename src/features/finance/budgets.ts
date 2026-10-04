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
export function getFinanceReport(actor: FinanceActor, input: unknown = {}): FinanceReport {
  authorizeFinance(actor, "finance:read");
  const query = reportDates(input), db = getDb();
  return db.transaction((): FinanceReport => {
    const months = new Map(query.months.map(month => [month, { income: 0n, spending: 0n }]));
    const spending = new Map<string | null, Map<string, bigint>>();
    const rows = db.prepare(`SELECT type, category_id, amount_cents, transaction_date FROM finance_transactions WHERE reverted = 0 AND transaction_date BETWEEN ? AND ?
      UNION ALL SELECT 'refund', t.category_id, -r.amount_cents, r.transaction_date FROM finance_refunds r JOIN finance_transactions t ON t.id = r.expense_id WHERE r.reverted = 0 AND t.reverted = 0 AND r.transaction_date BETWEEN ? AND ?`)
      .safeIntegers().iterate(query.from, query.to, query.from, query.to) as Iterable<{ type: string; category_id: string | null; amount_cents: bigint; transaction_date: string }>;
    for (const row of rows) {
      const month = row.transaction_date.slice(0, 7), totals = months.get(month)!;
      if (row.type === "income") totals.income += row.amount_cents;
      else {
        totals.spending += row.amount_cents;
        let category = spending.get(row.category_id);
        if (!category) { category = new Map(); spending.set(row.category_id, category); }
        category.set(month, (category.get(month) ?? 0n) + row.amount_cents);
      }
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
    const totals = [...months.values()].reduce((sum, value) => ({ income: sum.income + value.income, spending: sum.spending + value.spending }), { income: 0n, spending: 0n });
    return { currency: "PHP", date_from: query.from, date_to: query.to, categories: categoryRows.slice(query.offset, query.offset + query.limit), total: categoryRows.length, limit: query.limit, offset: query.offset,
      income_cents: exactCents(totals.income), spending_cents: exactCents(totals.spending), unbudgeted_cents: exactCents(unbudgeted),
      months: [...months].map(([month, value]) => ({ month, income_cents: exactCents(value.income), spending_cents: exactCents(value.spending) })), forecast: { available: false, spending_cents: null } };
  })();
}
