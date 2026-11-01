"use client";

import { IconAlertTriangle, IconPlus, IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { groupAccounts } from "../account-grouping";
import { formatHistoryDate, formatPHP, localCalendarDate } from "../presentation";
import type { FinanceAccount } from "../types";
import type { FinanceAccountsController } from "../use-finance-accounts";

export function FinanceAccounts({
  finance,
  onOpen,
}: {
  finance: FinanceAccountsController;
  onOpen: (account?: FinanceAccount) => void;
}) {
  let groups: ReturnType<typeof groupAccounts> = [];
  let groupError = "";
  try {
    groups = groupAccounts(finance.accounts);
  } catch {
    groupError =
      "A group total exceeds the exact-cent range. Change its grouping to view the total.";
    groups = [
      {
        name: "Accounts",
        kind: "money",
        accounts: finance.accounts,
        balance_cents: 0,
      },
    ];
  }

  return (
    <section className="flex flex-col gap-5" aria-label="Accounts">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Accounts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Group your accounts. Select a card for details and history.
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                className="size-11"
                aria-label="Add account"
                onClick={() => onOpen()}
              />
            }
          >
            <IconPlus aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Add account</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <Checkbox
            checked={finance.includeArchived}
            onCheckedChange={finance.showArchived}
          />
          Show archived accounts
        </label>
        <p className="text-xs text-muted-foreground">
          Group totals include every displayed account.
        </p>
      </div>
      {groupError && (
        <p role="alert" className="text-sm">
          {groupError} Individual balances remain available below.
        </p>
      )}
      {finance.loading ? (
        <div
          role="status"
          aria-label="Loading accounts"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2].map((item) => (
            <Card key={item} aria-hidden="true" className="min-h-36">
              <CardHeader>
                <CardTitle>Loading accounts…</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : !finance.total ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {finance.includeArchived
                ? "No accounts yet"
                : "No active accounts"}
            </EmptyTitle>
            <EmptyDescription>
              Use the plus button to add an account with its opening balance.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        groups.map((group) => (
          <section
            key={JSON.stringify([group.kind, group.name])}
            className="flex flex-col gap-3"
            aria-label={
              groupError
                ? group.name
                : `${group.name} ${{ money: "debit accounts", asset: "assets", credit: "credit accounts" }[group.kind]}`
            }
          >
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="font-heading text-base font-medium">
                  {group.name}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {group.accounts.length}{" "}
                  {group.accounts.length === 1 ? "account" : "accounts"}
                  {!groupError &&
                    ` / ${{ money: "Debit", asset: "Assets", credit: "Credit" }[group.kind]}`}
                </p>
              </div>
              {!groupError && (
                <p
                  className="text-sm font-medium tabular-nums"
                  aria-label={`${group.name} total`}
                >
                  {formatPHP(group.balance_cents)}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.accounts.map((account) => (
                <Card
                  key={account.id}
                  className="relative min-w-0 hover:ring-ring/50 focus-within:ring-2 focus-within:ring-ring"
                >
                  <CardHeader className="grid-cols-[minmax(0,1fr)_auto]">
                    <CardTitle className="break-words">
                      <button
                        type="button"
                        aria-label={`View ${account.name}`}
                        className="text-left outline-none after:absolute after:inset-0 after:rounded-lg"
                        onClick={() => onOpen(account)}
                      >
                        {account.name}
                      </button>
                    </CardTitle>
                    <IconWallet
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <CardDescription>
                      {account.archived
                        ? "Archived"
                        : { money: "Debit", asset: "Asset", credit: "Credit" }[account.kind]}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{account.kind === "asset" ? "Current value" : "Net balance"}</p>
                    <p className="mt-1 break-words text-2xl font-semibold tabular-nums">
                      {formatPHP(account.balance_cents)}
                    </p>
                    {account.kind === "money" && (
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        Spendable this month {formatPHP(account.spendable_cents)}
                      </p>
                    )}
                    {account.kind === "credit" && (
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        Used {formatPHP(account.used_credit_cents ?? 0)} · Available {formatPHP(account.available_credit_cents ?? 0)}
                      </p>
                    )}
                    {account.next_due_date && (
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {account.remaining_due_cents
                          ? `${formatPHP(account.remaining_due_cents)} ${account.next_due_date < localCalendarDate() ? "overdue since" : "due"} ${formatHistoryDate(account.next_due_date)}`
                          : `Next due ${formatHistoryDate(account.next_due_date)}`}
                      </p>
                    )}
                  </CardContent>
                  <CardFooter className="flex-wrap justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {account.include_in_summary
                        ? "In summary"
                        : "Excluded from summary"}
                    </p>
                    {account.balance_cents < 0 && account.kind !== "credit" && (
                      <p className="flex items-center gap-1 text-xs text-destructive">
                        <IconAlertTriangle
                          className="size-3.5"
                          aria-hidden="true"
                        />
                        Negative balance. Review this account.
                      </p>
                    )}
                  </CardFooter>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
