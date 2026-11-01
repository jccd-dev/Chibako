import type { FinanceAccount } from "./types";

type SpendingAccount = Pick<FinanceAccount, "kind"> & { balance_cents: number | bigint };

export function canSpendFromAccount(account: SpendingAccount, outgoingCents: number | bigint): boolean {
  return account.kind === "money" && BigInt(account.balance_cents) >= BigInt(outgoingCents);
}

export function accountSummaryBucket(kind: FinanceAccount["kind"]): "money" | "assets" | "credit" {
  const buckets = { money: "money", asset: "assets", credit: "credit" } as const;
  return buckets[kind];
}

export type CreditSettings = Pick<FinanceAccount, "credit_limit_cents" | "statement_day" | "due_mode" | "due_value">;

/** Shared by the capability and the account editor; returns the first rule a kind's credit settings break. */
export function creditSettingsError(kind: FinanceAccount["kind"], settings: CreditSettings): string | null {
  const { credit_limit_cents: limit, statement_day: statementDay, due_mode: mode, due_value: value } = settings;
  if (kind !== "credit") {
    return limit === null && statementDay === null && mode === null && value === null ? null : "Credit settings are only available for credit accounts";
  }
  if (limit === null || limit <= 0) return "Enter a positive credit limit";
  if (statementDay !== null && (!Number.isInteger(statementDay) || statementDay < 1 || statementDay > 31)) return "Choose a statement day from 1 to 31";
  if ((mode === null) !== (value === null)) return "Choose a due rule together with its day";
  const outside = (max: number) => value === null || !Number.isInteger(value) || value < 1 || value > max;
  if (mode === "fixed_day" && outside(31)) return "Choose a due day from 1 to 31";
  if (mode === "after_statement") {
    if (outside(60)) return "Choose 1 to 60 days after the statement";
    if (statementDay === null) return "Set a statement day to count days after the statement";
  }
  return null;
}
