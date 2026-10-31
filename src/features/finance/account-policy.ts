import type { FinanceAccount } from "./types";

type SpendingAccount = Pick<FinanceAccount, "kind"> & { balance_cents: number | bigint };

export function canSpendFromAccount(account: SpendingAccount, outgoingCents: number | bigint): boolean {
  return account.kind === "money" && BigInt(account.balance_cents) >= BigInt(outgoingCents);
}

export function accountSummaryBucket(kind: FinanceAccount["kind"]): "money" | "assets" {
  const buckets = { money: "money", asset: "assets" } as const;
  return buckets[kind];
}
