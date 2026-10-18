"use client";

import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import type { FinancePlan } from "../planning-types";
import type { FinancePlanningController } from "../use-finance-planning";
import { useFinanceSchedulePayments } from "../use-finance-schedule-payments";
import { formatPHP, localCalendarDate } from "../presentation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

function humanDate(iso: string | null | undefined) {
  return iso ? format(new Date(`${iso}T12:00:00`), "MMMM d, yyyy") : "";
}

export function FinanceSchedulePayments({ scheduleId, paused, nextDueDate, pendingCount, planning, renderPayment }: { scheduleId: string; paused: boolean; nextDueDate: string | null; pendingCount?: number | null; planning: FinancePlanningController; renderPayment: (plan: FinancePlan, onDone: () => void, onRefresh: () => void) => ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const payments = useFinanceSchedulePayments(scheduleId, planning.notice);
  const { page, error, loading, offset, setOffset, retry } = payments;
  const selected = page?.plans.find(plan => plan.id === selectedId);
  const today = localCalendarDate();
  const needsPreparation = !paused && nextDueDate !== null && (pendingCount == null ? page?.total === 0 : pendingCount === 0);
  return <section aria-label="Plan payments" className="flex flex-col gap-2">
    {planning.notice && <p role="status" className="text-sm">{planning.notice}</p>}
    {selected && renderPayment(selected, () => { setSelectedId(null); retry(); }, () => { planning.resetSave(); retry(); })}
    {error ? <Alert><AlertDescription>{error}<Button variant="outline" onClick={retry}>Retry payments</Button></AlertDescription></Alert> : loading ? <p role="status" className="text-sm">Loading payments…</p> : page?.plans.length ? <>
      <h3 className="text-sm font-medium text-muted-foreground">Payments, newest to oldest</h3>
      <ul className="flex flex-col divide-y divide-border">{page.plans.map(plan => <FinanceSchedulePaymentRow key={plan.id} plan={plan} today={today} busy={planning.busy} onReview={id => { planning.resetSave(); setSelectedId(id); }} />)}</ul>
    </>
      : <p className="text-sm text-muted-foreground">{paused ? "No payments yet." : "No payments yet. The next occurrence prepares when it becomes due."}</p>}
    {page && page.total > page.limit && <nav aria-label="Payment pages" className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={loading || !offset} onClick={() => setOffset(Math.max(0, offset - page.limit))}>Previous payments</Button><span className="text-xs">{offset + 1}–{Math.min(offset + page.limit, page.total)} of {page.total}</span><Button variant="outline" disabled={loading || offset + page.limit >= page.total} onClick={() => setOffset(offset + page.limit)}>Next payments</Button></nav>}
    {(planning.hasMoreCatchUp || needsPreparation) && <div className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">{planning.hasMoreCatchUp ? "More missed payments remain to be prepared. This loads the next batch across your schedules." : "Prepare the next payment so you can review or edit it."}</p><Button variant="outline" disabled={planning.busy} onClick={() => void planning.save(null, "catch-up", {}).then(result => { if (result) retry(); })}>{planning.hasMoreCatchUp ? "Load more missed payments" : "Prepare payments"}</Button></div>}
  </section>;
}


export function FinanceSchedulePaymentRow({ plan, today, busy, onReview }: { plan: FinancePlan; today: string; busy: boolean; onReview: (id: string) => void }) {
  const pending = plan.status === "pending";
  const overdue = pending && plan.due_date < today;
  const status = !pending ? plan.status === "satisfied" ? "Recorded" : "Skipped" : overdue ? "Overdue" : plan.due_date === today ? "Due today" : "Upcoming";
  return <li className="flex items-center gap-2 py-2">
    <span className={`mt-0.5 size-2 shrink-0 rounded-full ${pending ? overdue ? "bg-destructive" : plan.due_date === today ? "bg-primary" : "bg-foreground/30" : "bg-muted-foreground/40"}`} aria-hidden />
    <button className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" disabled={busy} onClick={() => onReview(plan.id)} aria-label={`Open payment due ${humanDate(plan.due_date)}`}>
      <span className="min-w-0"><span className="block text-sm font-medium">{humanDate(plan.due_date)}</span><span className="mt-0.5 block text-xs text-muted-foreground">{status} · {plan.handling === "automatic" ? "Automatic" : "Manual"}</span></span>
      <span className="text-sm font-medium tabular-nums">{formatPHP(plan.amount_cents)}</span>
    </button>
    {pending && <Button disabled={busy} onClick={() => onReview(plan.id)} aria-label={`Confirm ${plan.type === "income" ? "income" : "payment"} due ${humanDate(plan.due_date)}`}>{plan.type === "income" ? "Confirm income" : "Confirm"}</Button>}
  </li>;
}
