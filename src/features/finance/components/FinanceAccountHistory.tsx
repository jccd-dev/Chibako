"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActivityPage } from "../activity-types";
import { financeJson } from "../client-json";
import { formatPHP, formatHistoryDate } from "../presentation";
import { FinanceTransactionRow } from "./FinanceTransactionRow";

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
        <ul className="flex flex-col gap-1.5">
          {visiblePage.transactions.map((row) => (
            <li key={row.id}>
              <FinanceTransactionRow
                row={row}
                title={row.obligation_payment
                  ? row.type === "expense" ? "Debt payment" : "Receivable collection"
                  : (row.category_name ?? labels[row.type])}
                context={[
                  formatHistoryDate(row.transaction_date),
                  row.destination_account_name ? `${row.account_name} to ${row.destination_account_name}` : "",
                ].filter(Boolean).join(" · ")}
                ariaLabel={`Inspect ${row.type} ${formatPHP(row.amount_cents)} on ${formatHistoryDate(row.transaction_date)}`}
                onClick={() => onInspect(row.id)}
              />
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
