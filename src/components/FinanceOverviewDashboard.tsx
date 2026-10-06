"use client";

import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import {
  IconAlertTriangle, IconArrowDownLeft, IconArrowUpRight, IconArrowsExchange,
  IconChartBar, IconChevronLeft, IconChevronRight, IconEdit, IconPlus,
  IconRepeat, IconTarget, IconWallet,
} from "@tabler/icons-react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FinanceMonthInput } from "./FinanceDateInputs";
import { FinanceGoals } from "./FinanceGoals";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { formatPHP as money, localCalendarDate } from "@/features/finance/presentation";
import type { useFinanceAccounts } from "@/features/finance/use-finance-accounts";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import type { FinanceReportsController } from "@/features/finance/use-finance-reports";
import type { FinancePlanningController } from "@/features/finance/use-finance-planning";
import type { FinanceAccount } from "@/features/finance/types";
import { cn } from "cn";

interface FinanceOverviewDashboardProps {
  finance: ReturnType<typeof useFinanceAccounts>;
  activity: FinanceActivityController;
  reports: FinanceReportsController;
  planning: FinancePlanningController;
  onNavigateTab: (tab: "overview" | "activity" | "planning" | "manage") => void;
  onOpenAccount: (account?: FinanceAccount) => void;
  onCategoryFilter: (categoryId: string) => void;
}

const chartConfig = {
  income: { label: "Income", color: "var(--primary)" },
  expenses: { label: "Expenses", color: "var(--chart-2)" },
  net: { label: "Net cash flow", color: "var(--foreground)" },
} satisfies ChartConfig;
const categoryColors = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function Tile({ label, value, description, className, ...props }: { label: string; value: string; description: string } & HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-lg bg-card p-3 ring-1 ring-foreground/10", className)} {...props}>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1.5 break-words text-lg font-semibold sm:text-2xl tracking-tight tabular-nums">{value}</p>
    <p className="mt-1 text-xs text-muted-foreground">{description}</p>
  </div>;
}

export function FinanceOverviewDashboard({
  finance, activity, reports, planning, onNavigateTab, onOpenAccount, onCategoryFilter,
}: FinanceOverviewDashboardProps) {
  const report = reports.report;
  const income = report?.income_cents ?? activity.totals?.income_cents ?? 0;
  const expenses = report?.spending_cents ?? activity.totals?.expense_cents ?? 0;
  const categories = [...(report?.categories ?? [])].filter(category => category.spending_cents > 0).sort((a, b) => b.spending_cents - a.spending_cents);
  const budgetCents = (report?.categories ?? []).reduce((sum, category) => sum + (category.budget_cents ?? 0), 0);
  const reportSpending = report?.spending_cents ?? 0;
  const budgetPercent = budgetCents > 0 ? Math.min(100, Math.round(reportSpending / budgetCents * 100)) : 0;
  const budgetIsPartial = Boolean(report && report.total > report.categories.length);
  const hasFlow = report?.months.some(month => month.income_cents !== 0 || month.spending_cents !== 0) ?? false;
  const chartData = (report?.months ?? []).map(item => {
    const [y, m] = item.month.split("-").map(Number);
    const date = new Date(y, m - 1, 1);
    return {
      month: date.toLocaleDateString("en-PH", { month: "short" }),
      label: date.toLocaleDateString("en-PH", { month: "long", year: "numeric" }),
      income: item.income_cents, expenses: -item.spending_cents,
      net: item.income_cents - item.spending_cents,
    };
  });
  const transactions = activity.page?.transactions.slice(0, 7) ?? [];
  const accounts = finance.accounts.filter(account => account.kind === "money" && !account.archived);
  const pending = planning.page?.plans.filter(plan => plan.status === "pending") ?? [];
  const today = localCalendarDate();
  const trackRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ atStart: true, atEnd: true });
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => syncBounds(track));
    observer.observe(track);
    syncBounds(track);
    return () => observer.disconnect();
  }, [accounts.length]);

  function syncBounds(track: HTMLDivElement | null) {
    if (track) setBounds({ atStart: track.scrollLeft <= 1, atEnd: track.scrollLeft + track.clientWidth >= track.scrollWidth - 1 });
  }
  function slideStep(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  return (
    <div className="grid min-w-0 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="grid min-w-0 gap-3">
<Card size="sm" className="">
            <CardHeader>
              <CardTitle className="text-3xl font-semibold tabular-nums" data-testid="finance-money-total">{money(finance.summary?.money.balance_cents ?? 0)}</CardTitle>
              <CardDescription>Money balance · {countLabel(finance.summary?.money.account_count ?? 0, "account")}</CardDescription>
              <CardAction><FinanceMonthInput aria-label="Overview report month" value={reports.dates.date_from.slice(0, 7)} onChange={month => {
                const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
                reports.applyDates({ date_from: `${month}-01`, date_to: `${month}-${days}` });
              }} className="min-h-8 w-auto text-xs" /></CardAction>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <div className="min-w-0">
              {hasFlow ? <>
                <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label="Chart legend">
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-primary" />Income</span>
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-chart-2" />Expenses</span>
                  <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-foreground" />Net</span>
                </div>
                <ChartContainer config={chartConfig} className="h-48 w-full min-w-0 aspect-auto" aria-label="Recorded cash flow chart">
                  <ComposedChart accessibilityLayer data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={3}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} width={62} tickFormatter={value => new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value) / 100)} />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_, payload) => payload[0]?.payload.label ?? ""} formatter={(value, name) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">{name === "net" ? "Net cash flow" : name === "income" ? "Income" : "Expenses"}</span>
                        <span className="font-medium tabular-nums">{money(name === "expenses" ? -Number(value) : Number(value))}</span>
                      </div>
                    )} />} />
                    <Bar dataKey="income" fill="var(--color-income)" radius={3} maxBarSize={20} isAnimationActive={false} />
                    <Bar dataKey="expenses" fill="var(--color-expenses)" radius={3} maxBarSize={20} isAnimationActive={false} />
                    <Line dataKey="net" stroke="var(--color-net)" strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} />
                  </ComposedChart>
                </ChartContainer>
                <p className="mt-2 text-xs text-muted-foreground">{report ? "PHP. Only activity within the report dates is shown." : reports.error || "Loading cash flow…"}</p>
              </> : <Empty className="px-0"><EmptyHeader><EmptyMedia variant="icon"><IconChartBar aria-hidden="true" /></EmptyMedia><EmptyTitle>No cash flow yet</EmptyTitle><EmptyDescription>{reports.error || "Recorded months appear here after you post activity."}</EmptyDescription></EmptyHeader></Empty>}
            </div>
              <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 sm:grid-cols-1 sm:border-t-0 sm:border-l sm:pl-4 sm:pt-0">
                <div><dt className="text-xs text-muted-foreground">Income</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums" data-testid="finance-income-total">{money(income)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Expenses</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums" data-testid="finance-expense-total">{money(expenses)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Net cash flow</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums">{money(income - expenses)}</dd></div>
              </dl>
            </CardContent>
          </Card>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Card size="sm"><CardHeader><CardTitle>Monthly spending limit</CardTitle><CardDescription>{budgetIsPartial ? "Displayed category limits" : "Category limits"}</CardDescription><CardAction><Button variant="ghost" size="icon-sm" aria-label="Edit budgets" onClick={() => onNavigateTab("planning")}><IconEdit aria-hidden="true" /></Button></CardAction></CardHeader>
            <CardContent><div role="progressbar" aria-label="Spending against category budgets" aria-valuemin={0} aria-valuemax={100} aria-valuenow={budgetPercent} className="h-2 overflow-hidden rounded-sm bg-muted"><div className={cn("h-full", reportSpending > budgetCents && budgetCents > 0 ? "bg-destructive" : "bg-primary")} style={{ width: `${budgetPercent}%` }} /></div>
              <div className="mt-2 flex justify-between gap-2 text-xs tabular-nums"><span>{money(reportSpending)}</span><span className="text-muted-foreground">{budgetCents ? money(budgetCents) : "No limit set"}</span></div>
              {budgetIsPartial && <p className="mt-1 text-xs text-muted-foreground">Spending covers all categories; limits cover this report page.</p>}
            </CardContent>
          </Card>
          <Tile label="Asset value" value={money(finance.summary?.assets.balance_cents ?? 0)} description={countLabel(finance.summary?.assets.account_count ?? 0, "asset account")} data-testid="finance-asset-total" />
        </div>
        <div className="grid min-w-0 gap-3 md:grid-cols-3">
<Card size="sm" className="">
            <CardHeader>
              <CardTitle>Cost analysis</CardTitle>
              <CardDescription>Spending by category</CardDescription>
              
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-2xl font-semibold tabular-nums">{money(reportSpending)}</p>
              {categories.length ? <div className="flex flex-col divide-y divide-border/60">{categories.slice(0, 5).map((category, index) => <button
                key={category.category_id ?? "uncategorized"}
                type="button"
                disabled={!category.category_id}
                onClick={() => { if (category.category_id) onCategoryFilter(category.category_id); }}
                className="flex min-h-10 w-full flex-col gap-1.5 rounded-sm px-1 py-2 text-left enabled:hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-xs"><span className={cn("size-2 shrink-0 rounded-sm", categoryColors[Math.min(index, 4)])} /><span className="truncate font-medium">{category.name}</span></span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{reportSpending > 0 ? Math.round(category.spending_cents / reportSpending * 100) : 0}%</span>
                </span>
                <span className="block h-1.5 overflow-hidden rounded-sm bg-muted"><span className={cn("block h-full rounded-sm", category.overspent ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, reportSpending > 0 ? Math.round(category.spending_cents / reportSpending * 100) : 0)}%` }} /></span>
              </button>)}</div> : <p className="text-xs text-muted-foreground">Category rows appear after expenses are recorded or budgets are set.</p>}
              {report && report.unbudgeted_cents !== 0 && <p className="text-xs text-muted-foreground">Unbudgeted spending · <span className="tabular-nums">{money(report.unbudgeted_cents)}</span></p>}
            </CardContent>
          </Card>
          <FinanceGoals />
<Card size="sm" className="">
          <CardHeader>
            <CardTitle>Planned activity</CardTitle>
            <CardDescription>Upcoming and recurring payments</CardDescription>
            <CardAction><Button variant="ghost" size="icon-sm" aria-label="Add a plan" onClick={() => onNavigateTab("planning")}><IconPlus aria-hidden="true" /></Button></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="text-xs text-muted-foreground">Planned income</dt><dd className="mt-1 break-words text-sm font-semibold tabular-nums">{money(report?.forecast.income_cents ?? 0)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Planned expenses</dt><dd className="mt-1 break-words text-sm font-semibold tabular-nums">{money(report?.forecast.spending_cents ?? 0)}</dd></div>
            </dl>
            {pending.length ? <div className="flex flex-col divide-y divide-border/60">{pending.slice(0, 3).map(plan => {
              const Icon = plan.schedule_id ? IconRepeat : plan.type === "income" ? IconArrowDownLeft : IconArrowUpRight;
              const dueState = plan.due_date < today ? "Overdue" : plan.due_date === today ? "Due today" : "Upcoming";
              return <button key={plan.id} type="button" onClick={() => onNavigateTab("planning")} className="flex min-h-11 items-center gap-3 rounded-sm px-1 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{plan.text || plan.category_name || plan.type}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{plan.schedule_id ? "Recurring · " : ""}{dueState} · due {plan.due_date}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-medium tabular-nums">{money(plan.amount_cents)}</span>
                  <span className={cn("mt-0.5 block text-xs", plan.due_date <= today ? "text-destructive" : "text-muted-foreground")}>{plan.type === "income" ? "Income" : "Expense"}</span>
                </span>
              </button>;
            })}</div> : <Empty className="px-0"><EmptyHeader><EmptyMedia variant="icon"><IconTarget aria-hidden="true" /></EmptyMedia><EmptyTitle>Plan what’s next</EmptyTitle><EmptyDescription>Add a planned payment or income in Planning.</EmptyDescription></EmptyHeader></Empty>}
          </CardContent>
        </Card>
        </div>
      </div>
      <aside className="flex min-w-0 flex-col gap-3" aria-label="Accounts and transaction history">
<Card size="sm" className="">
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>Active money accounts</CardDescription>
          <CardAction className="flex items-center gap-1">
            {accounts.length > 1 && <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous accounts" disabled={bounds.atStart} onClick={() => slideStep(-1)}><IconChevronLeft aria-hidden="true" /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next accounts" disabled={bounds.atEnd} onClick={() => slideStep(1)}><IconChevronRight aria-hidden="true" /></Button>
            </div>}
            <Button variant="ghost" size="sm" onClick={() => onOpenAccount()}><IconPlus aria-hidden="true" data-icon="inline-start" />Add</Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {accounts.length ? <div
            ref={trackRef}
            aria-label="Accounts list"
            onScroll={event => syncBounds(event.currentTarget)}
            className="grid w-full grid-flow-col auto-cols-[85%] gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-1 motion-reduce:scroll-auto sm:auto-cols-[calc((100%-0.75rem)/2)] xl:auto-cols-[85%]"
          >
            {accounts.map(account => <button
              key={account.id}
              type="button"
              aria-label={`Manage ${account.name}`}
              onClick={() => onOpenAccount(account)}
              className="flex min-w-0 snap-start flex-col rounded-lg bg-primary/15 p-4 text-left ring-1 ring-foreground/5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 break-words text-xs font-medium">{account.name}</span>
                <IconWallet className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </span>
              <span className="mt-5 block break-words text-lg font-semibold tracking-tight tabular-nums">{money(account.balance_cents)}</span>
              <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Money account</span>
                {account.balance_cents < 0 ? <span className="flex items-center gap-1 text-destructive"><IconAlertTriangle className="size-3" aria-hidden="true" />Negative</span> : <span>PHP</span>}
              </span>
            </button>)}
          </div> : <Empty className="px-0"><EmptyHeader><EmptyMedia variant="icon"><IconWallet aria-hidden="true" /></EmptyMedia><EmptyTitle>No money accounts yet</EmptyTitle><EmptyDescription>Add an account with its opening balance to get started.</EmptyDescription></EmptyHeader></Empty>}
          {accounts.length > 0 && <ul className="mt-2 divide-y divide-border/60" aria-label="Account balances">
            {accounts.slice(0, 3).map(account => <li key={account.id} className="flex min-w-0 items-center justify-between gap-3 py-1.5 text-xs">
              <span className="truncate text-muted-foreground">{account.name}</span>
              <span className="shrink-0 tabular-nums">{money(account.balance_cents)}</span>
            </li>)}
          </ul>}
        </CardContent>
      </Card>
<Card size="sm" className="flex-1">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Latest transactions from your current filters</CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.length ? <div className="flex flex-col divide-y divide-border/60">{transactions.map(transaction => {
            const Icon = transaction.type === "income" ? IconArrowDownLeft : transaction.type === "expense" ? IconArrowUpRight : IconArrowsExchange;
            return <button key={transaction.id} type="button" onClick={() => onNavigateTab("activity")} className="flex min-h-11 items-center gap-3 rounded-sm px-1 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{transaction.category_name || transaction.subcategory_name || transaction.type}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{transaction.transaction_date}</span></span>
              <span className="shrink-0 text-right"><span className="block text-xs font-medium tabular-nums">{transaction.type === "income" ? "+" : transaction.type === "expense" ? "-" : ""}{money(transaction.amount_cents)}</span><span className="mt-0.5 block text-xs text-muted-foreground">{transaction.reverted ? "Reverted" : transaction.type}</span></span>
            </button>;
          })}</div> : <Empty className="px-0"><EmptyHeader><EmptyTitle>No recent activity</EmptyTitle><EmptyDescription>Your recorded transactions will appear here.</EmptyDescription></EmptyHeader></Empty>}
        </CardContent>
      </Card>
      </aside>
    </div>
  );
}
