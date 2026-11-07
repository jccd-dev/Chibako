"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { financeJson } from "../client-json";
import { formatHistoryDate, formatPHP } from "../presentation";
import type { FinanceAccount } from "../types";

interface InterestStatus { automatic_error: string | null; accrued_cents: number; next_payout_date: string | null }

export const interestFrequencyLabels = { daily: "Daily", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

export function FinanceInterestStatus({ account }: { account: FinanceAccount }) {
  const [status, setStatus] = useState<InterestStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/finance/accounts/${account.id}/interest`, { signal: abort.signal })
      .then(financeJson<InterestStatus>)
      .then((result) => { if (!abort.signal.aborted) setStatus(result); })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load interest status.");
      });
    return () => abort.abort();
  }, [account.id]);

  const { interest } = account;
  if (!interest && !error && !status?.next_payout_date && !status?.automatic_error) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="Automatic interest">
      <h3 className="font-heading text-base font-medium">Automatic interest</h3>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        {interest ? (
          <>
            <div>
              <dt className="text-muted-foreground">Annual rate</dt>
              <dd className="mt-1 tabular-nums">{interest.annual_rate}%</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Payout</dt>
              <dd className="mt-1">{interestFrequencyLabels[interest.frequency]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Withholding tax</dt>
              <dd className="mt-1 tabular-nums">{interest.withholding_tax}%</dd>
            </div>
          </>
        ) : (
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="mt-1">Off</dd>
          </div>
        )}
        {status && (
          <>
            <div>
              <dt className="text-muted-foreground">Accrued net</dt>
              <dd className="mt-1 tabular-nums">{formatPHP(status.accrued_cents)}</dd>
            </div>
            {status.next_payout_date && (
              <div>
                <dt className="text-muted-foreground">{interest ? "Next payout" : "Final payout"}</dt>
                <dd className="mt-1">{formatHistoryDate(status.next_payout_date)}</dd>
              </div>
            )}
          </>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">
        Modeled by Chibako, not confirmed by your bank. If past activity changes earlier earnings, the difference is added
        automatically as an interest adjustment.
      </p>
      {(error || status?.automatic_error) && (
        <Alert>
          <AlertDescription>{error || status?.automatic_error}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
