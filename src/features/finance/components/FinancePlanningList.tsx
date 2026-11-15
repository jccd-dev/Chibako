"use client";

import { format } from "date-fns";
import { IconArrowDownLeft, IconArrowUpRight } from "@tabler/icons-react";
import { cn } from "cn";
import type { PlanningItem } from "../planning-list-types";
import type { FinancePlanningListController } from "../use-finance-planning-list";
import { flowTile, flowTone, formatPHP } from "../presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { LoadingStatus } from "@/components/LoadingStatus";

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
function statusBadge(item: PlanningItem): "destructive" | "secondary" | null {
  if (item.automatic_error || item.status === "overdue") return "destructive";
  if (item.status === "due-today") return "secondary";
  return null;
}
const groups = [
  { type: "income", label: "Income", name: "Income plans", direction: "in", sign: "+", Icon: IconArrowDownLeft },
  { type: "expense", label: "Expenses", name: "Expense plans", direction: "out", sign: "−", Icon: IconArrowUpRight },
] as const;

export function FinancePlanningList({ list, onAdd, onOpen, busy }: { list: FinancePlanningListController; onAdd: () => void; onOpen: (item: PlanningItem) => void; busy: boolean }) {
  const { page, error, loading, filter, offset, setOffset, changeFilter, refresh } = list;
  return <section id="finance-plans" aria-label="Plans">
    <Card size="sm">
      <CardHeader>
        <CardTitle>Plans</CardTitle>
        <CardDescription className="max-sm:col-start-1 max-sm:row-start-2">Repeating and one-time income and expenses. Open a plan to review its payments.</CardDescription>
        <CardAction className="max-sm:col-start-1 max-sm:row-start-3">
          <Button size="sm" disabled={busy} onClick={onAdd}>Add plan</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ToggleGroup aria-label="Filter plans" variant="outline" value={[filter]} onValueChange={values => { if (values[0]) changeFilter(values[0]); }} className="w-full flex-wrap justify-start">
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="income">Income</ToggleGroupItem>
          <ToggleGroupItem value="expense">Expenses</ToggleGroupItem>
          <ToggleGroupItem value="attention">Needs attention</ToggleGroupItem>
          <ToggleGroupItem value="paused">Paused</ToggleGroupItem>
        </ToggleGroup>
        {error ? <Alert><AlertDescription>{error}<Button variant="outline" onClick={refresh}>Retry plans</Button></AlertDescription></Alert>
          : loading ? <LoadingStatus className="py-3 text-sm text-muted-foreground">Loading plans…</LoadingStatus>
            : page?.items.length ? <div className="flex flex-col gap-4">{groups.map(({ type, label, name, direction, sign, Icon }) => {
              const items = page.items.filter(item => item.type === type);
              if (!items.length) return null;
              return <section key={type} aria-label={name}>
                <h3 className="flex items-center gap-2 px-1 pb-1 text-xs font-medium text-muted-foreground">
                  <span aria-hidden="true" className={cn("size-1.5 rounded-full", direction === "in" ? "bg-success" : "bg-destructive")} />
                  {label}<span className="tabular-nums">· {items.length}</span>
                </h3>
                <ul className="flex flex-col divide-y divide-border/60">{items.map(item => {
              const badgeVariant = statusBadge(item);
              // Next due already says when; only non-routine states earn a label.
              const badge = item.status === "upcoming" && !item.automatic_error ? null : statusLabel(item);
              return <li key={`${item.kind}:${item.id}`} className="py-0.5">
                <button
                  className="flex w-full items-start gap-3 rounded-sm px-1 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => onOpen(item)}
                  disabled={busy}
                  aria-label={`Open ${item.title}`}
                >
                  <span aria-hidden="true" className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", flowTile[direction])}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-xs font-medium">{item.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{cadence(item)} · {item.handling === "automatic" ? "Automatic" : "Manual"} · {item.account_name}</span>
                    {item.next_due_date && <span className="mt-0.5 block text-xs tabular-nums">Next due {format(new Date(`${item.next_due_date}T12:00:00`), "MMMM d, yyyy")}</span>}
                    {item.paused && item.overdue_count > 0 && <span className="mt-1 block text-xs">{item.overdue_count} overdue {item.overdue_count === 1 ? "payment still needs" : "payments still need"} review</span>}
                    {item.automatic_error && <span className="mt-1 block text-xs text-destructive">{item.automatic_error}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cn("block text-xs font-semibold tabular-nums", flowTone[direction])}><span className="sr-only">{label}: </span>{sign}{formatPHP(item.amount_cents)}</span>
                    {badgeVariant ? <Badge variant={badgeVariant} className="mt-1">{badge}</Badge> : badge && <span className="mt-0.5 block text-xs text-muted-foreground">{badge}</span>}
                  </span>
                </button>
                {item.manual_due_count > 0 && <div className="flex justify-end pl-11 pr-1 pb-2 pt-1"><Button variant="outline" disabled={busy} onClick={() => onOpen(item)}>{item.manual_due_count > 1 ? `Review ${item.manual_due_count} due payments` : "Review payment"}</Button></div>}
              </li>;
            })}</ul>
              </section>;
            })}</div>
              : <Empty className="px-0 py-2">
                <EmptyHeader>
                  <EmptyTitle>{filter === "all" ? "No plans yet" : "No matching plans"}</EmptyTitle>
                  <EmptyDescription>{filter === "all" ? "Add recurring income or an expense. Turn off recurring for a one-time plan." : "Choose another filter to see your other plans."}</EmptyDescription>
                </EmptyHeader>
                {filter === "all" && <Button variant="outline" disabled={busy} onClick={onAdd}>Add plan</Button>}
              </Empty>}
        {page && page.total > page.limit && <nav aria-label="Plan pages" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={loading || !offset} onClick={() => setOffset(Math.max(0, offset - page.limit))}>Previous plans</Button><span className="text-sm">{offset + 1}–{Math.min(offset + page.limit, page.total)} of {page.total}</span><Button variant="outline" disabled={loading || offset + page.limit >= page.total} onClick={() => setOffset(offset + page.limit)}>Next plans</Button></nav>}
      </CardContent>
    </Card>
  </section>;
}
