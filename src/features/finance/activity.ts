import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { readAccountBalance } from "./accounts";
import { parseFinance, financeMutation } from "./mutations";
import { decimalCents, exactCents } from "./money";
import { readClassification } from "./classifications";
import {
  postTransactionSchema, listTransactionsSchema, getTransactionSchema, activityTotalsSchema,
  type FinanceTransaction, type ActivityPage, type ActivityTotals, type PostedTransaction,
} from "./activity-types";

const transactionSelect = "SELECT t.*, a.name AS account_name, c.name AS category_name, s.name AS subcategory_name FROM finance_transactions t JOIN finance_accounts a ON a.id = t.account_id LEFT JOIN finance_classifications c ON c.id = t.category_id LEFT JOIN finance_classifications s ON s.id = t.subcategory_id";

type TransactionRow = Omit<FinanceTransaction, "currency" | "tag_ids"> & { text: string; tag_ids: string; created_at: number; updated_at: number };
function transactionFromRow(row: TransactionRow, details: boolean): FinanceTransaction {
  const { text, tag_ids, created_at, updated_at, ...compact } = row;
  return { ...compact, currency: "PHP", ...(details ? { text, tag_ids: JSON.parse(tag_ids) as string[], created_at, updated_at } : {}) };
}
function readTransaction(id: string, details: boolean): FinanceTransaction {
  const row = getDb().prepare(`${transactionSelect} WHERE t.id = ?`).get(id) as TransactionRow | undefined;
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
  const { request_id, ...payload } = parseFinance(postTransactionSchema, input);
  const amount = decimalCents(payload.amount);
  if (amount <= 0) throw new FinanceError("Amount must be greater than zero", 400, "invalid_input");
  return financeMutation(actor, request_id, "transaction.post", payload, () => {
    const account = readAccountBalance(payload.account_id);
    if (account.kind !== "money" || account.archived) throw new FinanceError("Choose an active money account", 400, "invalid_account");
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
    const balance = exactCents(BigInt(account.balance_cents) + (payload.type === "income" ? BigInt(amount) : -BigInt(amount)));
    const id = randomUUID(), timestamp = now();
    getDb().prepare("INSERT INTO finance_transactions (id,type,account_id,amount_cents,transaction_date,category_id,subcategory_id,text,tag_ids,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)")
      .run(id, payload.type, account.id, amount, payload.transaction_date, payload.category_id, payload.subcategory_id, payload.text, JSON.stringify(payload.tag_ids), timestamp, timestamp);
    const result: PostedTransaction = { transaction: readTransaction(id, false), balance_cents: balance, warnings: balance < 0 ? ["negative_balance"] : [] };
    return { result, affectedIds: [id, account.id], before: null, after: readTransaction(id, true) };
  });
}
export function listTransactions(actor: FinanceActor, input: unknown = {}): ActivityPage {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(listTransactionsSchema, input);
  const clauses: string[] = [], values: (string | number)[] = [];
  for (const [key, operator] of [["date_from", ">="], ["date_to", "<="]] as const) {
    if (query[key]) { clauses.push(`t.transaction_date ${operator} ?`); values.push(query[key]); }
  }
  for (const key of ["account_id", "type"] as const) if (query[key]) { clauses.push(`t.${key} = ?`); values.push(query[key]); }
  if (query.category_id) { clauses.push("(t.category_id = ? OR t.subcategory_id = ?)"); values.push(query.category_id, query.category_id); }
  if (query.q) {
    const needle = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push("(t.text LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM finance_classifications c WHERE (c.id = t.category_id OR c.id = t.subcategory_id OR c.id IN (SELECT value FROM json_each(t.tag_ids))) AND c.name LIKE ? ESCAPE '\\'))");
    values.push(needle, needle);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM finance_transactions t ${where}`).get(...values) as { total: number };
    const rows = db.prepare(`${transactionSelect} ${where} ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`)
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
  const rows = getDb().prepare("SELECT type, amount_cents FROM finance_transactions WHERE transaction_date >= ? AND transaction_date <= ?")
    .safeIntegers().iterate(`${month}-01`, `${month}-31`) as Iterable<{ type: "income" | "expense"; amount_cents: bigint }>;
  for (const row of rows) totals[row.type] += row.amount_cents;
  return { currency: "PHP", month, income_cents: exactCents(totals.income), expense_cents: exactCents(totals.expense) };
}
