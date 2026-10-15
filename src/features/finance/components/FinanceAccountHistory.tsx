"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActivityPage } from "../activity-types";
import { financeJson } from "../client-json";
import { formatPHP, formatHistoryDate } from "../presentation";

const labels = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  reconciliation: "Balance adjustment",
  valuation: "Value adjustment",
  refund: "Refund",
  borrowing: "Borrowing",
  lending: "Lending",
};

export function FinanceAccountHistory({
  accountId,
  onHistory,
  onInspect,
}: {
  accountId: string;
  onHistory: () => void;
  onInspect: (id: string) => void;
}) {
  const [page, setPage] = useState<{ key: string; value: ActivityPage } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const requestKey = `${accountId}:${reload}`;
  const visiblePage = page?.key === requestKey ? page.value : null;
  const visibleError = error?.key === requestKey ? error.message : "";
  useEffect(() => {
    const abort = new AbortController();
    const query = new URLSearchParams({
      account_id: accountId,
      limit: "8",
      hidden: "all",
      reverted: "all",
    });
    void fetch(`/api/finance/activity?${query}`, { signal: abort.signal })
      .then(financeJson<ActivityPage>)
      .then((result) => {
        if (!abort.signal.aborted) setPage({ key: requestKey, value: result });
      })
      .catch((reason) => {
        if (!abort.signal.aborted)
          setError({ key: requestKey, message: reason instanceof Error
              ? reason.message
              : "Could not load account history." });
      });
    return () => abort.abort();
  }, [accountId, reload, requestKey]);

  return (
    <section className="flex flex-col gap-3" aria-label="Account history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-base font-medium">
          Connected history
        </h3>
        <Button variant="ghost" onClick={onHistory}>
          View full history
        </Button>
      </div>
      {visibleError ? (
        <Alert>
          <AlertDescription>
            {visibleError}
            <Button
              variant="outline"
              onClick={() => setReload((value) => value + 1)}
            >
              Retry history
            </Button>
          </AlertDescription>
        </Alert>
      ) : !visiblePage ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading history…
        </p>
      ) : !visiblePage.transactions.length ? (
        <p className="text-sm text-muted-foreground">
          No recorded activity. The opening balance is shown above.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {visiblePage.transactions.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onInspect(row.id)}
                aria-label={`Inspect ${row.type} ${formatPHP(row.amount_cents)} on ${formatHistoryDate(row.transaction_date)}`}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
              <span className="min-w-0 truncate text-sm font-medium">
                {row.obligation_payment
                  ? row.type === "expense"
                    ? "Debt payment"
                    : "Receivable collection"
                  : (row.category_name ?? labels[row.type])}
              </span>
              <p className="justify-self-end text-sm tabular-nums">
                {formatPHP(row.amount_cents)}
              </p>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {formatHistoryDate(row.transaction_date)}
                {row.destination_account_name
                  ? ` · ${row.account_name} to ${row.destination_account_name}`
                  : ""}
              </span>
              {row.hidden || row.reverted ? (
                <span className="col-span-2 text-xs text-muted-foreground">
                  {row.hidden ? "Hidden" : ""}
                  {row.hidden && row.reverted ? " · " : ""}
                  {row.reverted ? "Reverted" : ""}
                </span>
              ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {visiblePage && visiblePage.total > visiblePage.transactions.length && (
        <p className="text-xs text-muted-foreground">
          Latest {visiblePage.transactions.length} of {visiblePage.total} records. Full
          history includes inspection and corrections.
        </p>
      )}
    </section>
  );
}
