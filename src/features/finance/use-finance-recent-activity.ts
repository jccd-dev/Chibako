"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityPage } from "./activity-types";
import { financeJson as json } from "./client-json";

export function useFinanceRecentActivity(dateFrom: string, dateTo: string, limit = 7) {
  const [page, setPage] = useState<ActivityPage | null>(null);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const load = useCallback(() => {
    const current = ++sequence.current;
    const query = new URLSearchParams({ limit: String(limit), offset: "0" });
    if (dateFrom) query.set("date_from", dateFrom);
    if (dateTo) query.set("date_to", dateTo);
    return fetch(`/api/finance/activity?${query}`).then(json<ActivityPage>)
      .then(result => { if (current === sequence.current) setPage(result); })
      .catch(error => { if (current === sequence.current) setError(error instanceof Error ? error.message : "Could not load activity."); });
  }, [dateFrom, dateTo, limit]);
  useEffect(() => {
    const requests = sequence;
    void load();
    const reload = () => { void load(); };
    window.addEventListener("finance-changed", reload);
    return () => { requests.current++; window.removeEventListener("finance-changed", reload); };
  }, [load]);
  const refresh = useCallback(() => {
    setPage(null); setError("");
    return load();
  }, [load]);
  return { page, error, refresh };
}
export type FinanceRecentActivityController = ReturnType<typeof useFinanceRecentActivity>;
