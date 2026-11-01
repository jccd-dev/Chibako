import { canSpendFromAccount, spendableCents } from "./account-policy";
import { exactCents } from "./money";
import { decimalCents } from "./money";
import { formatPHP } from "./presentation";
import type { FinanceAccount } from "./types";

export function financeBalanceShortfall(input: {
  accounts: readonly FinanceAccount[];
  account_id: string;
  amount: string;
  newly_posted_fee_amount?: string;
  subject?: string;
}): { account: FinanceAccount; available_cents: number; required_cents: number; fee_included: boolean; message: string } | null {
  if (!input.account_id) return null;
  let required: number;
  try {
    required = decimalCents(input.amount);
    if (required <= 0) return null;
  } catch { return null; }
  let fee = 0;
  let fee_included = false;
  if (input.newly_posted_fee_amount) {
    try {
      fee = decimalCents(input.newly_posted_fee_amount);
      if (fee > 0) { required += fee; fee_included = true; }
    } catch { /* Submit validation explains unparseable fees. */ }
  }
  const account = input.accounts.find(row => row.id === input.account_id);
  const available = account ? spendableCents(account) : null;
  if (!account || available === null || canSpendFromAccount(account, required)) return null;
  const availableCents = exactCents(available > 0n ? available : 0n);
  const needs = `this ${input.subject ?? "payment"} needs ${formatPHP(required)}${fee_included ? " including the posted fee" : ""}`;
  return {
    account,
    available_cents: account.kind === "credit" ? availableCents : account.balance_cents,
    required_cents: required,
    fee_included,
    message: account.kind === "credit"
      ? `Over credit limit: ${account.name} has ${formatPHP(availableCents)} available credit, and ${needs}. Reduce the amount or choose another account.`
      : `Insufficient balance: ${account.name} has ${formatPHP(account.balance_cents)}, and ${needs}. Reduce the amount or choose another account.`,
  };
}
