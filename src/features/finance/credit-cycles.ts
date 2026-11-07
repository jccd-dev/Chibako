import { getDb } from "../../lib/db";
import { authorizeFinance } from "../../server/auth/finance-authorization";
import { statementDate, statementDueDate } from "./credit-statement";
import { exactCents } from "./money";
import { localCalendarDate } from "./presentation";
import { FinanceError, getAccountSchema, type FinanceAccount, type FinanceActor } from "./types";
import { parseFinance } from "./mutations";
import type { FinanceCreditCycle } from "./credit-cycle-types";

type Settings = Pick<FinanceAccount, "id" | "kind" | "opening_balance_cents" | "statement_day" | "due_mode" | "due_value">;
type BankStatement = { statement_date: string; balance_cents: number; minimum_due_cents: number; due_date: string };
type Effect = { date: string; cents: bigint };

function nextDay(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function closeFor(day: number, date: string): string {
  const closed = statementDate(day, date);
  if (closed === date) return closed;
  const nextMonth = new Date(`${closed}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 2, 0);
  return statementDate(day, nextMonth.toISOString().slice(0, 10));
}

function previousMonthClose(day: number, date: string): string {
  const lastMonth = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  lastMonth.setUTCDate(0);
  return statementDate(day, lastMonth.toISOString().slice(0, 10));
}

/** Bank cutoff shifts belong to the nearest configured close, including shifts across month-end. */
export function nominalClose(day: number, actual: string): string {
  const previous = statementDate(day, actual);
  const next = closeFor(day, actual);
  return Date.parse(actual) - Date.parse(previous) <= Date.parse(next) - Date.parse(actual) ? previous : next;
}

/** Each credit settles the oldest outstanding cycle; carried balances are never counted twice. */
export function readCreditCycles(account: Settings, asOf = localCalendarDate()): FinanceCreditCycle[] {
  if (account.kind !== "credit") return [];
  const db = getDb();
  const savedBanks = db.prepare("SELECT statement_date,balance_cents,minimum_due_cents,due_date FROM finance_credit_statements WHERE account_id=? AND statement_date<=? ORDER BY updated_at,statement_date").all(account.id, asOf) as BankStatement[];
  const bankByClose = new Map(savedBanks.map(bank => [account.statement_day === null ? bank.statement_date : nominalClose(account.statement_day, bank.statement_date), bank]));
  const banks = [...bankByClose.values()].sort((a, b) => a.statement_date.localeCompare(b.statement_date));
  if (account.statement_day === null && banks.length === 0) return [];
  const effects = db.prepare(`SELECT date,cents FROM (
    SELECT transaction_date date, CASE WHEN type='income' THEN amount_cents ELSE -amount_cents END cents FROM finance_transactions WHERE reverted=0 AND account_id=@id
    UNION ALL SELECT transaction_date, CASE WHEN type='transfer' AND account_id=@id THEN -amount_cents ELSE amount_cents END FROM finance_movements WHERE reverted=0 AND (account_id=@id OR destination_account_id=@id)
    UNION ALL SELECT transaction_date,amount_cents FROM finance_refunds WHERE reverted=0 AND account_id=@id
    UNION ALL SELECT transaction_date,CASE WHEN type='borrowing' THEN amount_cents ELSE -amount_cents END FROM finance_obligation_movements WHERE reverted=0 AND account_id=@id
  ) WHERE date<=@asOf ORDER BY date, cents`).safeIntegers().all({ id: account.id, asOf }) as Effect[];
  const day = account.statement_day;
  function cycleClose(date: string): string {
    if (day === null) return banks.find(bank => bank.statement_date >= date)?.statement_date ?? banks[banks.length - 1].statement_date;
    const next = closeFor(day, date);
    const candidates = [statementDate(day, date), next, closeFor(day, nextDay(next))];
    return candidates.map(close => bankByClose.get(close)?.statement_date ?? close).filter(close => close >= date).sort()[0];
  }
  const dates = new Set(banks.map(bank => bank.statement_date));
  if (day !== null) {
    const lastClose = statementDate(day, asOf);
    dates.add(bankByClose.get(lastClose)?.statement_date ?? lastClose);
    dates.add(cycleClose(nextDay(asOf)));
    for (const effect of effects) dates.add(cycleClose(effect.date));
  }
  const cycles = [...dates].sort().map(date => {
    const bank = banks.find(item => item.statement_date === date);
    const previousClose = day === null ? null : previousMonthClose(day, bank ? nominalClose(day, date) : date);
    return {
      statement_date: date,
      cycle_start: previousClose ? nextDay(bankByClose.get(previousClose)?.statement_date ?? previousClose) : null,
      soa_date: nextDay(date),
      due_date: bank?.due_date ?? (account.due_mode && account.due_value !== null ? statementDueDate(date, account.due_mode, account.due_value) : null),
      status: date > asOf ? "upcoming" as const : "closed" as const,
      confirmed: !!bank,
      balance_cents: 0,
      remaining_due_cents: 0,
      minimum_due_cents: bank?.minimum_due_cents ?? null,
      remaining_minimum_cents: bank?.minimum_due_cents ?? null,
    };
  });
  let credit = account.opening_balance_cents > 0 ? BigInt(account.opening_balance_cents) : 0n;
  const remaining = cycles.map(() => 0n);
  if (account.opening_balance_cents < 0) remaining[0] = -BigInt(account.opening_balance_cents);
  function settle(amount: bigint) {
    for (let i = 0; i < cycles.length && amount > 0n; i++) {
      const used = amount < remaining[i] ? amount : remaining[i];
      remaining[i] -= used;
      amount -= used;
    }
    credit += amount;
  }
  let cursor = 0;
  for (let i = 0; i < cycles.length; i++) {
    const cycle = cycles[i];
    while (cursor < effects.length && effects[cursor].date <= cycle.statement_date) {
      const effect = effects[cursor++];
      if (effect.cents >= 0n) settle(effect.cents);
      else {
        const charge = -effect.cents;
        const used = charge < credit ? charge : credit;
        credit -= used;
        remaining[i] += charge - used;
      }
    }
    const bank = banks.find(item => item.statement_date === cycle.statement_date);
    const outstanding = remaining.reduce((total, value) => total + value, 0n);
    if (bank) {
      const difference = BigInt(bank.balance_cents) - outstanding;
      if (difference > 0n) remaining[i] += difference;
      else if (difference < 0n) settle(-difference);
      cycle.remaining_minimum_cents = bank.minimum_due_cents;
    }
    cycle.balance_cents = bank?.balance_cents ?? exactCents(remaining.reduce((total, value) => total + value, 0n));
  }
  // Manually confirmed cards can have no configured next cutoff, but later credits still settle their statement.
  while (cursor < effects.length) {
    const effect = effects[cursor++];
    if (effect.cents > 0n) settle(effect.cents);
  }
  return cycles.map((cycle, i) => {
    const laterCredits = effects.filter(effect => effect.date > cycle.statement_date && effect.cents > 0n).reduce((sum, effect) => sum + effect.cents, 0n);
    const minimum = cycle.minimum_due_cents === null ? null : BigInt(cycle.minimum_due_cents) - laterCredits;
    return { ...cycle, remaining_due_cents: exactCents(remaining[i]), remaining_minimum_cents: minimum === null ? null : exactCents(minimum > 0n ? minimum : 0n) };
  });
}

export function getCreditCycles(actor: FinanceActor, id: string, asOf = localCalendarDate()): FinanceCreditCycle[] {
  authorizeFinance(actor, "finance:read");
  parseFinance(getAccountSchema, { id });
  const row = getDb().prepare("SELECT * FROM finance_accounts WHERE id=?").get(id) as Settings | undefined;
  if (!row || row.kind !== "credit") throw new FinanceError("Choose a credit account", 404, "not_found");
  return readCreditCycles(row, asOf);
}
