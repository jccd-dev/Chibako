"use client";

import { useEffect, useState } from "react";
import type { PlanningFilter, PlanningPage } from "./planning-list-types";
import { financeJson } from "./client-json";
import { localCalendarDate } from "./presentation";

export function useFinancePlanningList() {
  const [filter, setFilter] = useState<PlanningFilter>("all");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; page?: PlanningPage; error?: string } | null>(null);
  const today = localCalendarDate();
  const key = `${filter}:${offset}:${revision}:${today}`;
  useEffect(() => {
    const changed = () => setRevision(value => value + 1);
    window.addEventListener("finance-changed", changed);
    return () => window.removeEventListener("finance-changed", changed);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams({ filter, as_of: today, limit: "25", offset: String(offset) });
    void fetch(`/api/finance/planning?${params}`, { signal: abort.signal }).then(financeJson<PlanningPage>)
      .then(page => {
        if (abort.signal.aborted) return;
        if (offset > 0 && offset >= page.total) { setOffset(Math.max(0, Math.floor((page.total - 1) / page.limit) * page.limit)); return; }
        setResult({ key, page });
      })
      .catch(error => { if (!abort.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "Could not load plans." }); });
    return () => abort.abort();
  }, [filter, offset, revision, today, key]);
  function changeFilter(value: string) {
    if (value === "all" || value === "attention" || value === "upcoming" || value === "paused") { setFilter(value); setOffset(0); }
  }
  return { filter, changeFilter, offset, setOffset, page: result?.key === key ? result.page : undefined, error: result?.key === key ? result.error : undefined, loading: result?.key !== key, refresh: () => setRevision(value => value + 1) };
}
export type FinancePlanningListController = ReturnType<typeof useFinancePlanningList>;
