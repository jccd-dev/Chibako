"use client";

import { useEffect, useState } from "react";
import type { PlanPage } from "./planning-types";
import { financeJson } from "./client-json";

export function useFinanceSchedulePayments(scheduleId: string, notice: string) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; page?: PlanPage; error?: string } | null>(null);
  const key = `${scheduleId}:${offset}:${revision}:${notice}`;
  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams({ schedule_id: scheduleId, status: "all", order: "newest", limit: "25", offset: String(offset), include_details: "true" });
    void fetch(`/api/finance/plans?${params}`, { signal: abort.signal }).then(financeJson<PlanPage>)
      .then(page => {
        if (abort.signal.aborted) return;
        if (offset > 0 && offset >= page.total) { setOffset(Math.max(0, Math.floor((page.total - 1) / page.limit) * page.limit)); return; }
        setResult({ key, page });
      })
      .catch(error => { if (!abort.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "Could not load payments." }); });
    return () => abort.abort();
  }, [scheduleId, offset, revision, notice, key]);
  return { offset, setOffset, page: result?.key === key ? result.page : undefined, error: result?.key === key ? result.error : undefined, loading: result?.key !== key, retry: () => setRevision(value => value + 1) };
}
