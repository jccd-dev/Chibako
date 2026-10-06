"use client";

import { useEffect, useRef, useState } from "react";
import { format, lastDayOfMonth, parse } from "date-fns";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { FinanceDateInput, FinanceMonthInput } from "./FinanceDateInputs";
import { FinanceOptionStatus } from "./FinanceActivity";
import { financeControl as control, financeSelect as select, financeSheet, formatPHP as money } from "@/features/finance/presentation";
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
  return <section aria-label="Spending reports" className="border-b border-border py-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Spending reports</h2>
      <FinanceMonthInput
        aria-label="Report month"
        value={reports.dates.date_from.slice(0, 7)}
        onChange={setMonth}
        className="w-auto"
      />
    </div>
    <form onSubmit={event => { event.preventDefault(); reports.applyDates(dates); }} className="my-3 flex flex-wrap items-end gap-2">
      <div className="w-36"><Field><FieldLabel htmlFor="report-from" className="text-xs">From</FieldLabel><FinanceDateInput id="report-from" required min="1000-01-01" max="9999-12-31" value={dates.date_from} onChange={value => setDates(current => ({ ...current, date_from: value }))} /></Field></div>
      <div className="w-36"><Field><FieldLabel htmlFor="report-to" className="text-xs">To</FieldLabel><FinanceDateInput id="report-to" required min={dates.date_from || "1000-01-01"} max="9999-12-31" value={dates.date_to} onChange={value => setDates(current => ({ ...current, date_to: value }))} /></Field></div>
      <Button type="submit" variant="outline" className={control}>Update report</Button>
    </form>
    {reports.error ? <Alert><AlertDescription>{reports.error}<Button variant="outline" className={control} onClick={() => void reports.refresh()}>Retry reports</Button></AlertDescription></Alert> : !report ? <p role="status" className="py-5 text-sm text-muted-foreground">Loading reports…</p> : <>
      <p className="text-sm text-muted-foreground">{report.date_from} to {report.date_to}. Actuals follow transaction dates across all accounts. Limits cover whole calendar months, with no rollover.</p>
      <dl className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div><dt className="text-sm text-muted-foreground">Income in range</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{money(report.income_cents)}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Spending in range</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{money(report.spending_cents)}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Unbudgeted spending</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{money(report.unbudgeted_cents)}</dd></div>
      </dl>
      <h3 className="text-base font-semibold">Category spending versus budget</h3>
      <p className="mt-2 text-xs text-muted-foreground">Select a category to inspect activity. Refunds reduce spending.</p>
      {report.categories.length ? <>
        <div className="mt-3"><Table aria-label="Category spending versus budget">
          <TableHeader><TableRow>
            <TableHead className="whitespace-normal">Category</TableHead>
            <TableHead className="text-right">Spent</TableHead>
            <TableHead className="text-right">Limit</TableHead>
            <TableHead className="text-right">Unbudgeted</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {report.categories.map(row => <TableRow key={row.category_id ?? "uncategorized"}>
              <TableCell className="whitespace-normal">
                {row.category_id ? <Button variant="link" className={`${control} h-auto min-h-8 max-w-full whitespace-normal px-0 text-left`} onClick={() => onCategory(row.category_id!)} aria-label={`View activity for ${row.name}`}>{row.name}</Button> : <span className="text-sm font-medium">{row.name}</span>}
                {row.overspent && <p className="text-xs text-destructive">Over budget in a selected month</p>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(row.spending_cents)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.budget_cents === null ? <span className="text-muted-foreground">No budget</span> : money(row.budget_cents)}</TableCell>
              <TableCell className={row.unbudgeted_cents === 0 ? "text-right tabular-nums text-muted-foreground" : "text-right tabular-nums"}>{row.unbudgeted_cents === 0 ? "—" : money(row.unbudgeted_cents)}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table></div>
      </> : <p className="py-5 text-sm text-muted-foreground">No spending or budgets for these dates. Set a limit in Planning or record an expense.</p>}
      {report.total > 50 && <nav aria-label="Report category pages" className="my-4 flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={reports.offset === 0} onClick={() => reports.setOffset(Math.max(0, reports.offset - 50))}>Previous categories</Button><span className="text-sm">{reports.offset + 1}-{Math.min(reports.offset + 50, report.total)} of {report.total}</span><Button variant="outline" className={control} disabled={reports.offset + 50 >= report.total} onClick={() => reports.setOffset(reports.offset + 50)}>Next categories</Button></nav>}
      <h3 className="mt-4 text-base font-semibold">Monthly income and spending</h3>
      <div className="mt-3"><Table aria-label="Monthly income and spending">
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
      <section aria-label="Planned forecast" className="mt-4"><h3 className="text-base font-semibold">Planned forecast</h3><p className="mt-2 text-xs text-muted-foreground">Pending plans due in this range. Forecasts do not change balances or budgets.</p><dl className="mt-3 grid grid-cols-2 gap-3"><div><dt className="text-sm text-muted-foreground">Planned income</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{money(report.forecast.income_cents)}</dd></div><div><dt className="text-sm text-muted-foreground">Planned spending</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{money(report.forecast.spending_cents)}</dd></div></dl></section>
    </>}
  </section>;
}

export function FinanceBudgets({ budget, activity }: { budget: FinanceBudgetController; activity: FinanceActivityController }) {
  const { open, setOpen, category, setCategory, month, setMonth, mode, setMode, amount, setAmount, snapshot, loadError, busy, saveError } = budget;
  const categories = activity.classifications.filter(row => row.kind === "category" && row.type === "expense" && !row.parent_id);
  return <section aria-label="Monthly budgets">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Monthly budgets</h2><p className="mt-2 max-w-prose text-sm text-muted-foreground">Expense-category limits include all subcategories and accounts. Calendar months start on day 1, without rollover.</p></div><Button className={control} onClick={() => setOpen(true)}>Set budget</Button></div>
    <p className="mt-5 text-sm text-muted-foreground">Review spending against limits in Overview. Forward changes preserve earlier months. Use an explicit correction for one month.</p>
    {budget.notice && <p role="status" className="mt-4 text-sm">{budget.notice}</p>}
    <FinanceOptionStatus activity={activity} />
    <Sheet open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><SheetContent showCloseButton={false} className={financeSheet}>
      <SheetHeader className="border-b border-border p-6"><SheetTitle>Set monthly budget</SheetTitle><SheetDescription>Choose a forward limit or an explicit correction to one month.</SheetDescription></SheetHeader>
      <form onSubmit={event => { event.preventDefault(); void budget.save(); }} className="flex flex-1 flex-col gap-6 p-6">
        <FieldGroup>
          <Field><FieldLabel htmlFor="budget-category">Expense category</FieldLabel><select id="budget-category" required className={select} disabled={busy} value={category} onChange={event => setCategory(event.target.value)}><option value="">Choose a category</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}{row.archived ? " (archived)" : ""}</option>)}</select><FieldDescription>Includes subcategories. Create expense categories in Manage.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="budget-month">Budget month</FieldLabel><FinanceMonthInput id="budget-month" required min="1000-01" max="9999-12" disabled={busy} value={month} onChange={setMonth} /></Field>
          <Field><FieldLabel htmlFor="budget-mode">Apply change</FieldLabel><select id="budget-mode" className={select} disabled={busy} value={mode} onChange={event => setMode(event.target.value)}><option value="forward">From this month onward</option><option value="correction">Correct this month only</option></select><FieldDescription>{mode === "forward" ? "Replaces all limits and corrections from this month onward. Earlier months stay unchanged." : "Changes only this month, preserving earlier and later limits."}</FieldDescription></Field>
          <Field><FieldLabel htmlFor="budget-amount">Monthly limit (PHP)</FieldLabel><Input id="budget-amount" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" className={control} disabled={busy || !snapshot} value={amount} onChange={event => setAmount(event.target.value)} /><FieldDescription>{snapshot ? `Current limit: ${snapshot.limit_cents === null ? "no budget" : money(snapshot.limit_cents)}. A zero limit warns on any spending.` : category ? "Loading the selected limit…" : "Choose a category first."}</FieldDescription></Field>
        </FieldGroup>
        {loadError && <Alert><AlertDescription>{loadError}<Button variant="outline" className={control} onClick={budget.refresh}>Retry budget</Button></AlertDescription></Alert>}
        {saveError && <Alert><AlertDescription>{saveError} Refresh the selected limit before changing a stale version.<Button variant="outline" className={control} disabled={busy} onClick={budget.refresh}>Refresh budget</Button></AlertDescription></Alert>}
        <div className="mt-auto flex flex-wrap justify-end gap-3"><Button type="button" variant="outline" className={control} disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" className={control} disabled={busy || !snapshot || !amount}>{busy ? "Saving…" : "Save budget"}</Button></div>
      </form>
    </SheetContent></Sheet>
  </section>;
}
