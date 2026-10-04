import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { readAccountBalance } from "./accounts";
import { validateTransactionClassifications, insertTransaction, readTransaction } from "./activity";
import { decimalCents } from "./money";
import { parseFinance, financeMutation } from "./mutations";
import { createPlanSchema, getPlanSchema, listPlansSchema, updatePlanSchema, planActionSchema, postPlanSchema, matchPlanSchema, type FinancePlan, type PlanPage, type SatisfiedPlan } from "./planning-types";

const selection = `SELECT p.*, a.name AS account_name, c.name AS category_name FROM finance_plans p
  JOIN finance_accounts a ON a.id = p.account_id LEFT JOIN finance_classifications c ON c.id = p.category_id`;
type PlanRow = Omit<FinancePlan, "currency" | "tag_ids"> & { text: string; tag_ids: string; created_at: number; updated_at: number };
function fromRow(row: PlanRow, details: boolean): FinancePlan {
  const { text, tag_ids, created_at, updated_at, ...compact } = row;
  return { ...compact, currency: "PHP", ...(details ? { text, tag_ids: JSON.parse(tag_ids) as string[], created_at, updated_at } : {}) };
}
export function readPlan(id: string, details = false): FinancePlan {
  const row = getDb().prepare(`${selection} WHERE p.id = ?`).get(id) as PlanRow | undefined;
  if (!row) throw new FinanceError("Plan not found", 404, "not_found");
  return fromRow(row, details);
}
export function getPlan(actor: FinanceActor, id: string, input: unknown = {}): FinancePlan {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(getPlanSchema, { ...input as object, id });
  return readPlan(query.id, query.include_details);
}
export function listPlans(actor: FinanceActor, input: unknown = {}): PlanPage {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(listPlansSchema, input), clauses: string[] = [], values: (string | number)[] = [];
  for (const key of ["type", "account_id"] as const) if (query[key]) { clauses.push(`p.${key} = ?`); values.push(query[key]!); }
  if (query.status !== "all") { clauses.push("p.status = ?"); values.push(query.status); }
  if (query.date_from) { clauses.push("p.due_date >= ?"); values.push(query.date_from); }
  if (query.date_to) { clauses.push("p.due_date <= ?"); values.push(query.date_to); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM finance_plans p ${where}`).get(...values) as { total: number };
    const rows = db.prepare(`${selection} ${where} ORDER BY p.due_date, p.id LIMIT ? OFFSET ?`).all(...values, query.limit, query.offset) as PlanRow[];
    return { plans: rows.map(row => fromRow(row, query.include_details)), total, limit: query.limit, offset: query.offset };
  })();
}
function pendingPlan(id: string, version: number) {
  const plan = readPlan(id, true);
  if (plan.version !== version || plan.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Plan changed; refresh before editing", 409, "version_conflict");
  if (plan.status !== "pending") throw new FinanceError("Only pending plans can be changed or satisfied", 409, "not_pending");
  return plan;
}
function validatePlanAccount(id: string) {
  const account = readAccountBalance(id);
  if (account.kind !== "money" || account.archived) throw new FinanceError("Choose an active money account", 400, "invalid_account");
}
function positiveAmount(value: string) {
  const amount = decimalCents(value);
  if (amount <= 0) throw new FinanceError("Amount must be greater than zero", 400, "invalid_input");
  return amount;
}
export function createPlan(actor: FinanceActor, input: unknown): { plan: FinancePlan } {
  authorizeFinance(actor, "finance:write");
  const { request_id, ...payload } = parseFinance(createPlanSchema, input), amount = positiveAmount(payload.amount);
  return financeMutation(actor, request_id, "plan.create", payload, () => {
    validatePlanAccount(payload.account_id); validateTransactionClassifications(payload);
    const id = randomUUID(), timestamp = now();
    getDb().prepare("INSERT INTO finance_plans (id,type,account_id,amount_cents,due_date,category_id,subcategory_id,text,tag_ids,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, payload.type, payload.account_id, amount, payload.due_date, payload.category_id, payload.subcategory_id, payload.text, JSON.stringify(payload.tag_ids), timestamp, timestamp);
    return { result: { plan: readPlan(id) }, affectedIds: [id], before: null, after: readPlan(id, true) };
  });
}
export function updatePlan(actor: FinanceActor, id: string, input: unknown): { plan: FinancePlan } {
  authorizeFinance(actor, "finance:write"); parseFinance(getPlanSchema, { id });
  const { request_id, ...patch } = parseFinance(updatePlanSchema, input);
  return financeMutation(actor, request_id, "plan.update", { id, ...patch }, () => {
    const before = pendingPlan(id, patch.version);
    const after = { ...before, ...patch, amount_cents: patch.amount === undefined ? before.amount_cents : positiveAmount(patch.amount), tag_ids: patch.tag_ids ?? before.tag_ids ?? [] };
    if (after.account_id !== before.account_id) validatePlanAccount(after.account_id);
    if (patch.type !== undefined || patch.category_id !== undefined || patch.subcategory_id !== undefined || patch.tag_ids !== undefined) validateTransactionClassifications(after);
    getDb().prepare("UPDATE finance_plans SET type=?,account_id=?,amount_cents=?,due_date=?,category_id=?,subcategory_id=?,text=?,tag_ids=?,version=version+1,updated_at=? WHERE id=?")
      .run(after.type, after.account_id, after.amount_cents, after.due_date, after.category_id, after.subcategory_id, after.text ?? "", JSON.stringify(after.tag_ids), now(), id);
    return { result: { plan: readPlan(id) }, affectedIds: [id], before, after: readPlan(id, true) };
  });
}
function satisfy(plan: FinancePlan, transactionId: string): SatisfiedPlan {
  getDb().prepare("UPDATE finance_plans SET status='satisfied',transaction_id=?,version=version+1,updated_at=? WHERE id=?").run(transactionId, now(), plan.id);
  const transaction = readTransaction(transactionId, false), balance = readAccountBalance(transaction.account_id).balance_cents;
  return { plan: readPlan(plan.id), transaction, balance_cents: balance, warnings: balance < 0 ? ["negative_balance"] : [] };
}
export function postPlan(actor: FinanceActor, id: string, input: unknown): SatisfiedPlan {
  authorizeFinance(actor, "finance:write"); parseFinance(getPlanSchema, { id });
  const { request_id, ...payload } = parseFinance(postPlanSchema, input), amount = positiveAmount(payload.amount);
  return financeMutation(actor, request_id, "plan.post", { id, ...payload }, () => {
    const before = pendingPlan(id, payload.version);
    validatePlanAccount(payload.account_id);
    validateTransactionClassifications({ ...before, tag_ids: before.tag_ids ?? [] });
    const transactionId = insertTransaction({ type: before.type, account_id: payload.account_id, amount_cents: amount,
      transaction_date: payload.transaction_date, category_id: before.category_id, subcategory_id: before.subcategory_id,
      text: before.text ?? "", tag_ids: before.tag_ids ?? [] });
    const result = satisfy(before, transactionId);
    return { result, affectedIds: [id, transactionId, payload.account_id], before: { plan: before, transaction: null }, after: { ...result, transaction: readTransaction(transactionId, true) } };
  });
}
export function matchPlan(actor: FinanceActor, id: string, input: unknown): SatisfiedPlan {
  authorizeFinance(actor, "finance:write"); parseFinance(getPlanSchema, { id });
  const { request_id, ...payload } = parseFinance(matchPlanSchema, input);
  return financeMutation(actor, request_id, "plan.match", { id, ...payload }, () => {
    const before = pendingPlan(id, payload.version), transaction = readTransaction(payload.transaction_id, true), db = getDb();
    if (transaction.reverted || transaction.type !== before.type || transaction.linked_record_id) throw new FinanceError("Select unreverted manual activity of the same income/expense type, excluding transfer fees", 409, "invalid_match");
    if (db.prepare("SELECT id FROM finance_plans WHERE transaction_id = ?").get(transaction.id)) throw new FinanceError("Transaction already satisfies a plan", 409, "already_matched");
    if (transaction.version !== payload.transaction_version || transaction.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Activity changed; refresh before matching", 409, "version_conflict");
    db.prepare("UPDATE finance_transactions SET version=version+1,updated_at=? WHERE id=?").run(now(), transaction.id);
    const result = satisfy(before, transaction.id);
    return { result, affectedIds: [id, transaction.id, transaction.account_id], before: { plan: before, transaction }, after: { ...result, transaction: readTransaction(transaction.id, true) } };
  });
}
export function reopenPlanForTransaction(transactionId: string): { before: FinancePlan; after: FinancePlan } | null {
  const db = getDb(), row = db.prepare("SELECT id FROM finance_plans WHERE transaction_id = ? AND status = 'satisfied'").get(transactionId) as { id: string } | undefined;
  if (!row) return null;
  const before = readPlan(row.id, true);
  if (before.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Plan version limit reached", 409, "version_conflict");
  db.prepare("UPDATE finance_plans SET status='pending',transaction_id=NULL,version=version+1,updated_at=? WHERE id=?").run(now(), row.id);
  return { before, after: readPlan(row.id) };
}
export function cancelPlan(actor: FinanceActor, id: string, input: unknown): { plan: FinancePlan } {
  authorizeFinance(actor, "finance:write"); parseFinance(getPlanSchema, { id });
  const { request_id, ...payload } = parseFinance(planActionSchema, input);
  return financeMutation(actor, request_id, "plan.cancel", { id, ...payload }, () => {
    const before = pendingPlan(id, payload.version);
    getDb().prepare("UPDATE finance_plans SET status='cancelled',version=version+1,updated_at=? WHERE id=?").run(now(), id);
    return { result: { plan: readPlan(id) }, affectedIds: [id], before, after: readPlan(id, true) };
  });
}
