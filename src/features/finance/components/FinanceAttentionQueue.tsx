"use client";

import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconReceipt,
  IconTarget,
} from "@tabler/icons-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { FinanceAttentionItem } from "@/features/finance/overview-types";
import { MAX_FINANCE_ATTENTION_OFFSET } from "@/features/finance/overview-types";
import type { FinanceAttentionController } from "@/features/finance/use-finance-attention";
import { financeControl, formatPHP } from "@/features/finance/presentation";

interface FinanceAttentionQueueProps {
  attention: FinanceAttentionController;
  onReview: (item: FinanceAttentionItem) => void;
}

function itemIcon(item: FinanceAttentionItem) {
  if (item.kind === "allocation_shortfall") return IconTarget;
  if (item.kind === "budget_overrun") return IconAlertTriangle;
  if (item.kind === "obligation_due") return IconReceipt;
  return IconCalendarEvent;
}

function urgencyLabel(item: FinanceAttentionItem) {
  if (item.urgency === "overdue") return "Overdue";
  if (item.urgency === "due") return "Due today";
  if (item.urgency === "warning") return "Review needed";
  return "Upcoming";
}

function targetLabel(item: FinanceAttentionItem) {
  if (item.target === "budgets") return "Review budgets";
  if (item.target === "goals") return "Review goals";
  if (item.target === "obligations") return "Review obligations";
  return "Review planning";
}

export function FinanceAttentionQueue({ attention, onReview }: FinanceAttentionQueueProps) {
  const page = attention.page;
  const maxVisibleItems = page ? MAX_FINANCE_ATTENTION_OFFSET + page.limit : 0;
  return (
    <section aria-label="Needs attention">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-[650]">Needs attention</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Pending decisions and current planning warnings.
          </p>
        </div>
        {page && page.total > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            Showing {page.offset + 1}–{Math.min(page.offset + page.items.length, page.total)} of {page.total}
          </span>
        )}
      </div>
      {attention.error ? (
        <Alert>
          <AlertDescription>
            {attention.error}
            <Button
              variant="outline"
              className={`${financeControl} mt-3`}
              onClick={() => void attention.refresh()}
            >
              Retry attention queue
            </Button>
          </AlertDescription>
        </Alert>
      ) : attention.loading && !attention.page ? (
        <p role="status" className="py-5 text-sm text-muted-foreground">
          Loading attention queue…
        </p>
      ) : !page?.items.length ? (
        <Empty className="border border-border bg-card px-4 py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconCalendarEvent aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Nothing needs review</EmptyTitle>
            <EmptyDescription>
              Upcoming plans, due obligations, budget overruns, and allocation shortfalls appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {page.items.map((item) => {
            const Icon = itemIcon(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => onReview(item)}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {urgencyLabel(item)}{item.due_date ? ` · ${item.due_date}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-medium tabular-nums">{formatPHP(item.amount_cents)}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{targetLabel(item)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {page.total > page.limit && (
          <nav aria-label="Attention pages" className="mt-3 flex items-center justify-between gap-3">
            <Button
              variant="outline"
              className={financeControl}
              disabled={page.offset === 0 || attention.loading}
              onClick={() => attention.setOffset(Math.max(0, page.offset - page.limit))}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {Math.floor(page.offset / page.limit) + 1} of {Math.ceil(Math.min(page.total, maxVisibleItems) / page.limit)}
            </span>
            <Button
              variant="outline"
              className={financeControl}
              disabled={page.offset + page.items.length >= page.total || page.offset + page.limit > MAX_FINANCE_ATTENTION_OFFSET || attention.loading}
              onClick={() => attention.setOffset(page.offset + page.limit)}
            >
              Next
            </Button>
          </nav>
        )}
        {page.total > maxVisibleItems && page.offset + page.items.length >= maxVisibleItems && (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            The queue shows its first {maxVisibleItems.toLocaleString()} items. Review Planning, Budgets, Goals, or Obligations for any remaining items.
          </p>
        )}
        </>
      )}
    </section>
  );
}
