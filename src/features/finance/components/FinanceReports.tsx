"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { format, isValid, lastDayOfMonth, parse } from "date-fns";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "./MoneyInput";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "cn";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { FinanceDateInput, FinanceMonthInput } from "./FinanceDateInputs";
import { FinanceOptionStatus } from "./FinanceActivity";
import { FinancePlanCategories } from "./FinancePlanCategories";
import { financeDrawerFooter, financeSheet, formatPHP as money } from "@/features/finance/presentation";
import type { FinanceReportsController } from "@/features/finance/use-finance-reports";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import type { FinanceBudgetController } from "@/features/finance/use-finance-budget";

export function FinanceReports({ reports, onCategory }: { reports: FinanceReportsController; onCategory: (id: string) => void }) {
  const [dates, setDates] = useState(reports.dates);
  const appliedKey = useRef(reports.dates.date_from + reports.dates.date_to);
  const report = reports.report;
  useEffect(() => {
    const key = reports.dates.date_from + reports.dates.date_to;
    if (key === appliedKey.current) return;
    // Drafts follow externally applied report months so the form never shows
    // stale dates from its initial mount.
    appliedKey.current = key;
    setDates(reports.dates);
  }, [reports.dates]);
  function setMonth(month: string) {
    const from = `${month}-01`;
    const to = format(lastDayOfMonth(parse(month, "yyyy-MM", new Date())), "yyyy-MM-dd");
    if (`${from}${to}` === appliedKey.current) return;
    reports.applyDates({ date_from: from, date_to: to });
  }
  return <section aria-label="Spending reports" className="flex flex-col gap-4">
    <form onSubmit={event => { event.preventDefault(); reports.applyDates(dates); }} className="flex flex-wrap items-end gap-2">
      <div className="w-auto"><Field><FieldLabel htmlFor="report-month" className="text-xs">Report month</FieldLabel><FinanceMonthInput id="report-month" aria-label="Report month" className="w-auto" value={reports.dates.date_from.slice(0, 7)} onChange={setMonth} /></Field></div>
      <div className="w-36"><Field><FieldLabel htmlFor="report-from" className="text-xs">From</FieldLabel><FinanceDateInput id="report-from" required min="1000-01-01" max="9999-12-31" value={dates.date_from} onChange={value => setDates(current => ({ ...current, date_from: value }))} /></Field></div>
      <div className="w-36"><Field><FieldLabel htmlFor="report-to" className="text-xs">To</FieldLabel><FinanceDateInput id="report-to" required min={dates.date_from || "1000-01-01"} max="9999-12-31" value={dates.date_to} onChange={value => setDates(current => ({ ...current, date_to: value }))} /></Field></div>
      <Button type="submit" variant="outline">Update report</Button>
    </form>
    {reports.error ? <Alert><AlertDescription>{reports.error}<Button variant="outline" onClick={() => void reports.refresh()}>Retry reports</Button></AlertDescription></Alert> : !report ? <p role="status" className="py-2 text-sm text-muted-foreground">Loading reports…</p> : <>
      <p className="text-sm text-muted-foreground">{report.date_from} to {report.date_to}. Actuals follow transaction dates across all accounts. Limits cover whole calendar months, with no rollover.</p>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Income in range</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums">{money(report.income_cents)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Spending in range</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums">{money(report.spending_cents)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Unbudgeted spending</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums">{money(report.unbudgeted_cents)}</dd></div>
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Category spending versus budget</h3>
        <p className="text-xs text-muted-foreground">Select a category to inspect activity. Refunds reduce spending.</p>
        {report.categories.length ? <>
          <div className="overflow-x-auto"><Table aria-label="Category spending versus budget">
          <TableHeader><TableRow>
            <TableHead className="whitespace-normal">Category</TableHead>
            <TableHead className="text-right">Spent</TableHead>
            <TableHead className="text-right">Limit</TableHead>
            <TableHead className="text-right">Unbudgeted</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {report.categories.map(row => <TableRow key={row.category_id ?? "uncategorized"}>
              <TableCell className="whitespace-normal">
                {row.category_id ? <Button variant="link" className="h-auto min-h-8 max-w-full whitespace-normal px-0 text-left" onClick={() => onCategory(row.category_id!)} aria-label={`View activity for ${row.name}`}>{row.name}</Button> : <span className="text-sm font-medium">{row.name}</span>}
                {row.overspent && <p className="text-xs text-destructive">Over budget in a selected month</p>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(row.spending_cents)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.budget_cents === null ? <span className="text-muted-foreground">No budget</span> : money(row.budget_cents)}</TableCell>
              <TableCell className={row.unbudgeted_cents === 0 ? "text-right tabular-nums text-muted-foreground" : "text-right tabular-nums"}>{row.unbudgeted_cents === 0 ? "—" : money(row.unbudgeted_cents)}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table></div>
      </> : <p className="py-2 text-sm text-muted-foreground">No spending or budgets for these dates. Set a limit in Planning or record an expense.</p>}
      </div>
      {report.total > 50 && <nav aria-label="Report category pages" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={reports.offset === 0} onClick={() => reports.setOffset(Math.max(0, reports.offset - 50))}>Previous categories</Button><span className="text-sm">{reports.offset + 1}-{Math.min(reports.offset + 50, report.total)} of {report.total}</span><Button variant="outline" disabled={reports.offset + 50 >= report.total} onClick={() => reports.setOffset(reports.offset + 50)}>Next categories</Button></nav>}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Monthly income and spending</h3>
        <div className="overflow-x-auto"><Table aria-label="Monthly income and spending">
          <TableHeader><TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="text-right">Income</TableHead>
            <TableHead className="text-right">Spending</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {report.months.map(row => <TableRow key={row.month}>
              <TableCell>{row.month}</TableCell>
              <TableCell className="text-right tabular-nums">{money(row.income_cents)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(row.spending_cents)}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table></div>
      </div>
      <section aria-label="Planned forecast" className="border-t border-border pt-4"><h3 className="text-sm font-medium">Planned forecast</h3><p className="mt-1 text-xs text-muted-foreground">Pending plans due in this range. Forecasts do not change balances or budgets.</p><dl className="mt-2 grid grid-cols-2 gap-3"><div><dt className="text-xs text-muted-foreground">Planned income</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums">{money(report.forecast.income_cents)}</dd></div><div><dt className="text-xs text-muted-foreground">Planned spending</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums">{money(report.forecast.spending_cents)}</dd></div></dl></section>
    </>}
  </section>;
}

export function FinanceBudgets({
  budget,
  activity,
  reports,
  focusCategoryId,
  focusMonth,
  onFocusHandled,
}: {
  budget: FinanceBudgetController;
  activity: FinanceActivityController;
  reports: FinanceReportsController;
  focusCategoryId?: string | null;
  focusMonth?: string | null;
  onFocusHandled?: () => void;
}) {
  const { open, setOpen, category, setCategory, month, setMonth, mode, setMode, amount, setAmount, snapshot, loadError, busy, saveError } = budget;
  const openFocusedBudget = useEffectEvent(async (categoryId: string, monthValue: string) => {
    try {
      await activity.ensureClassification(categoryId);
    } finally {
      budget.openForReview(categoryId, monthValue);
      onFocusHandled?.();
    }
  });
  useEffect(() => {
    if (!focusCategoryId || !focusMonth) return;
    void openFocusedBudget(focusCategoryId, focusMonth);
  }, [focusCategoryId, focusMonth, onFocusHandled]);
  const report = reports.report;
  const reportMonth = reports.dates.date_from.slice(0, 7);
  const reportMonthDate = parse(reportMonth, "yyyy-MM", new Date());
  const monthLabel = isValid(reportMonthDate) ? format(reportMonthDate, "MMMM yyyy") : reportMonth;
  function setReportMonth(monthValue: string) {
    const from = `${monthValue}-01`;
    const to = format(lastDayOfMonth(parse(monthValue, "yyyy-MM", new Date())), "yyyy-MM-dd");
    if (`${from}${to}` === reports.dates.date_from + reports.dates.date_to) return;
    reports.applyDates({ date_from: from, date_to: to });
  }
  const limitCents = (report?.categories ?? []).reduce((sum, row) => sum + (row.budget_cents ?? 0), 0);
  const spent = report?.spending_cents ?? 0;
  const spendPercent = limitCents > 0 ? Math.min(100, Math.round((spent / limitCents) * 100)) : 0;
  const overLimit = limitCents > 0 && spent > limitCents;
  const categoryRows = report ? [...report.categories].sort((a, b) => {
    if (a.overspent !== b.overspent) return a.overspent ? -1 : 1;
    const budgetedA = a.budget_cents !== null, budgetedB = b.budget_cents !== null;
    if (budgetedA !== budgetedB) return budgetedA ? -1 : 1;
    return b.spending_cents - a.spending_cents;
  }) : [];
  function reviewCategory(categoryId: string) {
    void activity.ensureClassification(categoryId).finally(() => budget.openForReview(categoryId, reportMonth));
  }
  return <section id="finance-budgets" aria-label="Monthly budgets">
    <Card size="sm">
      <CardHeader>
        <CardTitle>Monthly budgets</CardTitle>
        <CardDescription className="max-sm:col-start-1 max-sm:row-start-2">Category limits for {monthLabel}. Limits cover whole calendar months without rollover and include every subcategory and account.</CardDescription>
        <CardAction className="flex flex-wrap items-center gap-2 max-sm:col-start-1 max-sm:row-start-3">
          <FinanceMonthInput
            aria-label="Budget month"
            value={reportMonth}
            onChange={setReportMonth}
            className="min-h-8 w-auto text-xs"
          />
          <Button size="sm" onClick={() => setOpen(true)}>Set budget</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {budget.notice && <p role="status" className="text-sm">{budget.notice}</p>}
        <FinanceOptionStatus activity={activity} />
        {reports.error ? <Alert><AlertDescription>{reports.error}<Button variant="outline" onClick={() => void reports.refresh()}>Retry reports</Button></AlertDescription></Alert>
          : !report ? <p role="status" className="py-2 text-sm text-muted-foreground">Loading budgets and spending…</p>
            : <>
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xl font-semibold tabular-nums">{money(spent)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{limitCents ? `of ${money(limitCents)} in limits · ${spendPercent}%` : "No category limits yet"}</p>
                </div>
                <div
                  role="progressbar"
                  aria-label="Spending against category budgets"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={spendPercent}
                  className="mt-2 h-2 overflow-hidden rounded-sm bg-muted"
                >
                  <div className={cn("h-full", overLimit ? "bg-destructive" : "bg-primary")} style={{ width: `${spendPercent}%` }} />
                </div>
                {report.unbudgeted_cents !== 0 && <p className="mt-1.5 text-xs text-muted-foreground">Unbudgeted spending · <span className="tabular-nums">{money(report.unbudgeted_cents)}</span></p>}
              </div>
              {report.categories.length ? <>
                <div className="flex flex-col divide-y divide-border/60">
                  {categoryRows.map(row => {
                    const rowPercent = row.budget_cents !== null && row.budget_cents > 0 ? Math.min(100, Math.round((row.spending_cents / row.budget_cents) * 100)) : 0;
                    return <button
                      key={row.category_id ?? "uncategorized"}
                      type="button"
                      disabled={!row.category_id}
                      onClick={() => row.category_id && reviewCategory(row.category_id)}
                      className="flex w-full items-center justify-between gap-3 rounded-sm px-1 py-2 text-left enabled:hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={row.category_id ? `Review budget for ${row.name}` : `${row.name}, unbudgeted`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-xs font-medium">{row.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums">
                          {row.budget_cents === null
                            ? <span className="text-muted-foreground">No budget for this month</span>
                            : <>
                              <span className="text-muted-foreground">{money(row.spending_cents)} of {money(row.budget_cents)}</span>
                              {row.overspent && <span className="text-destructive">{row.budget_cents > 0 ? `${Math.round((row.spending_cents / row.budget_cents) * 100)}% spent` : "Any spending is over the zero limit"}</span>}
                            </>}
                        </span>
                        {row.budget_cents !== null && row.budget_cents > 0 && <span
                          role="progressbar"
                          aria-label={`${row.name} spending against its limit`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={rowPercent}
                          className="mt-1.5 block h-1.5 overflow-hidden rounded-sm bg-muted"
                        >
                          <span className={cn("block h-full", row.overspent ? "bg-destructive" : "bg-primary")} style={{ width: `${rowPercent}%` }} />
                        </span>}
                      </span>
                      <span className="shrink-0 text-right text-xs font-semibold tabular-nums">{money(row.spending_cents)}</span>
                    </button>;
                  })}
                </div>
                {report.total > report.categories.length && <p className="text-xs text-muted-foreground">Spending covers all categories; these limits cover the first {report.categories.length} of {report.total}. See Detailed spending reports in Overview for the rest.</p>}
              </> : <Empty className="py-2">
                <EmptyHeader>
                  <EmptyTitle>No spending or budgets for {monthLabel}</EmptyTitle>
                  <EmptyDescription>Set a category limit to start planning this month.</EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={() => setOpen(true)}>Set budget</Button>
              </Empty>}
            </>}
      </CardContent>
    </Card>
    <Sheet open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><SheetContent showCloseButton={false} className={financeSheet}>
      <SheetHeader className="border-b border-border p-4"><SheetTitle>Set monthly budget</SheetTitle><SheetDescription>Choose a forward limit or an explicit correction to one month.</SheetDescription></SheetHeader>
      <form onSubmit={event => { event.preventDefault(); void budget.save(); }} className="flex flex-1 flex-col gap-6 p-4 pb-0 sm:p-6 sm:pb-0">
        <FieldGroup className="gap-6">
          <FinancePlanCategories
            activity={activity}
            type="expense"
            value={category}
            onChange={setCategory}
            disabled={busy}
            id="budget-category"
          />
          <FieldGroup className="rounded-xl bg-muted/50 p-4">
            <Field><FieldLabel htmlFor="budget-month">Budget month</FieldLabel><FinanceMonthInput id="budget-month" required min="1000-01" max="9999-12" disabled={busy} value={month} onChange={setMonth} /></Field>
            <Field><FieldLabel htmlFor="budget-mode">Apply change</FieldLabel><NativeSelect id="budget-mode" className="w-full" disabled={busy} value={mode} onChange={event => setMode(event.target.value)}><NativeSelectOption value="forward">From this month onward</NativeSelectOption><NativeSelectOption value="correction">Correct this month only</NativeSelectOption></NativeSelect></Field>
            <FieldDescription>{mode === "forward" ? "Replaces all limits and corrections from this month onward. Earlier months stay unchanged." : "Changes only this month, preserving earlier and later limits."}</FieldDescription>
          </FieldGroup>
          <Field><FieldLabel htmlFor="budget-amount">Monthly limit (PHP)</FieldLabel><MoneyInput id="budget-amount" required inputMode="decimal" pattern="\d{1,3}(,\d{3})*(\.\d{1,2})?" className="tabular-nums" placeholder="0.00" disabled={busy || !snapshot} value={amount} onValueChange={value => setAmount(value)} /><FieldDescription>{snapshot ? `Current limit: ${snapshot.limit_cents === null ? "no budget" : money(snapshot.limit_cents)}. A zero limit warns on any spending.` : category ? "Loading the selected limit…" : "Choose a category first."}</FieldDescription></Field>
          {loadError && <Alert><AlertDescription>{loadError}<Button variant="outline" onClick={budget.refresh}>Retry budget</Button></AlertDescription></Alert>}
          {saveError && <Alert><AlertDescription>{saveError} Refresh the selected limit before changing a stale version.<Button variant="outline" disabled={busy} onClick={budget.refresh}>Refresh budget</Button></AlertDescription></Alert>}
        </FieldGroup>
        <div className={financeDrawerFooter}><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || !snapshot || !amount}>{busy ? "Saving…" : "Save budget"}</Button></div>
      </form>
    </SheetContent></Sheet>
  </section>;
}
