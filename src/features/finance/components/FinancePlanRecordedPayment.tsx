"use client";

import { useEffect, useState } from "react";
import type { FinanceTransaction } from "@/features/finance/activity-types";
import type { FinanceActivityController } from "@/features/finance/use-finance-activity";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FinanceCorrection } from "./FinanceCorrection";

export function FinancePlanRecordedPayment({ transactionId, activity, onSaved }: { transactionId: string; activity: FinanceActivityController; onSaved: () => void }) {
  const [reload, setReload] = useState(0);
  const key = `${transactionId}:${reload}`;
  const [state, setState] = useState<{ key: string; record?: FinanceTransaction; error?: string } | null>(null);
  const { inspect } = activity;
  useEffect(() => {
    let current = true;
    inspect(transactionId).then(record => { if (current) setState({ key, record }); })
      .catch(e => { if (current) setState({ key, error: e instanceof Error ? e.message : "Could not load the recorded payment." }); });
    return () => { current = false; };
  }, [inspect, transactionId, key]);
  const loaded = state?.key === key ? state : null;
  if (loaded?.error) return <Alert><AlertDescription>{loaded.error}<Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry recorded payment</Button></AlertDescription></Alert>;
  if (!loaded?.record) return <p role="status" className="text-sm">Loading recorded payment…</p>;
  return <section aria-label="Recorded payment" className="flex flex-col gap-2">
    <p className="text-sm text-muted-foreground">Correcting this payment changes only this record. Delete preserves satisfaction; Revert reopens this plan. Use Edit plan to change the account for future payments.</p>
    <FinanceCorrection key={`${loaded.record.id}:${loaded.record.version}`} record={loaded.record} activity={activity} onSaved={() => { setReload(value => value + 1); onSaved(); }} />
  </section>;
}
