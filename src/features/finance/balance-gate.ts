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
  if (!account || account.kind !== "money" || account.balance_cents >= required) return null;
  return {
    account,
    available_cents: account.balance_cents,
    required_cents: required,
    fee_included,
    message: `Insufficient balance: ${account.name} has ${formatPHP(account.balance_cents)}, and this ${input.subject ?? "payment"} needs ${formatPHP(required)}${fee_included ? " including the posted fee" : ""}. Reduce the amount or choose another account.`,
  };
}
