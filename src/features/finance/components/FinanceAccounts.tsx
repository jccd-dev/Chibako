"use client";

import { IconAlertTriangle, IconChevronRight, IconPlus } from "@tabler/icons-react";
import { Collapsible } from "@base-ui/react/collapsible";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
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
import { AccountLogo } from "./AccountLogo";
import { groupAccounts } from "../account-grouping";
import { formatHistoryDate, formatPHP, localCalendarDate } from "../presentation";
import type { FinanceAccount } from "../types";
import type { FinanceAccountsController } from "../use-finance-accounts";
import { LoadingStatus } from "@/components/LoadingStatus";

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
        <LoadingStatus className="min-h-24 justify-center">
          Loading accounts…
        </LoadingStatus>
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
          <Collapsible.Root
            key={JSON.stringify([group.kind, group.name])}
            defaultOpen
            render={<section />}
            className="flex flex-col"
            aria-label={
              groupError
                ? group.name
                : `${group.name} ${{ money: "debit accounts", asset: "assets", credit: "credit accounts" }[group.kind]}`
            }
          >
            <div className="relative -mx-2 flex flex-wrap items-end justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 has-focus-visible:outline-2 has-focus-visible:outline-ring">
              <div>
                <h3 className="font-heading text-base font-medium">
                  {/* after:inset-0 stretches the trigger over the whole header row. */}
                  <Collapsible.Trigger className="group/trigger flex items-center gap-1.5 text-left outline-none after:absolute after:inset-0 after:rounded-md">
                    <IconChevronRight
                      aria-hidden="true"
                      className="size-4 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none"
                    />
                    {group.name}
                  </Collapsible.Trigger>
                </h3>
                <p className="mt-1 pl-5.5 text-xs text-muted-foreground">
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
            {/* -m-1 p-1 keeps card rings inside the height clip. */}
            <Collapsible.Panel className="-m-1 h-(--collapsible-panel-height) overflow-hidden p-1 transition-[height] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
            <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.accounts.map((account) => (
                <Card
                  key={account.id}
                  size="sm"
                  className="relative min-w-0 hover:ring-ring/50 focus-within:ring-2 focus-within:ring-ring"
                >
                  <CardContent className="flex items-start gap-3">
                    <AccountLogo logo={account.logo} name={account.name} className="size-9" />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        aria-label={`View ${account.name}`}
                        className="block max-w-full truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg"
                        onClick={() => onOpen(account)}
                      >
                        {account.name}
                      </button>
                      <p className="text-[11px] text-muted-foreground">
                        {account.archived
                          ? "Archived"
                          : { money: "Debit", asset: "Asset", credit: "Credit" }[account.kind]}
                        {!account.include_in_summary && " · Excluded from summary"}
                      </p>
                      <p className="mt-1.5 break-words text-lg font-semibold tabular-nums">
                        {formatPHP(account.balance_cents)}
                      </p>
                      {account.kind === "money" && (
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          Spendable this month {formatPHP(account.spendable_cents)}
                        </p>
                      )}
                      {account.kind === "credit" && (
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          Used {formatPHP(account.used_credit_cents ?? 0)} · Available {formatPHP(account.available_credit_cents ?? 0)}
                        </p>
                      )}
                      {account.next_due_date && (
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {account.remaining_due_cents
                            ? `${formatPHP(account.remaining_due_cents)} ${account.next_due_date < localCalendarDate() && (!account.statement_confirmed || (account.remaining_minimum_cents ?? 0) > 0) ? "overdue since" : "due"} ${formatHistoryDate(account.next_due_date)}`
                            : `Next due ${formatHistoryDate(account.next_due_date)}`}
                        </p>
                      )}
                      {account.balance_cents < 0 && account.kind !== "credit" && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
                          <IconAlertTriangle className="size-3" aria-hidden="true" />
                          Negative balance. Review this account.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            </Collapsible.Panel>
          </Collapsible.Root>
        ))
      )}
    </section>
  );
}
