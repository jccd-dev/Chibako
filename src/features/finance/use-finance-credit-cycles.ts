"use client";

import { useCallback, useEffect, useState } from "react";
import type { FinanceAccount } from "./types";
import type { FinanceTransaction } from "./activity-types";
import type { FinanceCreditCycle } from "./credit-cycle-types";
import { financeJson } from "./client-json";

export interface CreditCycleData { cycles: FinanceCreditCycle[]; rewards: FinanceTransaction[]; accounts: FinanceAccount[] }

export function useFinanceCreditCycles(accountId: string) {
  const [data, setData] = useState<CreditCycleData | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true; // drop stale responses after account change or unmount
    fetch(`/api/finance/accounts/${accountId}/cycles`).then(financeJson<CreditCycleData>)
      .then(result => { if (live) { setData(result); setError(""); } })
      .catch(failure => { if (live) setError(failure instanceof Error ? failure.message : "Could not load statement cycles."); });
    return () => { live = false; };
  }, [accountId, tick]);
  const reload = useCallback(() => setTick(value => value + 1), []);
  return { data, error, reload };
}
