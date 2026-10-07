import type { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { FinanceError, type FinanceActor } from "./types";
import { financeMutation, parseFinance } from "./mutations";
import { decimalCents, exactCents } from "./money";
import { readAccountBalance } from "./accounts";
import { insertTransaction, readTransaction, validateTransactionClassifications } from "./activity";
import { financeBalanceWarnings } from "./reservations";
import { createObligationSchema, updateObligationSchema, getObligationSchema, listObligationsSchema, postObligationMovementSchema,
  postObligationPaymentSchema, closeObligationSchema, obligationHistorySchema,
  type FinanceObligation, type FinanceObligationList, type FinanceObligationHistory, type FinanceObligationHistoryEntry,
  type PostedObligationMovement, type PostedObligationPayment } from "./obligation-types";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
type ObligationRow = Omit<FinanceObligation, "currency" | "paid_cents" | "written_off_cents" | "outstanding_cents" | "status" | "overdue" | "archived"> & { archived: number };
export function readObligation(id: string, asOf = today()): FinanceObligation {
  const row = getDb().prepare("SELECT * FROM finance_obligations WHERE id = ?").get(id) as ObligationRow | undefined;
  if (!row) throw new FinanceError("Obligation not found", 404, "not_found");
  let principal = BigInt(row.opening_principal_cents);
  const effects = getDb().prepare("SELECT amount_cents FROM finance_obligation_movements WHERE obligation_id = ? AND reverted = 0").safeIntegers()
    .iterate(id) as Iterable<{ amount_cents: bigint }>;
  for (const effect of effects) principal += effect.amount_cents;
  const paymentRows = getDb().prepare(`SELECT p.amount_cents FROM finance_obligation_payments p
    JOIN finance_transactions t ON t.id = p.cash_activity_id WHERE p.obligation_id = ? AND t.reverted = 0`).safeIntegers()
    .iterate(id) as Iterable<{ amount_cents: bigint }>;
  let paid = 0n;
  for (const payment of paymentRows) { paid += payment.amount_cents; principal -= payment.amount_cents; }
  const writeoffRows = getDb().prepare("SELECT amount_cents FROM finance_obligation_writeoffs WHERE obligation_id = ?").safeIntegers()
    .iterate(id) as Iterable<{ amount_cents: bigint }>;
  let writtenOff = 0n;
  for (const writeoff of writeoffRows) { writtenOff += writeoff.amount_cents; principal -= writeoff.amount_cents; }
  const outstanding = exactCents(principal), paidCents = exactCents(paid), writtenOffCents = exactCents(writtenOff);
  const status: FinanceObligation["status"] = outstanding > 0 || (paidCents === 0 && writtenOffCents === 0) ? "open" : paidCents > 0 && writtenOffCents > 0 ? "settled" : writtenOffCents > 0 ? "written_off" : "paid";
  return { ...row, currency: "PHP", archived: row.archived === 1, outstanding_cents: outstanding,
    paid_cents: paidCents, written_off_cents: writtenOffCents, status,
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
const principalSql = `(o.opening_principal_cents + COALESCE((SELECT SUM(m.amount_cents) FROM finance_obligation_movements m WHERE m.obligation_id=o.id AND m.reverted=0),0)
  - COALESCE((SELECT SUM(p.amount_cents) FROM finance_obligation_payments p JOIN finance_transactions t ON t.id=p.cash_activity_id WHERE p.obligation_id=o.id AND t.reverted=0),0)
  - COALESCE((SELECT SUM(w.amount_cents) FROM finance_obligation_writeoffs w WHERE w.obligation_id=o.id),0) > 0)`;
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
    const payments = db.prepare("SELECT o.kind, p.amount_cents FROM finance_obligation_payments p JOIN finance_obligations o ON o.id=p.obligation_id JOIN finance_transactions t ON t.id=p.cash_activity_id WHERE t.reverted=0").safeIntegers().iterate() as Iterable<{ kind: "debt" | "receivable"; amount_cents: bigint }>;
    for (const row of payments) totals[row.kind] -= row.amount_cents;
    const writeoffs = db.prepare("SELECT o.kind, w.amount_cents FROM finance_obligation_writeoffs w JOIN finance_obligations o ON o.id=w.obligation_id").safeIntegers().iterate() as Iterable<{ kind: "debt" | "receivable"; amount_cents: bigint }>;
    for (const row of writeoffs) totals[row.kind] -= row.amount_cents;
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

export function postObligationPayment(actor: FinanceActor, input: unknown): PostedObligationPayment {
  authorizeFinance(actor, "finance:write");
  const payload = parseFinance(postObligationPaymentSchema, input);
  return financeMutation(actor, payload.request_id, "obligation.payment", payload, () => insertObligationPayment(payload));
}

// Caller owns the atomic mutation, so occurrence satisfaction and payment share one audit/retry boundary.
export function insertObligationPayment(payload: z.output<typeof postObligationPaymentSchema>) {
  const amount = decimalCents(payload.amount);
  if (amount <= 0) throw new FinanceError("Principal amount must be positive", 400, "invalid_input");
  const before = readObligation(payload.obligation_id);
  checkObligationVersion(before, payload.obligation_version);
  if (payload.cash_activity_id && getDb().prepare("SELECT 1 FROM finance_obligation_payments WHERE cash_activity_id=?").get(payload.cash_activity_id)) {
    throw new FinanceError("Cash activity already backs a principal payment", 409, "cash_activity_reused");
  }
  if (before.archived || before.outstanding_cents <= 0) throw new FinanceError("Choose an open obligation", 409, "not_outstanding");
  if (amount > before.outstanding_cents) throw new FinanceError("Payment cannot exceed outstanding principal", 409, "overpayment");
  const account = readAccountBalance(payload.account_id);
  if (account.archived || account.kind !== "money") throw new FinanceError("Choose an active money account", 400, "invalid_account");
  const type = before.kind === "debt" ? "expense" : "income";
  let activityId: string, cashActivityBefore: ReturnType<typeof readTransaction> | null = null;
  if (payload.cash_activity_id) {
    const cash = getDb().prepare(`SELECT t.id,t.type,t.account_id,t.amount_cents,t.transaction_date,t.version,t.hidden,t.reverted,
      EXISTS(SELECT 1 FROM finance_refunds r WHERE r.expense_id=t.id) AS refunded,
      (EXISTS(SELECT 1 FROM finance_movements m WHERE m.fee_transaction_id=t.id) OR EXISTS(SELECT 1 FROM finance_obligation_payments p WHERE p.fee_transaction_id=t.id)) AS transfer_fee,
      EXISTS(SELECT 1 FROM finance_plans p WHERE p.transaction_id=t.id) AS plan_linked
      FROM finance_transactions t WHERE t.id=?`).get(payload.cash_activity_id) as {
        id: string; type: string; account_id: string; amount_cents: number; transaction_date: string;
        version: number; hidden: number; reverted: number; refunded: number; transfer_fee: number; plan_linked: number;
      } | undefined;
    if (!cash || cash.type !== type || cash.account_id !== account.id || cash.amount_cents !== amount || cash.transaction_date !== payload.transaction_date
      || cash.version !== payload.cash_activity_version || cash.hidden || cash.reverted || cash.refunded || cash.transfer_fee || cash.plan_linked) {
      throw new FinanceError("Selected cash activity must be active, compatible, unlinked and match account, amount and date", 409, "invalid_cash_activity");
    }
    if (cash.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Activity version limit reached", 409, "version_conflict");
    activityId = cash.id;
    cashActivityBefore = readTransaction(cash.id, true);
  } else {
    activityId = insertTransaction({ type, account_id: account.id, amount_cents: amount, transaction_date: payload.transaction_date,
      category_id: null, subcategory_id: null, text: payload.text, tag_ids: [] });
  }
  let feeId: string | null = null;
  if (payload.fee) {
    const feeAmount = decimalCents(payload.fee.amount);
    if (feeAmount <= 0) throw new FinanceError("Interest/fee amount must be positive", 400, "invalid_input");
    validateTransactionClassifications({ ...payload.fee, tag_ids: [] });
    feeId = insertTransaction({ ...payload.fee, account_id: account.id, amount_cents: feeAmount,
      transaction_date: payload.transaction_date, text: payload.text, tag_ids: [] });
  }
  getDb().prepare("INSERT INTO finance_obligation_payments (id,obligation_id,cash_activity_id,fee_transaction_id,amount_cents,created_at) VALUES (?,?,?,?,?,?)")
    .run(randomUUID(), before.id, activityId, feeId, amount, now());
  if (payload.cash_activity_id) getDb().prepare("UPDATE finance_transactions SET version=version+1,updated_at=? WHERE id=?").run(now(), activityId);
  bumpObligation(before.id);
  const transaction = readTransaction(activityId, false);
  const balance = readAccountBalance(account.id);
  const balances = [{ account_id: account.id, balance_cents: balance.balance_cents }];
  const obligation = readObligation(before.id);
  const result: PostedObligationPayment = { transaction, fee: feeId ? readTransaction(feeId, false) : null, balances, ...financeBalanceWarnings(balances), obligation, principal_change_cents: -amount };
  return { result, affectedIds: [activityId, before.id, account.id, ...(feeId ? [feeId] : [])], before: { obligation: before, cash_activity: cashActivityBefore, account },
    after: { obligation, transaction: readTransaction(activityId, true), fee: result.fee, balances } };
}

export function closeObligation(actor: FinanceActor, id: string, input: unknown): { obligation: FinanceObligation } {
  authorizeFinance(actor, "finance:manage");
  parseFinance(getObligationSchema, { id });
  const payload = parseFinance(closeObligationSchema, input), amount = decimalCents(payload.amount);
  return financeMutation(actor, payload.request_id, "obligation.close", { id, ...payload }, () => {
    const before = readObligation(id);
    checkObligationVersion(before, payload.version);
    if (before.archived) throw new FinanceError("Unarchive the obligation before closing it", 409, "invalid_obligation");
    if (before.outstanding_cents <= 0) throw new FinanceError("Obligation has no outstanding principal", 409, "not_outstanding");
    if (amount !== before.outstanding_cents) throw new FinanceError("Write-off must equal the remaining principal", 409, "writeoff_mismatch");
    getDb().prepare("INSERT INTO finance_obligation_writeoffs (id,obligation_id,amount_cents,reason,created_at) VALUES (?,?,?,?,?)")
      .run(randomUUID(), id, amount, payload.reason, now());
    bumpObligation(id);
    const obligation = readObligation(id);
    return { result: { obligation }, affectedIds: [id], before, after: { obligation, write_off: { amount_cents: amount, reason: payload.reason } } };
  });
}

export function getObligationPaymentHistory(actor: FinanceActor, id: string, input: unknown = {}): FinanceObligationHistory {
  authorizeFinance(actor, "finance:read");
  const query = parseFinance(obligationHistorySchema, { ...input as object, id }), db = getDb();
  return db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM finance_obligations WHERE id=?").get(id)) throw new FinanceError("Obligation not found", 404, "not_found");
    const union = `SELECT p.id,'payment' AS kind,p.amount_cents,t.transaction_date,t.version,t.hidden,t.reverted,
      p.cash_activity_id,t.text,NULL AS reason,a.id AS account_id,a.name AS account_name,t.type AS cash_type,t.amount_cents AS cash_amount,t.transaction_date AS cash_date,t.version AS cash_version,p.created_at
      FROM finance_obligation_payments p JOIN finance_transactions t ON t.id=p.cash_activity_id JOIN finance_accounts a ON a.id=t.account_id WHERE p.obligation_id=?
      UNION ALL SELECT w.id,'write_off',w.amount_cents,NULL,1,0,0,NULL,NULL,w.reason,NULL,NULL,NULL,NULL,NULL,NULL,w.created_at
      FROM finance_obligation_writeoffs w WHERE w.obligation_id=?`;
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM (${union})`).get(id, id) as { total: number };
    const rows = db.prepare(`SELECT * FROM (${union}) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(id, id, query.limit, query.offset) as Array<{
      id: string; kind: "payment" | "write_off"; amount_cents: number; transaction_date: string | null; version: number;
      hidden: number; reverted: number; cash_activity_id: string | null; text: string | null; reason: string | null;
      account_id: string | null; account_name: string | null; cash_type: "income" | "expense" | null;
      cash_amount: number | null; cash_date: string | null; cash_version: number | null;
    }>;
    const entries: FinanceObligationHistoryEntry[] = rows.map(row => ({ id: row.id, kind: row.kind, amount_cents: row.amount_cents,
      transaction_date: row.transaction_date, version: row.version, hidden: row.hidden === 1, reverted: row.reverted === 1, cash_activity_id: row.cash_activity_id,
      ...(query.include_details ? { text: row.text ?? "", reason: row.reason, cash_activity: row.cash_activity_id ? {
        id: row.cash_activity_id, type: row.cash_type!, account_id: row.account_id!, account_name: row.account_name!,
        amount_cents: row.cash_amount!, transaction_date: row.cash_date!, version: row.cash_version!,
      } : null } : {}) }));
    return { entries, total, limit: query.limit, offset: query.offset };
  })();
}
