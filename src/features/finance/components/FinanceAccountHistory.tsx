"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActivityPage } from "../activity-types";
import { financeJson } from "../client-json";
import { formatPHP } from "../presentation";

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
}: {
  accountId: string;
  onHistory: () => void;
}) {
  const [page, setPage] = useState<ActivityPage | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setPage(null);
    setError("");
    const query = new URLSearchParams({
      account_id: accountId,
      limit: "8",
      hidden: "all",
      reverted: "all",
    });
    void fetch(`/api/finance/activity?${query}`, { signal: abort.signal })
      .then(financeJson<ActivityPage>)
      .then((result) => {
        if (!abort.signal.aborted) setPage(result);
      })
      .catch((reason) => {
        if (!abort.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load account history.",
          );
      });
    return () => abort.abort();
  }, [accountId, reload]);

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
      {error ? (
        <Alert>
          <AlertDescription>
            {error}
            <Button
              variant="outline"
              onClick={() => setReload((value) => value + 1)}
            >
              Retry history
            </Button>
          </AlertDescription>
        </Alert>
      ) : !page ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading history…
        </p>
      ) : !page.transactions.length ? (
        <p className="text-sm text-muted-foreground">
          No recorded activity. The opening balance is shown above.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {page.transactions.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-start justify-between gap-2 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">
                  {row.obligation_payment
                    ? row.type === "expense"
                      ? "Debt payment"
                      : "Receivable collection"
                    : (row.category_name ?? labels[row.type])}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.transaction_date}
                  {row.hidden ? " / Hidden" : ""}
                  {row.reverted ? " / Reverted" : ""}
                </p>
                {row.destination_account_name && (
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {row.account_name} to {row.destination_account_name}
                  </p>
                )}
              </div>
              <p className="text-sm tabular-nums">
                {formatPHP(row.amount_cents)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {page && page.total > page.transactions.length && (
        <p className="text-xs text-muted-foreground">
          Latest {page.transactions.length} of {page.total} records. Full
          history includes inspection and corrections.
        </p>
      )}
    </section>
  );
}
