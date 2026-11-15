"use client";

import { CompactMoney } from "./CompactMoney";
import { LoadingStatus } from "@/components/LoadingStatus";


import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import {
  IconAlertTriangle,
  IconArrowDownLeft,
  IconArrowUpRight,
  IconChartBar,
  IconChevronLeft,
  IconChevronRight,
  IconEdit,
  IconPlus,
  IconRepeat,
  IconTarget,
  IconWallet,
} from "@tabler/icons-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FinanceGoals } from "./FinanceGoals";
import { FinanceCostAnalysis } from "./FinanceCostAnalysis";
import { FinanceTransactionRow } from "./FinanceTransactionRow";
import { useFinanceRecentActivity } from "@/features/finance/use-finance-recent-activity";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  formatHistoryDate,
  formatPHP as money,
  localCalendarDate,
} from "@/features/finance/presentation";
import type { useFinanceAccounts } from "@/features/finance/use-finance-accounts";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import type { FinanceReportsController } from "@/features/finance/use-finance-reports";
import type { FinancePlanningController } from "@/features/finance/use-finance-planning";
import type { FinanceAccount } from "@/features/finance/types";
import { cn } from "cn";
import { AccountLogo } from "./AccountLogo";

interface FinanceOverviewDashboardProps {
  finance: ReturnType<typeof useFinanceAccounts>;
  activity: FinanceActivityController;
  reports: FinanceReportsController;
  planning: FinancePlanningController;
  onNavigateTab: (tab: "overview" | "activity" | "planning" | "manage") => void;
  onOpenAccount: (account?: FinanceAccount) => void;
  onInspectTransaction: (id: string) => void;
  onCategoryFilter: (categoryId: string) => void;
}

const chartConfig = {
  income: { label: "Income", color: "var(--success)" },
  expenses: { label: "Expenses", color: "var(--destructive)" },
} satisfies ChartConfig;

type OverviewPeriod = "today" | "week" | "month";
const periodText: Record<OverviewPeriod, string> = {
  today: "today",
  week: "this week",
  month: "this month",
};

function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function endOfMonth(year: number, month: number) {
  const date = new Date(Date.UTC(year, month, 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function periodRange(period: OverviewPeriod, today: string) {
  if (period === "today") return { date_from: today, date_to: today };
  if (period === "week") {
    const [year, month, day] = today.split("-").map(Number);
    // Sunday-start, matching the app calendar's week rows.
    const sunday = addDays(today, -new Date(Date.UTC(year, month - 1, day)).getUTCDay());
    return { date_from: sunday, date_to: addDays(sunday, 6) };
  }
  const [year, month] = today.split("-").map(Number);
  return { date_from: `${today.slice(0, 7)}-01`, date_to: endOfMonth(year, month) };
}

function dayAxisLabel(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-PH", {
    weekday: "short",
  });
}

type DailyFlow = { date: string; income_cents: number; spending_cents: number };

/** Running income/expense totals: days for a week, Sunday-start calendar weeks for a month. */
export function flowPoints(period: OverviewPeriod, daily: DailyFlow[], today: string) {
  if (period === "today") {
    const day = daily.find((item) => item.date === today);
    return [
      { tick: "Start", label: "Start of today", income: 0, expenses: 0 },
      { tick: "Now", label: formatHistoryDate(today), income: day?.income_cents ?? 0, expenses: day?.spending_cents ?? 0 },
    ];
  }
  const buckets: { from: string; to: string; income: number; expenses: number }[] = [];
  for (const day of daily) {
    const last = buckets.at(-1);
    const sunday = new Date(`${day.date}T00:00:00Z`).getUTCDay() === 0;
    if (last && period === "month" && !sunday) {
      last.to = day.date;
      last.income += day.income_cents;
      last.expenses += day.spending_cents;
    } else {
      buckets.push({ from: day.date, to: day.date, income: day.income_cents, expenses: day.spending_cents });
    }
  }
  let income = 0;
  let expenses = 0;
  return buckets.map((bucket, index) => {
    income += bucket.income;
    expenses += bucket.expenses;
    const single = bucket.from === bucket.to;
    // Future buckets stay empty so the line stops at today instead of running flat.
    const future = bucket.from > today;
    return {
      tick: period === "week" ? dayAxisLabel(bucket.from) : `Week ${index + 1}`,
      label: single ? formatHistoryDate(bucket.from) : `${formatHistoryDate(bucket.from).replace(/, \d{4}$/, "")} – ${formatHistoryDate(bucket.to)}`,
      income: future ? null : income,
      expenses: future ? null : expenses,
    };
  });
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function Tile({
  label,
  value,
  description,
  className,
  ...props
}: {
  label: string;
  value: string;
  description: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg bg-card p-3 ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 break-words text-lg font-semibold sm:text-2xl tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function FinanceOverviewDashboard({
  finance,
  activity,
  reports,
  planning,
  onNavigateTab,
  onOpenAccount,
  onInspectTransaction,
  onCategoryFilter,
}: FinanceOverviewDashboardProps) {
  const report = reports.report;
  const [period, setPeriod] = useState<OverviewPeriod>("month");
  const income = report?.income_cents
    ?? (period === "month" ? activity.totals?.income_cents ?? 0 : 0);
  const expenses = report?.spending_cents
    ?? (period === "month" ? activity.totals?.expense_cents ?? 0 : 0);
  const budgetCents = (report?.categories ?? []).reduce(
    (sum, category) => sum + (category.budget_cents ?? 0),
    0,
  );
  const reportSpending = report?.spending_cents ?? 0;
  const budgetPercent =
    budgetCents > 0
      ? Math.min(100, Math.round((reportSpending / budgetCents) * 100))
      : 0;
  const budgetIsPartial = Boolean(
    report && report.total > report.categories.length,
  );
  const hasFlow =
    report?.months.some(
      (month) => month.income_cents !== 0 || month.spending_cents !== 0,
    ) ?? false;
  const today = localCalendarDate();
  const chartData = flowPoints(period, report?.daily ?? [], today);
  const periodDates = periodRange(period, today);
  const recent = useFinanceRecentActivity(periodDates.date_from, periodDates.date_to);
  const transactions = recent.page?.transactions ?? [];
  const accounts = finance.allAccounts.filter(
    (account) => account.kind === "money" && !account.archived && account.include_in_summary,
  );
  const pending =
    planning.page?.plans.filter((plan) => plan.status === "pending") ?? [];
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
    if (track)
      setBounds({
        atStart: track.scrollLeft <= 1,
        atEnd: track.scrollLeft + track.clientWidth >= track.scrollWidth - 1,
      });
  }
  function slideStep(direction: -1 | 1) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({
      left: direction * track.clientWidth,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  return (
    <div className="grid min-w-0 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="grid min-w-0 gap-3">
        <Card size="sm" className="">
          <CardHeader>
            <CardTitle
              className="text-3xl font-semibold tabular-nums"
              data-testid="finance-money-total"
            >
              <CompactMoney cents={(finance.summary?.money.balance_cents ?? 0) + (finance.summary?.credit.balance_cents ?? 0)} />
            </CardTitle>
            <CardDescription>
              Net balance ·{" "}
              {countLabel((finance.summary?.money.account_count ?? 0) + (finance.summary?.credit.account_count ?? 0), "account")}
            </CardDescription>
            <CardAction>
              <ToggleGroup
                aria-label="Overview report period"
                value={[period]}
                onValueChange={(values) => {
                  if (!values[0]) return;
                  const next = values[0] as OverviewPeriod;
                  setPeriod(next);
                  const range = periodRange(next, today);
                  if (
                    reports.dates.date_from !== range.date_from ||
                    reports.dates.date_to !== range.date_to
                  ) {
                    reports.applyDates(range);
                  }
                }}
                spacing={0}
              >
                <ToggleGroupItem value="today">Today</ToggleGroupItem>
                <ToggleGroupItem value="week">Week</ToggleGroupItem>
                <ToggleGroupItem value="month">Month</ToggleGroupItem>
              </ToggleGroup>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <div className="min-w-0">
              {hasFlow ? (
                <>
                  <div
                    className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
                    aria-label="Chart legend"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-3 rounded-full bg-success" />
                      Income
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-3 rounded-full bg-destructive" />
                      Expenses
                    </span>
                    <span className="ml-auto">Running total</span>
                  </div>
                  <ChartContainer
                    config={chartConfig}
                    className="h-48 w-full min-w-0 aspect-auto"
                    aria-label="Recorded cash flow chart"
                  >
                    <AreaChart
                      accessibilityLayer
                      data={chartData}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                    >
                      <defs>
                        {(["income", "expenses"] as const).map((key) => (
                          <linearGradient key={key} id={`finance-flow-${key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={`var(--color-${key})`} stopOpacity={0.28} />
                            <stop offset="100%" stopColor={`var(--color-${key})`} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="tick"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={62}
                        allowDecimals={false}
                        tickFormatter={(value) =>
                          new Intl.NumberFormat("en-PH", {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(Number(value) / 100)
                        }
                      />
                      <ChartTooltip
                        cursor={{ stroke: "var(--border)" }}
                        content={
                          <ChartTooltipContent
                            indicator="line"
                            labelFormatter={(_, payload) =>
                              payload[0]?.payload.label ?? ""
                            }
                            formatter={(value, name) => (
                              <div className="flex w-full items-center justify-between gap-4">
                                <span className="text-muted-foreground">
                                  {name === "income" ? "Income" : "Expenses"}
                                </span>
                                <span className="font-medium tabular-nums">
                                  {money(Number(value))}
                                </span>
                              </div>
                            )}
                          />
                        }
                      />
                      {(["income", "expenses"] as const).map((key) => (
                        <Area
                          key={key}
                          dataKey={key}
                          type="monotone"
                          stroke={`var(--color-${key})`}
                          strokeWidth={2}
                          fill={`url(#finance-flow-${key})`}
                          dot={false}
                          activeDot={{ r: 3, strokeWidth: 0 }}
                          isAnimationActive={false}
                        />
                      ))}
                    </AreaChart>
                  </ChartContainer>
                  {report || reports.error ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {report
                        ? `PHP, ${periodText[period]}. Each point adds up activity so far.`
                        : reports.error}
                    </p>
                  ) : (
                    <LoadingStatus className="mt-2 text-xs">
                      Loading cash flow…
                    </LoadingStatus>
                  )}
                </>
              ) : (
                <Empty className="px-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <IconChartBar aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No cash flow yet</EmptyTitle>
                    <EmptyDescription>
                      {reports.error ||
                        "Recorded months appear here after you post activity."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-1 sm:border-t-0 sm:border-l sm:pl-4 sm:pt-0">
              <div>
                <dt className="text-xs text-muted-foreground">Income</dt>
                <dd
                  className="mt-1 break-words text-lg font-semibold tabular-nums"
                  data-testid="finance-income-total"
                >
                  <CompactMoney cents={income} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Expenses</dt>
                <dd
                  className="mt-1 break-words text-lg font-semibold tabular-nums"
                  data-testid="finance-expense-total"
                >
                  <CompactMoney cents={expenses} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Net cash flow</dt>
                <dd className="mt-1 break-words text-lg font-semibold tabular-nums">
                  <CompactMoney cents={income - expenses} />
                </dd>
              </div>
              <div>
                <dt
                  className="text-xs text-muted-foreground"
                  title="Projected availability after maintaining balances and this month’s unpaid expenses, including overdue and recurring payments"
                >
                  Spendable this month
                </dt>
                <dd
                  className="mt-1 break-words text-lg font-semibold tabular-nums"
                  data-testid="finance-spendable-total"
                >
                  <CompactMoney cents={finance.summary?.spendable_cents ?? 0} />
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Monthly spending limit</CardTitle>
              <CardDescription>
                {budgetIsPartial
                  ? "Displayed category limits"
                  : "Category limits"}
              </CardDescription>
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit budgets"
                  onClick={() => onNavigateTab("planning")}
                >
                  <IconEdit aria-hidden="true" />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div
                role="progressbar"
                aria-label="Spending against category budgets"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={budgetPercent}
                className="h-2 overflow-hidden rounded-sm bg-muted"
              >
                <div
                  className={cn(
                    "h-full",
                    reportSpending > budgetCents && budgetCents > 0
                      ? "bg-destructive"
                      : "bg-primary",
                  )}
                  style={{ width: `${budgetPercent}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between gap-2 text-xs tabular-nums">
                <span>{money(reportSpending)}</span>
                <span className="text-muted-foreground">
                  {budgetCents ? money(budgetCents) : "No limit set"}
                </span>
              </div>
              {budgetIsPartial && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Spending covers all categories; limits cover this report page.
                </p>
              )}
            </CardContent>
          </Card>
          <Tile
            label="Asset value"
            value={money(finance.summary?.assets.balance_cents ?? 0)}
            description={countLabel(
              finance.summary?.assets.account_count ?? 0,
              "asset account",
            )}
            data-testid="finance-asset-total"
          />
          <Tile
            label="Owed to me"
            value={money(finance.summary?.obligations.receivable_cents ?? 0)}
            description="Outstanding receivables, separate from cash"
            data-testid="finance-receivable-total"
          />
        </div>
        <div className="grid min-w-0 gap-3 md:grid-cols-3">
          <FinanceCostAnalysis report={report} onCategoryFilter={onCategoryFilter} />
          <FinanceGoals />
          <Card size="sm" className="">
            <CardHeader>
              <CardTitle>Planned activity</CardTitle>
              <CardDescription>Upcoming and recurring payments</CardDescription>
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add a plan"
                  onClick={() => onNavigateTab("planning")}
                >
                  <IconPlus aria-hidden="true" />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Planned income
                  </dt>
                  <dd className="mt-1 break-words text-sm font-semibold tabular-nums">
                    {money(report?.forecast.income_cents ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Planned expenses
                  </dt>
                  <dd className="mt-1 break-words text-sm font-semibold tabular-nums">
                    {money(report?.forecast.spending_cents ?? 0)}
                  </dd>
                </div>
              </dl>
              {pending.length ? (
                <div className="flex flex-col divide-y divide-border/60">
                  {pending.slice(0, 3).map((plan) => {
                    const Icon = plan.schedule_id
                      ? IconRepeat
                      : plan.type === "income"
                        ? IconArrowDownLeft
                        : IconArrowUpRight;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => onNavigateTab("planning")}
                        className="flex min-h-11 items-center gap-3 rounded-sm px-1 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Icon
                            className="size-4 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">
                            {plan.text || plan.category_name || plan.type}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {formatHistoryDate(plan.due_date)}
                            {plan.due_date < today ? " · Overdue" : ""}
                            {plan.schedule_id ? " · Recurring" : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-xs font-medium tabular-nums">
                            {money(plan.amount_cents)}
                          </span>
                          <span
                            className={cn(
                              "mt-0.5 block text-xs",
                              plan.due_date <= today
                                ? "text-destructive"
                                : "text-muted-foreground",
                            )}
                          >
                            {plan.type === "income" ? "Income" : "Expense"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Empty className="px-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <IconTarget aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>Plan what’s next</EmptyTitle>
                    <EmptyDescription>
                      Add a planned payment or income in Planning.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <aside
        className="flex min-w-0 flex-col gap-3"
        aria-label="Finance review, accounts and transaction history"
      >
        <Card size="sm" className="">
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>Active debit accounts</CardDescription>
            <CardAction className="flex items-center gap-1">
              {accounts.length > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Previous accounts"
                    disabled={bounds.atStart}
                    onClick={() => slideStep(-1)}
                  >
                    <IconChevronLeft aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Next accounts"
                    disabled={bounds.atEnd}
                    onClick={() => slideStep(1)}
                  >
                    <IconChevronRight aria-hidden="true" />
                  </Button>
                </div>
              )}
              <Button variant="ghost" size="icon" aria-label="Add account" title="Add account" onClick={() => onOpenAccount()}>
                <IconPlus aria-hidden="true" data-icon="inline-start" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {accounts.length ? (
              <div
                ref={trackRef}
                aria-label="Accounts list"
                onScroll={(event) => syncBounds(event.currentTarget)}
                className="grid w-full grid-flow-col auto-cols-[85%] gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-1 scrollbar-none motion-reduce:scroll-auto sm:auto-cols-[calc((100%-0.75rem)/2)] xl:auto-cols-[85%]"
              >
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="relative flex min-w-0 snap-start flex-col rounded-lg bg-primary/15 p-4 text-left ring-1 ring-foreground/5 hover:bg-muted"
                  >
                    <button
                      type="button"
                      aria-label={`View ${account.name}`}
                      onClick={() => onOpenAccount(account)}
                      className="flex items-center gap-2 text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
                    >
                      <AccountLogo logo={account.logo} name={account.name} className="size-7" />
                      <span className="min-w-0 flex-1 break-words text-xs font-medium">
                        {account.name}
                      </span>
                    </button>
                    <span className="mt-5 text-xs text-muted-foreground">Net balance</span>
                    <span className="mt-1 block break-words text-2xl font-semibold tracking-tight tabular-nums">
                      <CompactMoney cents={account.balance_cents} className="relative z-10" />
                    </span>
                    <span className="mt-1 text-xs tabular-nums">
                      Spendable this month <CompactMoney cents={account.spendable_cents} className="relative z-10" />
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>Debit account</span>
                      {account.balance_cents < 0 ? (
                        <span className="flex items-center gap-1 text-destructive">
                          <IconAlertTriangle
                            className="size-3"
                            aria-hidden="true"
                          />
                          Negative
                        </span>
                      ) : (
                        <span>PHP</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty className="px-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconWallet aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No debit accounts yet</EmptyTitle>
                  <EmptyDescription>
                    Add an account with its opening balance to get started.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {accounts.length > 0 && (
              <ul
                className="mt-2 divide-y divide-border/60"
                aria-label="Account balances"
              >
                {accounts.slice(0, 3).map((account) => (
                  <li
                    key={account.id}
                    className="flex min-w-0 items-center justify-between gap-3 py-1.5 text-xs"
                  >
                    <span className="truncate text-muted-foreground">
                      {account.name}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <CompactMoney cents={account.balance_cents} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card size="sm" className="flex-1">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Latest transactions within {periodText[period]}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {transactions.length ? (
              <ul className="flex flex-col gap-1.5">
                {transactions.map((transaction) => (
                  <li key={transaction.id}>
                    <FinanceTransactionRow
                      row={transaction}
                      compact
                      title={transaction.category_name || transaction.subcategory_name || transaction.type}
                      context={formatHistoryDate(transaction.transaction_date)}
                      note={transaction.text?.trim()}
                      ariaLabel={`Inspect ${transaction.type} ${money(transaction.amount_cents)} on ${formatHistoryDate(transaction.transaction_date)}`}
                      onClick={() => onInspectTransaction(transaction.id)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty className="px-0">
                <EmptyHeader>
                  <EmptyTitle>No recent activity</EmptyTitle>
                  <EmptyDescription>
                    Your recorded transactions will appear here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
      </aside>
      <section aria-label="Obligations summary" className="grid min-w-0 gap-3 xl:col-span-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Obligations</CardTitle>
            <CardDescription>Separate from cash</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted-foreground">Debt</dt>
                <dd className="mt-1 break-words text-sm font-semibold tabular-nums">
                  {money(finance.summary?.obligations.debt_cents ?? 0)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Receivables</dt>
                <dd className="mt-1 break-words text-sm font-semibold tabular-nums">
                  {money(finance.summary?.obligations.receivable_cents ?? 0)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
