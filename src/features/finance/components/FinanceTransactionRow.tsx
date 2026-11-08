"use client";

import { useState, type ReactNode } from "react";
import {
  IconArrowBarDown, IconArrowBarUp, IconArrowDownLeft, IconArrowUpRight, IconArrowsExchange,
  IconChartLine, IconChevronDown, IconReceiptRefund, IconScale,
} from "@tabler/icons-react";
import { cn } from "cn";
import type { FinanceTransaction } from "../activity-types";
import { formatHistoryDate, formatPHP, localCalendarDate } from "../presentation";
import { directionOf, groupByDay, relativeDayLabel } from "../transaction-days";

const icons = {
  expense: IconArrowUpRight, income: IconArrowDownLeft, transfer: IconArrowsExchange, refund: IconReceiptRefund,
  reconciliation: IconScale, valuation: IconChartLine, borrowing: IconArrowBarDown, lending: IconArrowBarUp,
};

const tone = { in: "text-success", out: "text-destructive", neutral: "text-muted-foreground" };
const tile = { in: "bg-success/15 text-success", out: "bg-destructive/15 text-destructive", neutral: "bg-muted text-muted-foreground" };

/** One transaction as a card; the whole card is the inspect/select button. */
export function FinanceTransactionRow({ row, title, context, note, compact, ariaLabel, onClick }: {
  row: FinanceTransaction; title: string; context?: string; note?: string; compact?: boolean; ariaLabel: string; onClick: () => void;
}) {
  const direction = directionOf(row.type);
  const Icon = icons[row.type];
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  const state = [row.hidden && "Hidden", row.reverted && "Reverted"].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg bg-muted/40 px-2.5 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring active:bg-muted",
        (row.hidden || row.reverted) && "opacity-60",
      )}
    >
      <span aria-hidden="true" className={cn("grid size-6 shrink-0 place-items-center rounded-md", tile[direction])}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {(context || state) && (
          <span className="block truncate text-xs text-muted-foreground">
            {[context, state].filter(Boolean).join(" · ")}
          </span>
        )}
        {/* The note stays its own element so the e2e contract (exact text, one truncated line) holds. */}
        {note && <span className="block truncate text-xs text-muted-foreground">{note}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <strong className={cn("tabular-nums", compact ? "text-xs" : "text-sm", tone[direction])}>{sign}{formatPHP(row.amount_cents)}</strong>
        <span className={cn("truncate rounded-md border border-border text-muted-foreground", compact ? "max-w-24 px-1 text-[10px] leading-4" : "max-w-32 px-1.5 text-xs")}>{row.account_name}</span>
      </span>
    </button>
  );
}

/** Rows grouped under collapsible day headers with in/out totals. Edge-day totals are hidden when the day spans pages. */
export function FinanceTransactionDays({ rows, firstComplete, lastComplete, renderRow }: {
  rows: FinanceTransaction[]; firstComplete: boolean; lastComplete: boolean; renderRow: (row: FinanceTransaction) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const today = localCalendarDate();
  const days = groupByDay(rows);
  return (
    <div className="flex flex-col gap-3">
      {days.map((day, index) => {
        const closed = collapsed.has(day.date);
        // A day at either page edge may continue on the neighbouring page, so its totals would be partial.
        const showTotals = (index > 0 || firstComplete) && (index < days.length - 1 || lastComplete);
        const label = relativeDayLabel(day.date, today);
        return (
          <section key={day.date} aria-label={formatHistoryDate(day.date)} className="flex flex-col gap-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_240px]">
            <button
              type="button"
              aria-expanded={!closed}
              onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (!next.delete(day.date)) next.add(day.date); return next; })}
              className="flex items-center gap-2 rounded-md px-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <IconChevronDown aria-hidden="true" className={cn("size-4 text-muted-foreground transition-transform", closed && "-rotate-90")} />
              <span className="flex-1">
                <span className="block text-sm font-semibold">{label ?? formatHistoryDate(day.date)}</span>
                {label && <span className="block text-xs text-muted-foreground">{formatHistoryDate(day.date)}</span>}
              </span>
              {showTotals && day.outCents > 0 && <span className="rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-medium tabular-nums text-destructive">−{formatPHP(day.outCents)}</span>}
              {showTotals && day.inCents > 0 && <span className="rounded-md bg-success/15 px-2 py-0.5 text-xs font-medium tabular-nums text-success">+{formatPHP(day.inCents)}</span>}
            </button>
            {!closed && <ul className="flex flex-col gap-1.5">{day.rows.map((row) => <li key={row.id}>{renderRow(row)}</li>)}</ul>}
          </section>
        );
      })}
    </div>
  );
}
