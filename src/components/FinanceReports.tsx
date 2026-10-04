"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { FinanceOptionStatus } from "./FinanceActivity";
import { financeControl as control, financeSelect as select, financeSheet, formatPHP as money } from "@/features/finance/presentation";
import type { FinanceReportsController } from "@/features/finance/use-finance-reports";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import type { FinanceBudgetController } from "@/features/finance/use-finance-budget";

export function FinanceReports({ reports, onCategory }: { reports: FinanceReportsController; onCategory: (id: string) => void }) {
  const [dates, setDates] = useState(reports.dates);
  const report = reports.report;
  return <section aria-label="Spending reports" className="border-b border-border py-6">
    <h2 className="text-lg font-semibold">Spending reports</h2>
    <form onSubmit={event => { event.preventDefault(); reports.applyDates(dates); }} className="my-5">
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="report-from">Report from</FieldLabel><Input id="report-from" type="date" min="1000-01-01" max="9999-12-31" required className={control} value={dates.date_from} onChange={event => setDates(current => ({ ...current, date_from: event.target.value }))} /></Field>
        <Field><FieldLabel htmlFor="report-to">Report to</FieldLabel><Input id="report-to" type="date" min={dates.date_from} max="9999-12-31" required className={control} value={dates.date_to} onChange={event => setDates(current => ({ ...current, date_to: event.target.value }))} /></Field>
      </FieldGroup>
      <Button type="submit" variant="outline" className={`${control} mt-4`}>Update report</Button>
    </form>
    {reports.error ? <Alert><AlertDescription>{reports.error}<Button variant="outline" className={control} onClick={() => void reports.refresh()}>Retry reports</Button></AlertDescription></Alert> : !report ? <p role="status" className="py-5 text-sm text-muted-foreground">Loading reports…</p> : <>
      <p className="text-sm text-muted-foreground">{report.date_from} to {report.date_to}. Actuals follow transaction dates across all accounts. Limits cover whole calendar months, with no rollover.</p>
      <dl className="my-6 grid gap-4 sm:grid-cols-3">
        <div><dt className="text-sm text-muted-foreground">Income in range</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{money(report.income_cents)}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Spending in range</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{money(report.spending_cents)}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Unbudgeted spending</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{money(report.unbudgeted_cents)}</dd></div>
      </dl>
      <h3 className="text-base font-semibold">Category spending versus budget</h3>
      <p className="mt-2 text-sm text-muted-foreground">Select a category to inspect its Activity, including hidden records. Refunds reduce spending on their refund dates. Overspending warns but never blocks entry.</p>
      {report.categories.length ? <ul className="mt-3 divide-y divide-border">{report.categories.map(row => <li key={row.category_id ?? "uncategorized"} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0">{row.category_id ? <Button variant="link" className={`${control} h-auto max-w-full whitespace-normal px-0 text-left`} onClick={() => onCategory(row.category_id!)} aria-label={`View activity for ${row.name}`}>{row.name}</Button> : <p className="text-sm font-medium">{row.name}</p>}
          {row.overspent && <p className="text-sm font-medium">Over budget in a selected month</p>}
        </div>
        <div className="text-right text-sm tabular-nums"><p>Spent {money(row.spending_cents)}</p><p className="mt-1 text-muted-foreground">{row.budget_cents === null ? "No budget" : `Limit ${money(row.budget_cents)}`}</p>{row.unbudgeted_cents !== 0 && <p className="mt-1 text-muted-foreground">Unbudgeted {money(row.unbudgeted_cents)}</p>}</div>
      </li>)}</ul> : <p className="py-5 text-sm text-muted-foreground">No spending or budgets for these dates. Set a limit in Planning or record an expense.</p>}
      {report.total > 50 && <nav aria-label="Report category pages" className="my-4 flex flex-wrap items-center gap-3"><Button variant="outline" className={control} disabled={reports.offset === 0} onClick={() => reports.setOffset(Math.max(0, reports.offset - 50))}>Previous categories</Button><span className="text-sm">{reports.offset + 1}-{Math.min(reports.offset + 50, report.total)} of {report.total}</span><Button variant="outline" className={control} disabled={reports.offset + 50 >= report.total} onClick={() => reports.setOffset(reports.offset + 50)}>Next categories</Button></nav>}
      <h3 className="mt-6 text-base font-semibold">Monthly income and spending</h3>
      <ul className="mt-3 divide-y divide-border">{report.months.map(row => <li key={row.month} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span>{row.month}</span><span className="flex flex-wrap gap-x-5 gap-y-2 tabular-nums"><span>Income {money(row.income_cents)}</span><span>Spending {money(row.spending_cents)}</span></span></li>)}</ul>
      <section aria-label="Planned forecast" className="mt-6"><h3 className="text-base font-semibold">Planned forecast</h3><p className="mt-2 text-sm text-muted-foreground">Not available yet. Pending activity will appear here separately and will never consume actual budgets.</p></section>
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
    <section className="mt-8 border-t border-border pt-6"><h3 className="text-base font-semibold">Planned activity</h3><p className="mt-2 text-sm text-muted-foreground">Plans, recurrence, goals, debts and receivables are not available yet. Planned forecasts stay separate from recorded spending.</p></section>
    <Sheet open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><SheetContent showCloseButton={false} className={financeSheet}>
      <SheetHeader className="border-b border-border p-6"><SheetTitle>Set monthly budget</SheetTitle><SheetDescription>Choose a forward limit or an explicit correction to one month.</SheetDescription></SheetHeader>
      <form onSubmit={event => { event.preventDefault(); void budget.save(); }} className="flex flex-1 flex-col gap-6 p-6">
        <FieldGroup>
          <Field><FieldLabel htmlFor="budget-category">Expense category</FieldLabel><select id="budget-category" required className={select} disabled={busy} value={category} onChange={event => setCategory(event.target.value)}><option value="">Choose a category</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}{row.archived ? " (archived)" : ""}</option>)}</select><FieldDescription>Includes subcategories. Create expense categories in Manage.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="budget-month">Budget month</FieldLabel><Input id="budget-month" type="month" required min="1000-01" max="9999-12" className={control} disabled={busy} value={month} onChange={event => setMonth(event.target.value)} /></Field>
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
