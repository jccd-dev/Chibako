import type { FinanceAccount } from "./types";
import { exactCents } from "./money";

export function groupAccounts(accounts: FinanceAccount[]) {
  const groups = new Map<
    string,
    {
      name: string;
      kind: FinanceAccount["kind"];
      accounts: FinanceAccount[];
      balance: bigint;
    }
  >();
  for (const account of accounts) {
    const name = account.account_group || "Ungrouped";
    const key = JSON.stringify([account.kind, name]);
    const group = groups.get(key) ?? {
      name,
      kind: account.kind,
      accounts: [],
      balance: 0n,
    };
    group.accounts.push(account);
    group.balance += BigInt(account.balance_cents);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ balance, ...group }) => ({
      ...group,
      balance_cents: exactCents(balance),
    }))
    .sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
    );
}
