"use client";

import { format } from "date-fns";
import type { PlanningItem } from "../planning-list-types";
import type { FinancePlanningListController } from "../use-finance-planning-list";
import { formatPHP } from "../presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

function cadence(item: PlanningItem) {
  if (item.kind === "one-time") return "One-time";
  if (item.interval_count === 1) return { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" }[item.interval_unit ?? "month"];
  return `Every ${item.interval_count} ${item.interval_unit}s`;
}
function statusLabel(item: PlanningItem) {
  if (item.automatic_error) return "Needs attention";
  if (item.status === "overdue" && item.overdue_count > 1) return `${item.overdue_count} payments overdue`;
  return { overdue: "Overdue", "due-today": "Due today", upcoming: "Upcoming", paused: "Paused", ended: "Ended", recorded: "Recorded", cancelled: "Cancelled" }[item.status];
}

export function FinancePlanningList({ list, onAdd, onOpen, busy }: { list: FinancePlanningListController; onAdd: () => void; onOpen: (item: PlanningItem) => void; busy: boolean }) {
  const { page, error, loading, filter, offset, setOffset, changeFilter, refresh } = list;
  return <section id="finance-plans" aria-label="Plans" className="mt-8 border-t border-border pt-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Plans</h2><p className="mt-2 max-w-prose text-sm text-muted-foreground">Track repeating and one-time income and expenses. Open a plan to review its payments.</p></div><Button disabled={busy} onClick={onAdd}>Add plan</Button></div>
    <ToggleGroup aria-label="Filter plans" variant="outline" value={[filter]} onValueChange={values => { if (values[0]) changeFilter(values[0]); }} className="my-5 w-full flex-wrap justify-start">
      <ToggleGroupItem value="all" className="min-h-11 px-3">All</ToggleGroupItem><ToggleGroupItem value="attention" className="min-h-11 px-3">Needs attention</ToggleGroupItem><ToggleGroupItem value="upcoming" className="min-h-11 px-3">Upcoming</ToggleGroupItem><ToggleGroupItem value="paused" className="min-h-11 px-3">Paused</ToggleGroupItem>
    </ToggleGroup>
    {error ? <Alert><AlertDescription>{error}<Button variant="outline" onClick={refresh}>Retry plans</Button></AlertDescription></Alert> : loading ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading plans…</p> : page?.items.length ? <ul className="divide-y divide-border">{page.items.map(item => <li key={`${item.kind}:${item.id}`} className="py-2">
      <button className="flex min-h-11 w-full flex-wrap items-start justify-between gap-4 rounded-md px-2 py-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onOpen(item)} disabled={busy} aria-label={`Open ${item.title}`}>
        <span className="min-w-0 flex-1 basis-40"><span className="block break-words text-sm font-medium">{item.title}</span><span className="mt-1 block text-sm text-muted-foreground">{cadence(item)} · {item.handling === "automatic" ? "Automatic" : "Manual"} · {item.account_name}</span>
          <span className="mt-3 flex flex-wrap items-center gap-2"><Badge variant={item.status === "overdue" || item.automatic_error ? "destructive" : "outline"}>{statusLabel(item)}</Badge>{item.next_due_date && <span className="text-xs text-muted-foreground">{format(new Date(`${item.next_due_date}T12:00:00`), "MMMM d, yyyy")}</span>}</span>
          {item.paused && item.overdue_count > 0 && <span className="mt-2 block text-sm">{item.overdue_count} overdue {item.overdue_count === 1 ? "payment still needs" : "payments still need"} review</span>}
          {item.automatic_error && <span className="mt-2 block text-sm text-destructive">{item.automatic_error}</span>}
        </span><span className="shrink-0 text-right text-sm"><span className="block text-muted-foreground">{item.type === "income" ? "Income" : "Expense"}</span><strong className="mt-1 block tabular-nums">{formatPHP(item.amount_cents)}</strong></span>
      </button>
      {item.manual_due_count > 0 && <div className="flex justify-end px-2 pb-3"><Button variant="outline" disabled={busy} onClick={() => onOpen(item)}>{item.manual_due_count > 1 ? `Review ${item.manual_due_count} due payments` : "Review payment"}</Button></div>}
    </li>)}</ul> : <Empty><EmptyHeader><EmptyTitle>{filter === "all" ? "No plans yet" : "No matching plans"}</EmptyTitle><EmptyDescription>{filter === "all" ? "Add recurring income or an expense. Turn off recurring for a one-time plan." : "Choose another filter to see your other plans."}</EmptyDescription></EmptyHeader></Empty>}
    {page && page.total > page.limit && <nav aria-label="Plan pages" className="mt-5 flex flex-wrap items-center gap-3"><Button variant="outline" disabled={loading || !offset} onClick={() => setOffset(Math.max(0, offset - page.limit))}>Previous plans</Button><span className="text-sm">{offset + 1}–{Math.min(offset + page.limit, page.total)} of {page.total}</span><Button variant="outline" disabled={loading || offset + page.limit >= page.total} onClick={() => setOffset(offset + page.limit)}>Next plans</Button></nav>}
  </section>;
}
