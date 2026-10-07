"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconPlus } from "@tabler/icons-react";
import { useFinanceAccounts } from "@/features/finance/use-finance-accounts";
import { useFinanceActivity } from "@/features/finance/use-finance-activity";
import {
  FinanceActivityList,
  FinanceTransactionEntry,
} from "./FinanceActivity";
import { FinanceReports, FinanceBudgets } from "./FinanceReports";
import { useFinanceBudget } from "@/features/finance/use-finance-budget";
import { FinancePlans } from "./FinancePlans";
import { FinanceGoals } from "./FinanceGoals";
import { useFinancePlanning } from "@/features/finance/use-finance-planning";
import { useFinanceReports } from "@/features/finance/use-finance-reports";
import { FinanceAdjustment } from "./FinanceAdjustment";
import { FinanceClassifications } from "./FinanceClassifications";
import { FinanceOverviewDashboard } from "./FinanceOverviewDashboard";
import {
  decimalPHP as decimal,
  formatPHP as money,
} from "@/features/finance/presentation";
import type { FinanceAccount } from "@/features/finance/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

const tabs = ["overview", "activity", "planning", "manage"] as const;
type FinanceTab = (typeof tabs)[number];
const isTab = (value: string | undefined): value is FinanceTab =>
  tabs.some((tab) => tab === value);
const control =
  "min-h-11 text-sm transition-none focus-visible:ring-2 focus-visible:ring-ring";

export function FinanceView({ initialTab }: { initialTab?: string }) {
  const router = useRouter();
  const finance = useFinanceAccounts();
  const activity = useFinanceActivity(finance.refresh);
  const reports = useFinanceReports(activity.notice);
  const budget = useFinanceBudget(reports.refresh);
  const refreshAfterPlan = useCallback(async () => {
    await Promise.all([
      finance.refresh(),
      activity.refreshHistory(),
      activity.refreshTotals(),
      reports.refresh(),
    ]);
  }, [
    finance.refresh,
    activity.refreshHistory,
    activity.refreshTotals,
    reports.refresh,
  ]);
  const planning = useFinancePlanning(activity.notice, refreshAfterPlan);
  useEffect(() => {
    window.dispatchEvent(new Event("finance-changed"));
  }, [activity.notice, finance.notice, planning.notice]);
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<FinanceAccount | null>(null);
  useEffect(() => {
    if (finance.notice) void activity.refreshOptions();
  }, [finance.notice, activity.refreshOptions]);
  const [tab, setTab] = useState<FinanceTab>(
    isTab(initialTab) ? initialTab : "overview",
  );
  const [panel, setPanel] = useState<"create" | FinanceAccount | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("money");
  const [opening, setOpening] = useState("0.00");
  const editing = typeof panel === "object" ? panel : null;
  useEffect(() => {
    setTab(isTab(initialTab) ? initialTab : "overview");
  }, [initialTab]);

  function changeTab(value: FinanceTab) {
    setTab(value);
    router.replace(`/app/finance?tab=${value}`, { scroll: false });
  }

  function open(account?: FinanceAccount) {
    finance.resetSave();
    setName(account?.name ?? "");
    setKind(account?.kind ?? "money");
    setOpening(decimal(account?.opening_balance_cents ?? 0));
    setPanel(account ?? "create");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await finance.save(
      editing?.id ?? null,
      editing
        ? { name, version: editing.version }
        : { name, kind, currency: "PHP", opening_balance: opening },
      editing ? "Account updated." : "Account created.",
    );
    if (saved) setPanel(null);
  }

  async function archive() {
    if (!editing) return;
    if (
      await finance.save(
        editing.id,
        { version: editing.version, archived: !editing.archived },
        editing.archived
          ? "Account restored."
          : "Account archived. Its balance is retained.",
      )
    )
      setPanel(null);
  }

  const accountRows = (accounts: FinanceAccount[], editable = false) =>
    accounts.length ? (
      <ul className="divide-y divide-border">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-4 py-4"
          >
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">{account.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {account.archived
                  ? "Archived account"
                  : account.kind === "asset"
                    ? "Asset account"
                    : "Money account"}
              </p>
              {account.balance_cents < 0 && (
                <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-destructive">
                  <IconAlertTriangle
                    className="size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  Negative balance. Review this account.
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-medium tabular-nums">
                {money(account.balance_cents)}
              </p>
              {editable && (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="ghost"
                    className={control}
                    onClick={() => open(account)}
                    aria-label={`Manage ${account.name}`}
                  >
                    Manage
                  </Button>
                  {!account.archived && (
                    <Button
                      variant="outline"
                      className={control}
                      onClick={() => {
                        activity.resetSave();
                        setAdjusting(account);
                      }}
                      aria-label={`${account.kind === "asset" ? "Adjust value for" : "Reconcile"} ${account.name}`}
                    >
                      {account.kind === "asset" ? "Adjust value" : "Reconcile"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    ) : (
      <p className="py-5 text-sm text-muted-foreground">
        No accounts yet. Create one in Manage with its opening balance.
      </p>
    );

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Finance
          </h1>
          <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
            Your accounts and activity, in PHP. Cash and assets stay separate.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button className={control} onClick={() => setTransactionOpen(true)}>
            <IconPlus aria-hidden="true" data-icon="inline-start" />
            Add transaction
          </Button>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isTab(value)) changeTab(value);
        }}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-2">
          <TabsList
            variant="line"
            className="grid h-auto w-full grid-cols-4 gap-1 sm:flex sm:w-fit"
            aria-label="Finance views"
          >
            {tabs.map((value) => (
              <TabsTrigger
                key={value}
                value={value}
                className={`${control} px-2.5 sm:px-5`}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {finance.notice && (
          <p role="status" className="mb-4 text-sm">
            {finance.notice}
          </p>
        )}
        {activity.notice && (
          <p role="status" className="mb-4 text-sm">
            {activity.notice}
          </p>
        )}
        {finance.loadError && (
          <div
            role="alert"
            className="mb-5 rounded-md border border-border bg-muted p-4"
          >
            <p className="text-sm">{finance.loadError}</p>
            <Button
              variant="outline"
              className={`${control} mt-3`}
              onClick={() => void finance.refresh()}
            >
              Retry loading
            </Button>
          </div>
        )}

        <TabsContent value="overview">
          {finance.loading && !finance.summary ? (
            <div
              role="status"
              aria-label="Loading balances"
              className="grid gap-6 sm:grid-cols-2"
            >
              {[0, 1].map((item) => (
                <div key={item} className="h-36 rounded-lg bg-muted" />
              ))}
            </div>
          ) : (
            finance.summary && (
              <>
                <FinanceOverviewDashboard
                  finance={finance}
                  activity={activity}
                  reports={reports}
                  planning={planning}
                  onNavigateTab={changeTab}
                  onOpenAccount={open}
                  onCategoryFilter={(id) => {
                    activity.applyFilters({
                      q: "",
                      date_from: reports.dates.date_from,
                      date_to: reports.dates.date_to,
                      category_id: id,
                      account_id: "",
                      type: "",
                      hidden: "all",
                      reverted: "false",
                    });
                    changeTab("activity");
                  }}
                />

                <details className="mt-4 border-t border-border pt-3">
                  <summary className="min-h-11 cursor-pointer font-heading text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                    Detailed spending reports
                  </summary>
                  <div className="pt-4">
                    <FinanceReports
                      reports={reports}
                      onCategory={(id) => {
                        activity.applyFilters({
                          q: "",
                          date_from: reports.dates.date_from,
                          date_to: reports.dates.date_to,
                          category_id: id,
                          account_id: "",
                          type: "",
                          hidden: "all",
                          reverted: "false",
                        });
                        changeTab("activity");
                      }}
                    />
                  </div>
                </details>
              </>
            )
          )}
        </TabsContent>

        <TabsContent value="activity">
          <FinanceActivityList activity={activity} />
        </TabsContent>
        <TabsContent value="planning">
          <FinanceBudgets budget={budget} activity={activity} />
          <FinancePlans planning={planning} activity={activity} />
          <FinanceGoals />
        </TabsContent>
        <TabsContent value="manage">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Accounts</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Opening balances are fixed. Rename or archive accounts here.
              </p>
            </div>
            <Button className={control} onClick={() => open()}>
              <IconPlus aria-hidden="true" />
              Add account
            </Button>
          </div>
          <label className="my-5 flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={finance.includeArchived}
              onChange={(event) => finance.showArchived(event.target.checked)}
            />
            Show archived accounts
          </label>
          {finance.loading ? (
            <p role="status" className="py-6 text-sm text-muted-foreground">
              Loading accounts…
            </p>
          ) : (
            accountRows(finance.accounts, true)
          )}
          {finance.total > 50 && (
            <nav
              aria-label="Account pages"
              className="mt-5 flex flex-wrap items-center gap-4"
            >
              <Button
                variant="outline"
                className={control}
                disabled={finance.offset === 0 || finance.loading}
                onClick={() =>
                  finance.setOffset(Math.max(0, finance.offset - 50))
                }
              >
                Previous
              </Button>
              <span className="text-sm">
                {finance.offset + 1}-
                {Math.min(finance.offset + 50, finance.total)} of{" "}
                {finance.total}
              </span>
              <Button
                variant="outline"
                className={control}
                disabled={
                  finance.offset + 50 >= finance.total || finance.loading
                }
                onClick={() => finance.setOffset(finance.offset + 50)}
              >
                Next
              </Button>
            </nav>
          )}
          <FinanceClassifications activity={activity} />
        </TabsContent>
      </Tabs>

      <FinanceAdjustment
        selected={adjusting}
        activity={activity}
        onClose={() => setAdjusting(null)}
      />
      <FinanceTransactionEntry
        activity={activity}
        open={transactionOpen}
        onClose={() => setTransactionOpen(false)}
      />
      <Sheet
        open={panel !== null}
        onOpenChange={(value) => {
          if (!value && !finance.busy) setPanel(null);
        }}
      >
        <SheetContent
          showCloseButton={false}
          className="data-[side=right]:w-full gap-0 overflow-y-auto p-0 text-sm data-[side=right]:sm:max-w-md motion-reduce:transition-none"
        >
          <SheetHeader className="border-b border-border p-6">
            <SheetTitle className="text-lg">
              {editing ? "Manage account" : "Add account"}
            </SheetTitle>
            <SheetDescription className="text-sm">
              {editing
                ? "Rename or archive without changing the recorded opening."
                : "Set the balance before any recorded activity. PHP only."}
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={submit} className="flex flex-1 flex-col gap-6 p-6">
            <div className="grid gap-2">
              <label htmlFor="finance-name" className="font-medium">
                Account name
              </label>
              <Input
                id="finance-name"
                required
                maxLength={120}
                value={name}
                disabled={finance.busy}
                onChange={(event) => setName(event.target.value)}
                className={control}
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="finance-kind" className="font-medium">
                Account type
              </label>
              <select
                id="finance-kind"
                value={kind}
                disabled={!!editing || finance.busy}
                onChange={(event) => setKind(event.target.value)}
                className={`${control} rounded-md border border-input bg-popover px-3 text-foreground disabled:opacity-70`}
              >
                <option value="money">Money</option>
                <option value="asset">Asset</option>
              </select>
              <p className="text-sm text-muted-foreground">
                Assets track value and are excluded from cash totals.
              </p>
            </div>
            <div className="grid gap-2">
              <label htmlFor="finance-opening" className="font-medium">
                Opening balance (PHP)
              </label>
              <Input
                id="finance-opening"
                type="text"
                inputMode="decimal"
                required
                pattern="-?\d+(\.\d{1,2})?"
                value={opening}
                disabled={!!editing || finance.busy}
                aria-describedby="finance-opening-help"
                onChange={(event) => setOpening(event.target.value)}
                className={`${control} tabular-nums`}
              />
              <p
                id="finance-opening-help"
                className="text-sm text-muted-foreground"
              >
                Use up to two decimal places. Openings do not count as income or
                spending.
              </p>
            </div>
            {editing && (
              <p className="text-sm">
                Current balance:{" "}
                <strong className="tabular-nums">
                  {money(editing.balance_cents)}
                </strong>
              </p>
            )}
            {finance.saveError && (
              <div
                role="alert"
                className="rounded-md border border-border bg-muted p-3 text-sm"
              >
                {finance.saveError} Close and reopen the account if it has
                changed.
              </div>
            )}
            <div className="mt-auto flex flex-wrap justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                className={control}
                disabled={finance.busy}
                onClick={() => setPanel(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className={control}
                disabled={finance.busy || !name.trim()}
              >
                {finance.busy
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Create account"}
              </Button>
            </div>
            {editing && (
              <section className="border-t border-border pt-5">
                <p className="mb-3 text-sm text-muted-foreground">
                  Archiving removes the account from active lists. Its balance
                  and history are kept in your totals.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className={control}
                  disabled={finance.busy}
                  onClick={() => void archive()}
                >
                  {editing.archived ? "Restore account" : "Archive account"}
                </Button>
              </section>
            )}
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
