import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { readAccountBalance } from "./accounts";
import { financeBalanceWarnings } from "./reservations";
import { activityTable as table, readTransaction, validateTransactionClassifications } from "./activity";
import type { FinanceTransaction } from "./activity-types";
import { FinanceError, getAccountSchema, type FinanceActor } from "./types";
import { exactCents, decimalCents } from "./money";
import { financeMutation, parseFinance } from "./mutations";
import { readObligation, checkObligationVersion, bumpObligation } from "./obligations";
import { reopenPlanForTransaction } from "./planning";
import { activityActionSchema, correctActivitySchema, recordRefundSchema, type CorrectedActivity } from "./correction-types";

function editable(record: FinanceTransaction, version: number) {
  if (record.version !== version || record.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Activity changed; refresh before editing", 409, "version_conflict");
  if (record.reverted) throw new FinanceError("Reverted activity cannot be changed", 409, "already_reverted");
}
function activeAccount(id: string, kind: "money" | "asset") {
  const account = readAccountBalance(id);
  if (account.archived || account.kind !== kind) throw new FinanceError(`Choose an active ${kind} account`, 400, "invalid_account");
}
function linkedFee(record: FinanceTransaction): FinanceTransaction | null {
  return record.fee_transaction_id ? readTransaction(record.fee_transaction_id, true) : null;
}
function accountIds(records: (FinanceTransaction | null)[]) {
  return [...new Set(records.flatMap(record => record ? [record.account_id, ...(record.destination_account_id ? [record.destination_account_id] : [])] : []))];
}
function outcome(id: string, ids: string[]): CorrectedActivity {
  const transaction = readTransaction(id, false);
  const balances = ids.map(account_id => ({ account_id, balance_cents: readAccountBalance(account_id).balance_cents }));
  const expense = transaction.expense_id ? readTransaction(transaction.expense_id, false) : null;
  return { transaction, fee: transaction.fee_transaction_id ? readTransaction(transaction.fee_transaction_id, false) : null, balances, ...financeBalanceWarnings(balances),
    ...(expense ? { expense: { id: expense.id, version: expense.version, amount_cents: expense.amount_cents, refunded_cents: expense.refunded_cents } } : {}) };
}
function bump(record: FinanceTransaction) {
  if (record.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Activity version limit reached", 409, "version_conflict");
  getDb().prepare(`UPDATE ${table(record)} SET version = version + 1, updated_at = ? WHERE id = ?`).run(now(), record.id);
}
function expenseForRefund(record: FinanceTransaction) {
  if (!record.expense_id) throw new FinanceError("Refund requires an expense", 400, "invalid_refund");
  return readTransaction(record.expense_id, true);
}
function validateRefundLimit(expense: FinanceTransaction, amount: number) {
  if (expense.type !== "expense" || expense.reverted) throw new FinanceError("Choose an active expense", 409, "invalid_refund");
  if (BigInt(expense.refunded_cents) + BigInt(amount) > BigInt(expense.amount_cents)) throw new FinanceError("Active refunds cannot exceed the expense amount", 409, "refund_limit");
}

export function recordRefund(actor: FinanceActor, expenseId: string, input: unknown): CorrectedActivity {
  authorizeFinance(actor, "finance:write");
  parseFinance(getAccountSchema, { id: expenseId });
  const { request_id, ...payload } = parseFinance(recordRefundSchema, input);
  const amount = decimalCents(payload.amount);
  if (amount <= 0) throw new FinanceError("Refund amount must be positive", 400, "invalid_input");
  return financeMutation(actor, request_id, "activity.refund", { id: expenseId, ...payload }, () => {
    const expense = readTransaction(expenseId, true);
    editable(expense, payload.version);
    validateRefundLimit(expense, amount);
    activeAccount(payload.account_id, "money");
    const id = randomUUID(), timestamp = now();
    getDb().prepare("INSERT INTO finance_refunds (id,expense_id,account_id,amount_cents,transaction_date,text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, expense.id, payload.account_id, amount, payload.transaction_date, payload.text, timestamp, timestamp);
    bump(expense);
    const result = outcome(id, [payload.account_id]);
    return { result, affectedIds: [expense.id, id, payload.account_id], before: { expense, refund: null }, after: { expense: readTransaction(expense.id, true), refund: readTransaction(id, true), balances: result.balances } };
  });
}

export function hideActivity(actor: FinanceActor, id: string, input: unknown): CorrectedActivity {
  return changeStatus(actor, id, input, "hide");
}
export function revertActivity(actor: FinanceActor, id: string, input: unknown): CorrectedActivity {
  return changeStatus(actor, id, input, "revert");
}
function changeStatus(actor: FinanceActor, id: string, input: unknown, operation: "hide" | "revert"): CorrectedActivity {
  authorizeFinance(actor, "finance:write");
  parseFinance(getAccountSchema, { id });
  const { request_id, ...payload } = parseFinance(activityActionSchema, input);
  return financeMutation(actor, request_id, `activity.${operation}`, { id, ...payload }, () => {
    const record = readTransaction(id, true), fee = linkedFee(record);
    const obligation = record.obligation_id ? readObligation(record.obligation_id) : null;
    if (obligation) checkObligationVersion(obligation, payload.obligation_version);
    else if (payload.obligation_version !== undefined) throw new FinanceError("This activity has no obligation", 400, "invalid_input");
    const expense = record.type === "refund" && operation === "revert" ? expenseForRefund(record) : null;
    if (operation === "hide") {
      if (record.version !== payload.version) throw new FinanceError("Activity changed; refresh before editing", 409, "version_conflict");
    } else editable(record, payload.version);
    if (operation === "revert" && record.linked_record_id) throw new FinanceError("Revert the linked transfer to cancel its fee together", 409, "linked_activity");
    for (const entry of [record, fee]) {
      if (!entry) continue;
      if (operation === "revert" && entry.refunded_cents > 0) throw new FinanceError("Revert active refunds before their expense", 409, "active_refunds");
      getDb().prepare(`UPDATE ${table(entry)} SET ${operation === "hide" ? "hidden" : "reverted"} = 1 WHERE id = ?`).run(entry.id);
      bump(entry);
    }
    if (expense) bump(expense);
    const plan = operation === "revert" ? reopenPlanForTransaction(id) : null;
    const ids = accountIds([record, fee]);
    if (obligation) bumpObligation(obligation.id);
    const result: CorrectedActivity = { ...outcome(id, ids), ...(plan ? { plan: plan.after } : {}),
      ...(obligation ? { obligation: readObligation(obligation.id), principal_change_cents: operation === "revert" ? -record.amount_cents : 0 } : {}) };
    return { result, affectedIds: [id, ...ids, ...(fee ? [fee.id] : []), ...(expense ? [expense.id] : []), ...(plan ? [plan.after.id] : []), ...(obligation ? [obligation.id] : [])], before: { transaction: record, fee, expense, ...(plan ? { plan: plan.before } : {}), ...(obligation ? { obligation } : {}) }, after: { transaction: readTransaction(id, true), fee: linkedFee(readTransaction(id, true)), expense: expense ? readTransaction(expense.id, true) : null, balances: result.balances, ...(plan ? { plan: plan.after } : {}), ...(obligation ? { obligation: result.obligation } : {}) } };
  });
}

export function correctActivity(actor: FinanceActor, id: string, input: unknown): CorrectedActivity {
  authorizeFinance(actor, "finance:write");
  parseFinance(getAccountSchema, { id });
  const { request_id, ...patch } = parseFinance(correctActivitySchema, input);
  return financeMutation(actor, request_id, "activity.correct", { id, ...patch }, () => {
    const before = readTransaction(id, true), fee = linkedFee(before);
    editable(before, patch.version);
    const obligation = before.obligation_id ? readObligation(before.obligation_id) : null;
    if (obligation) checkObligationVersion(obligation, patch.obligation_version);
    else if (patch.obligation_version !== undefined) throw new FinanceError("This activity has no obligation", 400, "invalid_input");
    const account = patch.account_id ?? before.account_id;
    const amount = patch.amount === undefined ? before.amount_cents : decimalCents(patch.amount);
    const date = patch.transaction_date ?? before.transaction_date;
    const category = patch.category_id === undefined ? before.category_id : patch.category_id;
    const subcategory = patch.subcategory_id === undefined ? before.subcategory_id : patch.subcategory_id;
    const tags = patch.tag_ids ?? before.tag_ids ?? [];
    const movement = before.type === "transfer" || before.type === "reconciliation" || before.type === "valuation" || !!obligation;
    if (before.type !== "transfer" && (patch.destination_account_id !== undefined || patch.fee !== undefined)) throw new FinanceError("Fields do not apply to this activity", 400, "invalid_input");
    if ((movement || before.type === "refund") && (patch.category_id !== undefined || patch.subcategory_id !== undefined)) throw new FinanceError("This activity inherits or excludes categories", 400, "invalid_category");
    if (before.linked_record_id && (account !== before.account_id || date !== before.transaction_date)) throw new FinanceError("Correct the linked transfer to move its fee together", 409, "linked_activity");
    if (account !== before.account_id) activeAccount(account, before.type === "valuation" ? "asset" : "money");
    if (before.type !== "reconciliation" && before.type !== "valuation" && amount <= 0) throw new FinanceError("Amount must be positive", 400, "invalid_input");
    if (before.type === "expense" && amount < before.refunded_cents) throw new FinanceError("Expense cannot be less than its active refunds", 409, "refund_limit");
    let expense: FinanceTransaction | null = null;
    if (before.type === "refund") {
      expense = expenseForRefund(before);
      validateRefundLimit({ ...expense, refunded_cents: exactCents(BigInt(expense.refunded_cents) - BigInt(before.amount_cents)) }, amount);
    }
    if (patch.category_id !== undefined || patch.subcategory_id !== undefined || patch.tag_ids !== undefined) {
      validateTransactionClassifications({ type: before.type === "income" ? "income" : "expense", category_id: movement || before.type === "refund" ? null : category, subcategory_id: movement || before.type === "refund" ? null : subcategory, tag_ids: tags });
    }
    const db = getDb();
    if (before.type === "transfer") {
      const destination = patch.destination_account_id ?? before.destination_account_id!;
      if (account === destination) throw new FinanceError("Choose different accounts", 400, "invalid_account");
      if (destination !== before.destination_account_id) activeAccount(destination, "money");
      db.prepare("UPDATE finance_movements SET account_id = ?, destination_account_id = ? WHERE id = ?").run(account, destination, id);
      if (fee) {
        editable(fee, patch.fee?.version ?? fee.version);
        const feeAmount = patch.fee ? decimalCents(patch.fee.amount) : fee.amount_cents;
        if (feeAmount <= 0 || feeAmount < fee.refunded_cents) throw new FinanceError("Fee cannot be less than its active refunds", 409, "refund_limit");
        if (patch.fee && (patch.fee.category_id !== fee.category_id || patch.fee.subcategory_id !== fee.subcategory_id)) {
          validateTransactionClassifications({ type: "expense", category_id: patch.fee.category_id, subcategory_id: patch.fee.subcategory_id, tag_ids: [] });
        }
        db.prepare("UPDATE finance_transactions SET account_id = ?, transaction_date = ?, amount_cents = ?, category_id = ?, subcategory_id = ? WHERE id = ?")
          .run(account, date, feeAmount, patch.fee ? patch.fee.category_id : fee.category_id, patch.fee ? patch.fee.subcategory_id : fee.subcategory_id, fee.id);
        bump(fee);
      } else if (patch.fee) throw new FinanceError("Transfer has no linked fee to correct", 400, "invalid_input");
    } else if (before.type === "reconciliation" || before.type === "valuation") {
      db.prepare("UPDATE finance_movements SET actual_balance_cents = ? WHERE id = ?").run(exactCents(BigInt(before.compared_balance_cents!) + BigInt(amount)), id);
    } else if (before.type !== "refund" && !obligation) {
      db.prepare("UPDATE finance_transactions SET category_id = ?, subcategory_id = ? WHERE id = ?").run(category, subcategory, id);
    }
    db.prepare(`UPDATE ${table(before)} SET account_id = ?, amount_cents = ?, transaction_date = ?, text = ?, tag_ids = ? WHERE id = ?`)
      .run(account, amount, date, patch.text ?? before.text ?? "", JSON.stringify(tags), id);
    bump(before);
    if (expense) bump(expense);
    if (obligation) bumpObligation(obligation.id);
    const after = readTransaction(id, true);
    const ids = accountIds([before, fee, after, linkedFee(after)]);
    const result: CorrectedActivity = { ...outcome(id, ids), ...(obligation ? { obligation: readObligation(obligation.id), principal_change_cents: exactCents(BigInt(amount) - BigInt(before.amount_cents)) } : {}) };
    return { result, affectedIds: [id, ...ids, ...(fee ? [fee.id] : []), ...(expense ? [expense.id] : []), ...(obligation ? [obligation.id] : [])], before: { transaction: before, fee, expense, ...(obligation ? { obligation } : {}) }, after: { transaction: after, fee: linkedFee(after), expense: expense ? readTransaction(expense.id, true) : null, balances: result.balances, ...(obligation ? { obligation: result.obligation } : {}) } };
  });
}
