import { randomUUID } from "node:crypto";
import { getDb, now } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { parseFinance as parse, financeMutation } from "./mutations";
import { exactCents, decimalCents as openingCents } from "./money";
import { canSpendFromAccount, accountSummaryBucket, creditSettingsError, type CreditSettings } from "./account-policy";
import { localCalendarDate } from "./presentation";
import { statementDate, statementDueDate } from "./credit-statement";
import { readCreditCycles } from "./credit-cycles";
import type { FinanceCreditCycle } from "./credit-cycle-types";
import {
  createAccountSchema, updateAccountSchema, getAccountSchema, listAccountsSchema,
  FinanceError, type FinanceAccount, type FinanceActor, type FinanceAccountList, type FinanceSummary,
} from "./types";

type AccountRow = Omit<FinanceAccount, "archived" | "include_in_summary" | "balance_cents" | "planned_expense_cents" | "credit_hold_cents" | "spendable_cents" | "used_credit_cents" | "available_credit_cents" | "statement_date" | "statement_balance_cents" | "statement_confirmed" | "statement_version" | "estimated_statement_balance_cents" | "statement_difference_cents" | "minimum_due_cents" | "remaining_minimum_cents" | "remaining_due_cents" | "next_due_date"> & { archived: number; include_in_summary: number };

type CreditStatement = Pick<FinanceAccount, "statement_date" | "statement_balance_cents" | "statement_confirmed" | "statement_version" | "estimated_statement_balance_cents" | "statement_difference_cents" | "minimum_due_cents" | "remaining_minimum_cents" | "remaining_due_cents" | "next_due_date">;
const NO_STATEMENT: CreditStatement = { statement_date: null, statement_balance_cents: null, statement_confirmed: false, statement_version: null, estimated_statement_balance_cents: null, statement_difference_cents: null, minimum_due_cents: null, remaining_minimum_cents: null, remaining_due_cents: null, next_due_date: null };

/** Owed as of the last statement close, less payments and credits dated after it. Opening balance predates every statement. */
function creditStatement(row: AccountRow, asOf: string, selected?: FinanceCreditCycle): CreditStatement {
  if (row.kind !== "credit") return NO_STATEMENT;
  const estimatedClose = selected?.statement_date ?? (row.statement_day === null ? null : statementDate(row.statement_day, asOf));
  const confirmed = getDb().prepare("SELECT * FROM finance_credit_statements WHERE account_id=? AND statement_date<=? ORDER BY statement_date DESC LIMIT 1").get(row.id, selected ? selected.statement_date < asOf ? selected.statement_date : asOf : asOf) as { statement_date: string; due_date: string; balance_cents: number; minimum_due_cents: number; version: number } | undefined;
  const bank = confirmed && (estimatedClose === null || confirmed.statement_date >= estimatedClose) ? confirmed : null;
  const closed = bank?.statement_date ?? estimatedClose;
  if (closed === null) return NO_STATEMENT;
  const totals = getDb().prepare(`SELECT COALESCE(SUM(CASE WHEN effective_date <= @closed THEN cents END), 0) AS through,
    COALESCE(SUM(CASE WHEN effective_date > @closed AND effective_date <= @asOf AND cents > 0 THEN cents END), 0) AS credits FROM (
      SELECT transaction_date AS effective_date, CASE WHEN type = 'income' THEN amount_cents ELSE -amount_cents END AS cents FROM finance_transactions WHERE reverted = 0 AND account_id = @id
      UNION ALL SELECT transaction_date, CASE WHEN type = 'transfer' AND account_id = @id THEN -amount_cents ELSE amount_cents END FROM finance_movements WHERE reverted = 0 AND (account_id = @id OR destination_account_id = @id)
      UNION ALL SELECT transaction_date, amount_cents FROM finance_refunds WHERE reverted = 0 AND account_id = @id
      UNION ALL SELECT transaction_date, CASE WHEN type = 'borrowing' THEN amount_cents ELSE -amount_cents END FROM finance_obligation_movements WHERE reverted = 0 AND account_id = @id
    )`).safeIntegers().get({ id: row.id, closed, asOf }) as { through: bigint; credits: bigint };
  const balance = BigInt(row.opening_balance_cents) + totals.through;
  const owed = balance < 0n ? -balance : 0n;
  const statementBalance = bank ? BigInt(bank.balance_cents) : owed;
  const remaining = statementBalance - totals.credits;
  const minimum = bank ? BigInt(bank.minimum_due_cents) - totals.credits : null;
  return {
    statement_date: closed,
    statement_balance_cents: exactCents(statementBalance),
    statement_confirmed: bank !== null,
    statement_version: bank?.version ?? null,
    estimated_statement_balance_cents: exactCents(owed),
    statement_difference_cents: bank ? exactCents(statementBalance - owed) : null,
    minimum_due_cents: bank?.minimum_due_cents ?? null,
    remaining_minimum_cents: minimum === null ? null : exactCents(minimum > 0n ? minimum : 0n),
    remaining_due_cents: exactCents(remaining > 0n ? remaining : 0n),
    next_due_date: bank?.due_date ?? (row.due_mode === null || row.due_value === null ? null : statementDueDate(closed, row.due_mode, row.due_value)),
  };
}

function accountFromRow(row: AccountRow, asOf = localCalendarDate()): FinanceAccount {
  let balance = BigInt(row.opening_balance_cents) + BigInt(row.maintaining_balance_cents);
  const effects = getDb().prepare("SELECT type, amount_cents FROM finance_transactions WHERE reverted = 0 AND account_id = ?").safeIntegers()
    .iterate(row.id) as Iterable<{ type: string; amount_cents: bigint }>;
  for (const effect of effects) balance += effect.type === "income" ? effect.amount_cents : -effect.amount_cents;
  const movements = getDb().prepare("SELECT account_id, type, amount_cents FROM finance_movements WHERE reverted = 0 AND (account_id = ? OR destination_account_id = ?)").safeIntegers()
    .iterate(row.id, row.id) as Iterable<{ account_id: string; type: string; amount_cents: bigint }>;
  for (const effect of movements) balance += effect.type === "transfer" && effect.account_id === row.id ? -effect.amount_cents : effect.amount_cents;
  const refunds = getDb().prepare("SELECT amount_cents FROM finance_refunds WHERE account_id = ? AND reverted = 0").safeIntegers()
    .iterate(row.id) as Iterable<{ amount_cents: bigint }>;
  for (const refund of refunds) balance += refund.amount_cents;
  const principal = getDb().prepare("SELECT type, amount_cents FROM finance_obligation_movements WHERE account_id = ? AND reverted = 0").safeIntegers()
    .iterate(row.id) as Iterable<{ type: string; amount_cents: bigint }>;
  for (const effect of principal) balance += effect.type === "borrowing" ? effect.amount_cents : -effect.amount_cents;
  const goalMovements = getDb().prepare(`SELECT source_account_id, destination_account_id, amount_cents FROM finance_goal_movements
    WHERE source_account_id = ? OR destination_account_id = ?`).safeIntegers()
    .iterate(row.id, row.id) as Iterable<{ source_account_id: string | null; destination_account_id: string | null; amount_cents: bigint }>;
  for (const effect of goalMovements) {
    if (effect.source_account_id === row.id) balance -= effect.amount_cents;
    if (effect.destination_account_id === row.id) balance += effect.amount_cents;
  }
  const month = asOf.slice(0, 7);
  const plans = getDb().prepare("SELECT amount_cents FROM finance_plans WHERE account_id = ? AND type = 'expense' AND status = 'pending' AND due_date >= ? AND due_date <= ?")
    .safeIntegers().iterate(row.id, `${month}-01`, `${month}-31`) as Iterable<{ amount_cents: bigint }>;
  let planned = 0n;
  for (const plan of plans) planned += plan.amount_cents;
  let creditHold = 0n;
  if (row.kind === "money") {
    const cards = getDb().prepare("SELECT * FROM finance_accounts WHERE payment_account_id = ? AND kind = 'credit'").all(row.id) as AccountRow[];
    for (const card of cards) creditHold += BigInt(accountFromRow(card, asOf).used_credit_cents ?? 0);
  }
  const spendable = row.kind === "money" ? balance - BigInt(row.maintaining_balance_cents) - planned - creditHold : 0n;
  const used = balance < 0n ? -balance : 0n;
  const available = row.credit_limit_cents === null ? 0n : BigInt(row.credit_limit_cents) + balance;
  const credit = row.kind === "credit"
    ? { used_credit_cents: exactCents(used), available_credit_cents: exactCents(available > 0n ? available : 0n) }
    : { used_credit_cents: null, available_credit_cents: null };
  const cycles = readCreditCycles(row, asOf);
  const payable = cycles.find(cycle => cycle.remaining_due_cents > 0);
  const statement = creditStatement(row, asOf, payable);
  if (payable) Object.assign(statement, {
    statement_date: payable.statement_date, statement_balance_cents: payable.balance_cents,
    statement_confirmed: payable.confirmed, remaining_due_cents: payable.remaining_due_cents,
    minimum_due_cents: payable.minimum_due_cents, remaining_minimum_cents: payable.remaining_minimum_cents,
    next_due_date: payable.due_date,
  });
  else if (cycles.length) statement.next_due_date = null;
  return { ...row, ...credit, ...statement, credit_hold_cents: exactCents(creditHold), planned_expense_cents: exactCents(planned), spendable_cents: exactCents(spendable > 0n ? spendable : 0n), archived: row.archived === 1, include_in_summary: row.include_in_summary === 1, balance_cents: exactCents(balance) };
}

export function readAccountBalance(id: string): FinanceAccount {
  const row = getDb().prepare("SELECT * FROM finance_accounts WHERE id = ?").get(id) as AccountRow | undefined;
  if (!row) throw new FinanceError("Account not found", 404, "not_found");
  return accountFromRow(row);
}

export function requireSufficientFunds(account: Pick<FinanceAccount, "kind" | "credit_limit_cents"> & { balance_cents: number | bigint }, outgoingCents: number | bigint) {
  if (canSpendFromAccount(account, outgoingCents)) return;
  if (account.kind === "credit") throw new FinanceError("This exceeds the available credit on this card", 409, "credit_limit_exceeded");
  throw new FinanceError("Insufficient funds in this account", 409, "insufficient_funds");
}

/** One reminder per unpaid cycle, including the upcoming estimate. */
export function listCreditDueAccounts(actor: FinanceActor, asOf: string): FinanceAccount[] {
  authorizeFinance(actor, "finance:read");
  const rows = getDb().prepare("SELECT * FROM finance_accounts WHERE kind = 'credit' AND archived = 0 ORDER BY created_at, id").all() as AccountRow[];
  return rows.flatMap(row => {
    const account = accountFromRow(row, asOf);
    return readCreditCycles(row, asOf).filter(cycle => cycle.due_date !== null && cycle.remaining_due_cents > 0).map(cycle => ({
      ...account, statement_date: cycle.statement_date, statement_balance_cents: cycle.balance_cents,
      statement_confirmed: cycle.confirmed, remaining_due_cents: cycle.remaining_due_cents,
      minimum_due_cents: cycle.minimum_due_cents, remaining_minimum_cents: cycle.remaining_minimum_cents, next_due_date: cycle.due_date,
    }));
  });
}

export function getAccount(actor: FinanceActor, id: string): FinanceAccount {
  authorizeFinance(actor, "finance:read");
  return readAccountBalance(parse(getAccountSchema, { id }).id);
}

export function listAccounts(actor: FinanceActor, input: unknown = {}): FinanceAccountList {
  authorizeFinance(actor, "finance:read");
  const query = parse(listAccountsSchema, input);
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (query.archived !== "all") {
    conditions.push("archived = ?");
    values.push(query.archived === "true" ? 1 : 0);
  }
  if (query.kind) {
    conditions.push("kind = ?");
    values.push(query.kind);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const db = getDb();
  return db.transaction(() => {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM finance_accounts ${where}`).get(...values) as { total: number };
    const rows = db.prepare(`SELECT * FROM finance_accounts ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...values, query.limit, query.offset) as AccountRow[];
    return { accounts: rows.map(row => accountFromRow(row)), total, limit: query.limit, offset: query.offset };
  })();
}

export function getFinanceSummary(actor: FinanceActor): FinanceSummary {
  authorizeFinance(actor, "finance:read");
  // Archiving retains holdings; only explicit summary exclusion removes an account from these totals.
  const db = getDb();
  return db.transaction(() => {
    const rows = db.prepare("SELECT kind, opening_balance_cents, maintaining_balance_cents FROM finance_accounts WHERE include_in_summary = 1")
      .safeIntegers().iterate() as Iterable<{ kind: FinanceAccount["kind"]; opening_balance_cents: bigint; maintaining_balance_cents: bigint }>;
    const totals = { money: 0n, assets: 0n, credit: 0n };
    const summary: FinanceSummary = { currency: "PHP", money: { balance_cents: 0, account_count: 0 }, assets: { balance_cents: 0, account_count: 0 }, credit: { balance_cents: 0, account_count: 0 } };
    for (const row of rows) {
      const kind = accountSummaryBucket(row.kind);
      totals[kind] += row.opening_balance_cents + row.maintaining_balance_cents;
      summary[kind].account_count++;
    }
    const effects = db.prepare("SELECT a.kind, t.type, t.amount_cents FROM finance_transactions t JOIN finance_accounts a ON a.id = t.account_id WHERE t.reverted = 0 AND a.include_in_summary = 1")
      .safeIntegers().iterate() as Iterable<{ kind: FinanceAccount["kind"]; type: string; amount_cents: bigint }>;
    for (const effect of effects) totals[accountSummaryBucket(effect.kind)] += effect.type === "income" ? effect.amount_cents : -effect.amount_cents;
    const adjustments = db.prepare("SELECT a.kind, m.amount_cents FROM finance_movements m JOIN finance_accounts a ON a.id = m.account_id WHERE m.type != 'transfer' AND m.reverted = 0 AND a.include_in_summary = 1")
      .safeIntegers().iterate() as Iterable<{ kind: FinanceAccount["kind"]; amount_cents: bigint }>;
    for (const effect of adjustments) totals[accountSummaryBucket(effect.kind)] += effect.amount_cents;
    const transfers = db.prepare(`SELECT m.amount_cents, source.kind AS source_kind, source.include_in_summary AS source_included,
      destination.kind AS destination_kind, destination.include_in_summary AS destination_included
      FROM finance_movements m JOIN finance_accounts source ON source.id = m.account_id
      JOIN finance_accounts destination ON destination.id = m.destination_account_id WHERE m.type = 'transfer' AND m.reverted = 0`)
      .safeIntegers().iterate() as Iterable<{ amount_cents: bigint; source_kind: FinanceAccount["kind"]; source_included: bigint; destination_kind: FinanceAccount["kind"]; destination_included: bigint }>;
    for (const transfer of transfers) {
      totals[accountSummaryBucket(transfer.source_kind)] -= transfer.amount_cents * transfer.source_included;
      totals[accountSummaryBucket(transfer.destination_kind)] += transfer.amount_cents * transfer.destination_included;
    }
    const refunds = db.prepare("SELECT a.kind, r.amount_cents FROM finance_refunds r JOIN finance_accounts a ON a.id = r.account_id WHERE r.reverted = 0 AND a.include_in_summary = 1")
      .safeIntegers().iterate() as Iterable<{ kind: FinanceAccount["kind"]; amount_cents: bigint }>;
    for (const refund of refunds) totals[accountSummaryBucket(refund.kind)] += refund.amount_cents;
    const principal = db.prepare("SELECT m.type, m.amount_cents FROM finance_obligation_movements m JOIN finance_accounts a ON a.id = m.account_id WHERE m.reverted = 0 AND a.include_in_summary = 1").safeIntegers()
      .iterate() as Iterable<{ type: string; amount_cents: bigint }>;
    for (const effect of principal) totals.money += effect.type === "borrowing" ? effect.amount_cents : -effect.amount_cents;
    const goalMovements = db.prepare(`SELECT m.amount_cents, COALESCE(source.include_in_summary, 0) AS source_included,
      COALESCE(destination.include_in_summary, 0) AS destination_included FROM finance_goal_movements m
      LEFT JOIN finance_accounts source ON source.id = m.source_account_id
      LEFT JOIN finance_accounts destination ON destination.id = m.destination_account_id`).safeIntegers()
      .iterate() as Iterable<{ amount_cents: bigint; source_included: bigint; destination_included: bigint }>;
    for (const effect of goalMovements) totals.money += effect.amount_cents * (effect.destination_included - effect.source_included);
    // Unlinked savings remain money owned by the vault, outside account balances.
    const goalHoldings = db.prepare(`SELECT a.amount_cents FROM finance_goal_allocations a
      JOIN finance_goals g ON g.id = a.goal_id WHERE g.archived = 0 AND g.linked_account_id IS NULL`).safeIntegers()
      .iterate() as Iterable<{ amount_cents: bigint }>;
    for (const holding of goalHoldings) totals.money += holding.amount_cents;
    if (Object.values(totals).some((total) => total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER))) {
      throw new FinanceError("Combined balances exceed the supported exact-cent range", 422, "balance_out_of_range");
    }
    summary.money.balance_cents = exactCents(totals.money);
    summary.assets.balance_cents = exactCents(totals.assets);
    summary.credit.balance_cents = exactCents(totals.credit);
    return summary;
  })();
}

function mutateAccount(actor: FinanceActor, requestId: string, operation: string, payload: object, change: () => { before: FinanceAccount | null; after: FinanceAccount }): { account: FinanceAccount } {
  const result = financeMutation(actor, requestId, operation, payload, () => {
    const { before, after } = change();
    return { result: { account: after }, affectedIds: [after.id], before, after };
  });
  // Replayed results stored before newer account fields existed get their neutral values.
  const credit = { payment_account_id: null, credit_hold_cents: 0, credit_limit_cents: null, statement_day: null, due_mode: null, due_value: null, used_credit_cents: null, available_credit_cents: null, ...NO_STATEMENT };
  return { account: { ...credit, ...result.account, account_group: result.account.account_group ?? "", logo: result.account.logo ?? "", include_in_summary: result.account.include_in_summary ?? true, maintaining_balance_cents: result.account.maintaining_balance_cents ?? 0, planned_expense_cents: result.account.planned_expense_cents ?? 0, spendable_cents: result.account.spendable_cents ?? (result.account.kind === "money" ? Math.max(0, result.account.balance_cents) : 0) } };
}

function requireCreditSettings(kind: FinanceAccount["kind"], settings: CreditSettings) {
  const error = creditSettingsError(kind, settings);
  if (error) throw new FinanceError(error, 400, "invalid_input");
}

function requirePaymentAccount(kind: FinanceAccount["kind"], paymentAccountId: string | null) {
  if (paymentAccountId === null) return;
  const account = getDb().prepare("SELECT kind, archived FROM finance_accounts WHERE id=?").get(paymentAccountId) as { kind: string; archived: number } | undefined;
  if (kind !== "credit" || !account || account.kind !== "money" || account.archived) {
    throw new FinanceError("Choose an active money account to pay this credit card", 400, "invalid_payment_account");
  }
}

export function createAccount(actor: FinanceActor, input: unknown): { account: FinanceAccount } {
  authorizeFinance(actor, "finance:manage");
  const { request_id, ...payload } = parse(createAccountSchema, input);
  const cents = openingCents(payload.opening_balance);
  const maintaining = openingCents(payload.maintaining_balance);
  if (payload.kind !== "money" && maintaining !== 0) throw new FinanceError("Maintaining balance is only available for money accounts", 400, "invalid_input");
  const credit: CreditSettings = {
    credit_limit_cents: payload.credit_limit === undefined ? null : openingCents(payload.credit_limit),
    statement_day: payload.statement_day ?? null, due_mode: payload.due_mode ?? null, due_value: payload.due_value ?? null,
  };
  requireCreditSettings(payload.kind, credit);
  const { account_group, logo, include_in_summary, maintaining_balance, ...core } = payload;
  // Preserve retry fingerprints for accounts created before settings were added.
  const requestPayload = { ...core, ...(account_group ? { account_group } : {}), ...(logo ? { logo } : {}), ...(!include_in_summary ? { include_in_summary } : {}), ...(maintaining !== 0 ? { maintaining_balance } : {}) };
  return mutateAccount(actor, request_id, "account.create", requestPayload, () => {
    requirePaymentAccount(payload.kind, payload.payment_account_id ?? null);
    const id = randomUUID();
    const timestamp = now();
    getDb().prepare("INSERT INTO finance_accounts (id, name, kind, currency, opening_balance_cents, maintaining_balance_cents, account_group, logo, include_in_summary, archived, version, created_at, updated_at, credit_limit_cents, statement_day, due_mode, due_value, payment_account_id) VALUES (?,?,?,?,?,?,?,?,?,0,1,?,?,?,?,?,?,?)")
      .run(id, payload.name, payload.kind, payload.currency, cents, maintaining, payload.account_group, payload.logo, Number(payload.include_in_summary), timestamp, timestamp, credit.credit_limit_cents, credit.statement_day, credit.due_mode, credit.due_value, payload.payment_account_id ?? null);
    return { before: null, after: readAccountBalance(id) };
  });
}

export function updateAccount(actor: FinanceActor, id: string, input: unknown): { account: FinanceAccount } {
  authorizeFinance(actor, "finance:manage");
  parse(getAccountSchema, { id });
  const { request_id, ...patch } = parse(updateAccountSchema, input);
  return mutateAccount(actor, request_id, "account.update", { id, ...patch }, () => {
    const before = readAccountBalance(id);
    if (patch.version !== before.version) throw new FinanceError("Account changed; refresh before editing", 409, "version_conflict");
    if (before.version === Number.MAX_SAFE_INTEGER) throw new FinanceError("Account version limit reached", 409, "version_conflict");
    const maintaining = patch.maintaining_balance === undefined ? before.maintaining_balance_cents : openingCents(patch.maintaining_balance);
    if (before.kind !== "money" && maintaining !== 0) throw new FinanceError("Maintaining balance is only available for money accounts", 400, "invalid_input");
    const credit: CreditSettings = {
      credit_limit_cents: patch.credit_limit === undefined ? before.credit_limit_cents : openingCents(patch.credit_limit),
      statement_day: patch.statement_day === undefined ? before.statement_day : patch.statement_day,
      due_mode: patch.due_mode === undefined ? before.due_mode : patch.due_mode,
      due_value: patch.due_value === undefined ? before.due_value : patch.due_value,
    };
    requireCreditSettings(before.kind, credit);
    const paymentAccountId = patch.payment_account_id === undefined ? before.payment_account_id : patch.payment_account_id;
    requirePaymentAccount(before.kind, paymentAccountId);
    if (patch.archived && getDb().prepare("SELECT 1 FROM finance_accounts WHERE payment_account_id=? LIMIT 1").get(id)) {
      throw new FinanceError("Unlink credit cards before archiving their payment account", 409, "payment_account_in_use");
    }
    getDb().prepare("UPDATE finance_accounts SET name = ?, archived = ?, account_group = ?, logo = ?, include_in_summary = ?, maintaining_balance_cents = ?, credit_limit_cents = ?, statement_day = ?, due_mode = ?, due_value = ?, payment_account_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(patch.name ?? before.name, Number(patch.archived ?? before.archived), patch.account_group ?? before.account_group, patch.logo ?? before.logo, Number(patch.include_in_summary ?? before.include_in_summary), maintaining, credit.credit_limit_cents, credit.statement_day, credit.due_mode, credit.due_value, paymentAccountId, now(), id, before.version);
    return { before, after: readAccountBalance(id) };
  });
}
