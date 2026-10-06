import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { financeMutation, parseFinance } from "./mutations";
import { decimalCents, exactCents } from "./money";
import { readAccountBalance } from "./accounts";
import { readTransaction, validateTransactionClassifications } from "./activity";
import { financeBalanceWarnings } from "./reservations";
import { createObligationSchema, updateObligationSchema, getObligationSchema, listObligationsSchema, postObligationMovementSchema,
  type FinanceObligation, type FinanceObligationList, type PostedObligationMovement } from "./obligation-types";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
type ObligationRow = Omit<FinanceObligation, "currency" | "outstanding_cents" | "overdue" | "archived"> & { archived: number };
export function readObligation(id: string, asOf = today()): FinanceObligation {
  const row = getDb().prepare("SELECT * FROM finance_obligations WHERE id = ?").get(id) as ObligationRow | undefined;
  if (!row) throw new FinanceError("Obligation not found", 404, "not_found");
  let principal = BigInt(row.opening_principal_cents);
  const effects = getDb().prepare("SELECT amount_cents FROM finance_obligation_movements WHERE obligation_id = ? AND reverted = 0").safeIntegers()
    .iterate(id) as Iterable<{ amount_cents: bigint }>;
  for (const effect of effects) principal += effect.amount_cents;
  const outstanding = exactCents(principal);
  return { ...row, currency: "PHP", archived: row.archived === 1, outstanding_cents: outstanding,
    overdue: outstanding > 0 && row.due_date !== null && row.due_date < asOf };
}
export function checkObligationVersion(record: FinanceObligation, version: number | undefined) {
  if (record.version !== version || record.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Obligation changed; refresh before editing", 409, "version_conflict");
}
export function bumpObligation(id: string) {
  const record = readObligation(id);
  if (record.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Obligation version limit reached", 409, "version_conflict");
  getDb().prepare("UPDATE finance_obligations SET version = version + 1, updated_at = ? WHERE id = ?").run(now(), id);
}
function insertObligation(kind: FinanceObligation["kind"], name: string, principal: number, dueDate: string | null) {
  const id = randomUUID(), timestamp = now();
  getDb().prepare("INSERT INTO finance_obligations (id,kind,name,opening_principal_cents,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, kind, name, principal, dueDate, timestamp, timestamp);
  return id;
}
export function createObligation(actor: FinanceActor, input: unknown): { obligation: FinanceObligation } {
  authorizeFinance(actor, "finance:manage");
  const { request_id, ...payload } = parseFinance(createObligationSchema, input);
  const principal = decimalCents(payload.principal);
  return financeMutation(actor, request_id, "obligation.create", payload, () => {
    const id = insertObligation(payload.kind, payload.name, principal, payload.due_date);
    const obligation = readObligation(id);
    return { result: { obligation }, affectedIds: [id], before: null, after: obligation };
  });
}
export function updateObligation(actor: FinanceActor, id: string, input: unknown): { obligation: FinanceObligation } {
  authorizeFinance(actor, "finance:manage");
  parseFinance(getObligationSchema, { id });
  const { request_id, ...patch } = parseFinance(updateObligationSchema, input);
  return financeMutation(actor, request_id, "obligation.update", { id, ...patch }, () => {
    const before = readObligation(id);
    checkObligationVersion(before, patch.version);
    getDb().prepare("UPDATE finance_obligations SET name = ?, due_date = ?, archived = ? WHERE id = ?")
      .run(patch.name ?? before.name, patch.due_date === undefined ? before.due_date : patch.due_date, Number(patch.archived ?? before.archived), id);
    bumpObligation(id);
    const obligation = readObligation(id);
    return { result: { obligation }, affectedIds: [id], before, after: obligation };
  });
}
export function getObligation(actor: FinanceActor, id: string, input: unknown = {}): FinanceObligation {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(getObligationSchema, { ...input as object, id });
  return getDb().transaction(() => readObligation(id, query.as_of))();
}
const principalSql = "(o.opening_principal_cents > 0 OR EXISTS (SELECT 1 FROM finance_obligation_movements m WHERE m.obligation_id = o.id AND m.reverted = 0))";
export function listObligations(actor: FinanceActor, input: unknown = {}): FinanceObligationList {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(listObligationsSchema, input), asOf = query.as_of ?? today();
  const clauses: string[] = [], values: (string | number)[] = [];
  if (query.kind) { clauses.push("o.kind = ?"); values.push(query.kind); }
  if (query.archived !== "all") { clauses.push("o.archived = ?"); values.push(query.archived === "true" ? 1 : 0); }
  if (query.overdue) { clauses.push(`o.due_date < ? AND ${principalSql}`); values.push(asOf); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM finance_obligations o ${where}`).get(...values) as { total: number };
    const ids = db.prepare(`SELECT o.id FROM finance_obligations o ${where} ORDER BY o.due_date IS NULL, o.due_date, o.created_at, o.id LIMIT ? OFFSET ?`).all(...values, query.limit, query.offset) as { id: string }[];
    const totals = { debt: 0n, receivable: 0n };
    const openings = db.prepare("SELECT kind, opening_principal_cents FROM finance_obligations").safeIntegers().iterate() as Iterable<{ kind: "debt" | "receivable"; opening_principal_cents: bigint }>;
    for (const row of openings) totals[row.kind] += row.opening_principal_cents;
    const movements = db.prepare("SELECT o.kind, m.amount_cents FROM finance_obligation_movements m JOIN finance_obligations o ON o.id = m.obligation_id WHERE m.reverted = 0").safeIntegers().iterate() as Iterable<{ kind: "debt" | "receivable"; amount_cents: bigint }>;
    for (const row of movements) totals[row.kind] += row.amount_cents;
    return { obligations: ids.map(row => readObligation(row.id, asOf)), total, limit: query.limit, offset: query.offset,
      currency: "PHP" as const, debt_cents: exactCents(totals.debt), receivable_cents: exactCents(totals.receivable) };
  })();
}
export function postObligationMovement(actor: FinanceActor, input: unknown): PostedObligationMovement {
  authorizeFinance(actor, "finance:write");
  const { request_id, ...payload } = parseFinance(postObligationMovementSchema, input);
  if (!payload.obligation_id) authorizeFinance(actor, "finance:manage");
  const amount = decimalCents(payload.amount);
  if (amount <= 0) throw new FinanceError("Principal amount must be positive", 400, "invalid_input");
  return financeMutation(actor, request_id, "obligation.post", payload, () => {
    const account = readAccountBalance(payload.account_id);
    if (account.archived || account.kind !== "money") throw new FinanceError("Choose an active money account", 400, "invalid_account");
    validateTransactionClassifications({ type: "expense", category_id: null, subcategory_id: null, tag_ids: payload.tag_ids });
    const kind = payload.type === "borrowing" ? "debt" : "receivable";
    const before = payload.obligation_id ? readObligation(payload.obligation_id) : null;
    if (before) {
      checkObligationVersion(before, payload.version);
      if (before.kind !== kind || before.archived) throw new FinanceError("Choose an active obligation of the matching kind", 400, "invalid_obligation");
    }
    const obligationId = before?.id ?? insertObligation(kind, payload.name!, 0, payload.due_date ?? null);
    const id = randomUUID(), timestamp = now();
    getDb().prepare("INSERT INTO finance_obligation_movements (id,obligation_id,type,account_id,amount_cents,transaction_date,text,tag_ids,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, obligationId, payload.type, account.id, amount, payload.transaction_date, payload.text, JSON.stringify(payload.tag_ids), timestamp, timestamp);
    if (before) bumpObligation(obligationId);
    const obligation = readObligation(obligationId);
    const balances = [{ account_id: account.id, balance_cents: readAccountBalance(account.id).balance_cents }];
    const result: PostedObligationMovement = { transaction: readTransaction(id, false), fee: null, balances, ...financeBalanceWarnings(balances), obligation, principal_change_cents: amount };
    return { result, affectedIds: [id, obligationId, account.id], before: { obligation: before, account }, after: { obligation, transaction: readTransaction(id, true), balances } };
  });
}
