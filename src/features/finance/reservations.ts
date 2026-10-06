import { getDb } from "../../lib/db";
import { exactCents } from "./money";
import type { FinanceAllocationShortfall } from "./goal-types";

export function reservedAccountCents(accountId: string): number {
  const rows = getDb().prepare("SELECT a.amount_cents FROM finance_goal_allocations a JOIN finance_goals g ON g.id = a.goal_id WHERE a.account_id = ? AND g.archived = 0")
    .safeIntegers().iterate(accountId) as Iterable<{ amount_cents: bigint }>;
  let total = 0n;
  for (const row of rows) total += row.amount_cents;
  return exactCents(total);
}

export function reservationAmounts(balance: number, reserved: number) {
  // A negative balance leaves all reservations uncovered; its cash deficit is separate.
  const backed = Math.max(0, balance);
  return { reserved_cents: reserved, available_cents: Math.max(0, backed - reserved), shortfall_cents: Math.max(0, reserved - backed) };
}

export function financeBalanceWarnings(balances: { account_id: string; balance_cents: number }[]): {
  warnings: string[]; allocation_shortfalls?: FinanceAllocationShortfall[];
} {
  const shortfalls = balances.map(balance => ({ ...balance, ...reservationAmounts(balance.balance_cents, reservedAccountCents(balance.account_id)) }))
    .filter(row => row.shortfall_cents > 0)
    .map(({ account_id, balance_cents, reserved_cents, shortfall_cents }) => ({ account_id, balance_cents, reserved_cents, shortfall_cents }));
  return {
    warnings: [...(balances.some(row => row.balance_cents < 0) ? ["negative_balance"] : []), ...(shortfalls.length ? ["allocation_shortfall"] : [])],
    ...(shortfalls.length ? { allocation_shortfalls: shortfalls } : {}),
  };
}
