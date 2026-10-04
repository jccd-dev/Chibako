"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { localCalendarDate } from "./presentation";
import type { FinanceReport } from "./budget-types";
import { financeJson as json } from "./client-json";
export function useFinanceReports(revision: string) {
  const month = localCalendarDate().slice(0, 7);
  const [dates, setDates] = useState({ date_from: `${month}-01`, date_to: `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()).padStart(2, "0")}` });
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setReport(null); setError("");
    try {
      const query = new URLSearchParams({ ...dates, offset: String(offset), limit: "50" });
      const result = await fetch(`/api/finance/reports?${query}`).then(json<FinanceReport>);
      if (current === sequence.current) setReport(result);
    } catch (error) { if (current === sequence.current) setError(error instanceof Error ? error.message : "Could not load reports."); }
  }, [dates, offset]);
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [refresh, revision]);
  function applyDates(value: typeof dates) { setOffset(0); setDates(value); }
  return { dates, applyDates, offset, setOffset, report, error, refresh };
}
export type FinanceReportsController = ReturnType<typeof useFinanceReports>;
