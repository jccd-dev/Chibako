import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance, authorizeFinanceNotes } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { readAccountBalance } from "./accounts";
import { financeBalanceWarnings } from "./reservations";
import { parseFinance, financeMutation } from "./mutations";
import { decimalCents, exactCents } from "./money";
import { readClassification } from "./classifications";
import { replaceActivityNoteLinks } from "./note-link-storage";
import {
  postTransactionSchema, listTransactionsSchema, getTransactionSchema, activityTotalsSchema,
  type FinanceTransaction, type ActivityPage, type ActivityTotals, type PostedTransaction,
} from "./activity-types";

export function activityTable(record: FinanceTransaction) {
  if (record.obligation_id) return "finance_obligation_movements";
  return record.type === "refund" ? "finance_refunds" : record.type === "income" || record.type === "expense" ? "finance_transactions" : "finance_movements";
}

const activityRows = `WITH activity AS (
  SELECT t.id, t.type, t.account_id, t.amount_cents, t.transaction_date, t.category_id, t.subcategory_id, t.text, t.tag_ids,
    t.version, t.created_at, t.updated_at, t.hidden, t.reverted,
    NULL AS destination_account_id, m.id AS linked_record_id, NULL AS fee_transaction_id,
    NULL AS compared_balance_cents, NULL AS actual_balance_cents, NULL AS expense_id,
    COALESCE((SELECT SUM(r.amount_cents) FROM finance_refunds r WHERE r.expense_id = t.id AND r.reverted = 0), 0) AS refunded_cents
  FROM finance_transactions t LEFT JOIN finance_movements m ON m.fee_transaction_id = t.id
  UNION ALL
  SELECT id, type, account_id, amount_cents, transaction_date, NULL, NULL, text, tag_ids, version, created_at, updated_at, hidden, reverted,
    destination_account_id, NULL, fee_transaction_id, compared_balance_cents, actual_balance_cents, NULL, 0 FROM finance_movements
  UNION ALL
  SELECT r.id, 'refund', r.account_id, r.amount_cents, r.transaction_date, t.category_id, t.subcategory_id, r.text, r.tag_ids,
    r.version, r.created_at, r.updated_at, r.hidden, r.reverted, NULL, NULL, NULL, NULL, NULL, r.expense_id, 0
  FROM finance_refunds r JOIN finance_transactions t ON t.id = r.expense_id
  UNION ALL
  SELECT id, type, account_id, amount_cents, transaction_date, NULL, NULL, text, tag_ids, version, created_at, updated_at, hidden, reverted,
    NULL, NULL, NULL, NULL, NULL, NULL, 0 FROM finance_obligation_movements
)`;
const transactionSelect = "SELECT t.*, om.obligation_id, o.version AS obligation_version, a.name AS account_name, d.name AS destination_account_name, c.name AS category_name, s.name AS subcategory_name FROM activity t JOIN finance_accounts a ON a.id = t.account_id LEFT JOIN finance_accounts d ON d.id = t.destination_account_id LEFT JOIN finance_classifications c ON c.id = t.category_id LEFT JOIN finance_classifications s ON s.id = t.subcategory_id LEFT JOIN finance_obligation_movements om ON om.id = t.id LEFT JOIN finance_obligations o ON o.id = om.obligation_id";

type TransactionRow = Omit<FinanceTransaction, "currency" | "tag_ids" | "hidden" | "reverted"> & { hidden: number; reverted: number; text: string; tag_ids: string; created_at: number; updated_at: number };
function transactionFromRow(row: TransactionRow, details: boolean): FinanceTransaction {
  const { text, tag_ids, created_at, updated_at, ...compact } = row;
  return { ...compact, hidden: row.hidden === 1, reverted: row.reverted === 1, currency: "PHP", ...(details ? { text, tag_ids: JSON.parse(tag_ids) as string[], created_at, updated_at } : {}) };
}
export function readTransaction(id: string, details: boolean): FinanceTransaction {
  const row = getDb().prepare(`${activityRows} ${transactionSelect} WHERE t.id = ?`).get(id) as TransactionRow | undefined;
  if (!row) throw new FinanceError("Transaction not found", 404, "not_found");
  return transactionFromRow(row, details);
}
export function getTransaction(actor: FinanceActor, id: string, input: unknown = {}): FinanceTransaction {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(getTransactionSchema, { ...input as object, id });
  return readTransaction(query.id, query.include_details);
}
export function postTransaction(actor: FinanceActor, input: unknown): PostedTransaction {
  authorizeFinance(actor, "finance:write");
  const { request_id, note_ids, ...payload } = parseFinance(postTransactionSchema, input);
  if (note_ids.length) authorizeFinanceNotes(actor);
  const amount = decimalCents(payload.amount);
  if (amount <= 0) throw new FinanceError("Amount must be greater than zero", 400, "invalid_input");
  return financeMutation(actor, request_id, "transaction.post", note_ids.length ? { ...payload, note_ids } : payload, () => {
    const account = readAccountBalance(payload.account_id);
    if (account.kind !== "money" || account.archived) throw new FinanceError("Choose an active money account", 400, "invalid_account");
    validateTransactionClassifications(payload);
    const balance = exactCents(BigInt(account.balance_cents) + (payload.type === "income" ? BigInt(amount) : -BigInt(amount)));
    const id = insertTransaction({ ...payload, amount_cents: amount });
    replaceActivityNoteLinks(id, note_ids);
    const result: PostedTransaction = { transaction: readTransaction(id, false), balance_cents: balance, ...financeBalanceWarnings([{ account_id: account.id, balance_cents: balance }]) };
    return { result, affectedIds: [id, account.id, ...note_ids], before: null, after: { ...readTransaction(id, true), note_ids } };
  });
}

export function validateTransactionClassifications(payload: { type: "income" | "expense"; category_id: string | null; subcategory_id: string | null; tag_ids: string[] }) {
    if (payload.category_id) {
      const category = readClassification(payload.category_id);
      if (category.kind !== "category" || category.type !== payload.type || category.parent_id || category.archived) {
        throw new FinanceError("Choose an active category for this transaction type", 400, "invalid_category");
      }
    }
    if (payload.subcategory_id) {
      const subcategory = readClassification(payload.subcategory_id);
      if (!payload.category_id || subcategory.parent_id !== payload.category_id || subcategory.type !== payload.type || subcategory.archived) {
        throw new FinanceError("Subcategory must belong to the selected category", 400, "invalid_category");
      }
    }
    for (const id of payload.tag_ids) {
      const tag = readClassification(id);
      if (tag.kind !== "tag" || tag.archived) throw new FinanceError("Choose active tags", 400, "invalid_tag");
    }
}
export function insertTransaction(payload: { type: "income" | "expense"; account_id: string; amount_cents: number; transaction_date: string; category_id: string | null; subcategory_id: string | null; text: string; tag_ids: string[] }): string {
  const id = randomUUID(), timestamp = now();
  getDb().prepare("INSERT INTO finance_transactions (id,type,account_id,amount_cents,transaction_date,category_id,subcategory_id,text,tag_ids,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)")
    .run(id, payload.type, payload.account_id, payload.amount_cents, payload.transaction_date, payload.category_id, payload.subcategory_id, payload.text, JSON.stringify(payload.tag_ids), timestamp, timestamp);
  return id;
}
export function listTransactions(actor: FinanceActor, input: unknown = {}): ActivityPage {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(listTransactionsSchema, input);
  const clauses: string[] = [], values: (string | number)[] = [];
  for (const flag of ["hidden", "reverted"] as const) {
    if (query[flag] !== "all") { clauses.push(`t.${flag} = ?`); values.push(query[flag] === "true" ? 1 : 0); }
  }
  for (const [key, operator] of [["date_from", ">="], ["date_to", "<="]] as const) {
    if (query[key]) { clauses.push(`t.transaction_date ${operator} ?`); values.push(query[key]); }
  }
  if (query.matchable) clauses.push("t.type IN ('income','expense') AND t.reverted = 0 AND t.linked_record_id IS NULL AND NOT EXISTS (SELECT 1 FROM finance_plans p WHERE p.transaction_id = t.id)");
  if (query.account_id) { clauses.push("(t.account_id = ? OR t.destination_account_id = ?)"); values.push(query.account_id, query.account_id); }
  if (query.obligation_id) { clauses.push("EXISTS (SELECT 1 FROM finance_obligation_movements om WHERE om.id = t.id AND om.obligation_id = ?)"); values.push(query.obligation_id); }
  if (query.type) { clauses.push("t.type = ?"); values.push(query.type); }
  if (query.category_id) { clauses.push("(t.category_id = ? OR t.subcategory_id = ?)"); values.push(query.category_id, query.category_id); }
  if (query.q) {
    const needle = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push("(t.text LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM finance_classifications c WHERE (c.id = t.category_id OR c.id = t.subcategory_id OR c.id IN (SELECT value FROM json_each(t.tag_ids))) AND c.name LIKE ? ESCAPE '\\'))");
    values.push(needle, needle);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare(`${activityRows} SELECT COUNT(*) AS total FROM activity t ${where}`).get(...values) as { total: number };
    const rows = db.prepare(`${activityRows} ${transactionSelect} ${where} ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`)
      .all(...values, query.limit, query.offset) as TransactionRow[];
    return { transactions: rows.map(row => transactionFromRow(row, query.include_details)), total, limit: query.limit, offset: query.offset };
  })();
}
export function getActivityTotals(actor: FinanceActor, input: unknown = {}): ActivityTotals {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(activityTotalsSchema, input);
  const date = new Date();
  const month = query.month ?? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const totals = { income: 0n, expense: 0n };
  const rows = getDb().prepare("SELECT type, amount_cents FROM finance_transactions WHERE reverted = 0 AND transaction_date >= ? AND transaction_date <= ?")
    .safeIntegers().iterate(`${month}-01`, `${month}-31`) as Iterable<{ type: "income" | "expense"; amount_cents: bigint }>;
  for (const row of rows) totals[row.type] += row.amount_cents;
  const refunds = getDb().prepare("SELECT amount_cents FROM finance_refunds WHERE reverted = 0 AND transaction_date >= ? AND transaction_date <= ?")
    .safeIntegers().iterate(`${month}-01`, `${month}-31`) as Iterable<{ amount_cents: bigint }>;
  for (const refund of refunds) totals.expense -= refund.amount_cents;
  return { currency: "PHP", month, income_cents: exactCents(totals.income), expense_cents: exactCents(totals.expense) };
}
