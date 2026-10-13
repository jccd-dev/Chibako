"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceSchedule, SchedulePage } from "./recurrence-types";
import { financeJson } from "./client-json";
import type { FinancePlanningController } from "./use-finance-planning";
import { localCalendarDate } from "./presentation";

export function useFinanceRecurrence(activityNotice: string, planning: FinancePlanningController) {
  const [page, setPage] = useState<SchedulePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0), saving = useRef(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const requestKey = `${paused}:${offset}:${activityNotice}`;
  const [previousRequestKey, setPreviousRequestKey] = useState(requestKey);
  if (previousRequestKey !== requestKey) {
    setPreviousRequestKey(requestKey);
    setLoading(true); setError("");
  }
  const load = useCallback(() => {
    const current = ++sequence.current;
    return fetch(`/api/finance/schedules?${new URLSearchParams({ paused, limit: "25", offset: String(offset), include_details: "true" })}`).then(financeJson<SchedulePage>)
      .then(result => { if (current === sequence.current) setPage(result); })
      .catch(e => { if (current === sequence.current) setError(e instanceof Error ? e.message : "Could not load schedules."); })
      .finally(() => { if (current === sequence.current) setLoading(false); });
  }, [offset, paused]);
  const refresh = useCallback(() => { setLoading(true); setError(""); return load(); }, [load]);
  useEffect(() => {
    const requests = sequence;
    void load();
    return () => { requests.current++; };
  }, [load, activityNotice]);
  async function save(id: string | null, operation: "create" | "edit" | "pause" | "resume", input: object) {
    if (saving.current) return null;
    const path = id ? `/api/finance/schedules/${id}${operation === "pause" || operation === "resume" ? `/${operation}` : ""}` : "/api/finance/schedules";
    const method = operation === "edit" ? "PATCH" : "POST";
    const payload = operation === "resume" && !("resume_after" in input) ? { ...input, resume_after: localCalendarDate() } : input;
    const fingerprint = JSON.stringify({ path, method, payload });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    saving.current = true; setBusy(true); setSaveError(""); setNotice("");
    let result: { schedule: FinanceSchedule };
    try {
      result = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, request_id: pending.current.requestId }) }).then(financeJson<{ schedule: FinanceSchedule }>);
      pending.current = null;
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Could not save schedule. Retry unchanged fields."); saving.current = false; setBusy(false); return null; }
    setNotice(`${operation === "pause" ? "Schedule paused. Existing pending occurrences remain" : operation === "resume" ? "Schedule resumed from the next future due date" : "Schedule saved. Posted history preserved"}. Balances unchanged.`);
    try {
      await refresh();
      if (operation === "create" || operation === "edit" || operation === "resume") await planning.save(null, "catch-up", {});
    }
    catch { setError("Schedule saved, but related plans could not refresh. Reload before making further changes."); }
    finally { saving.current = false; setBusy(false); }
    return result;
  }
  const resetSave = useCallback(() => { pending.current = null; setSaveError(""); }, []);
  return { page, offset, setOffset, paused, changePaused: (value: string) => { setPaused(value); setOffset(0); }, loading, error, saveError, notice, busy, refresh, save, resetSave };
}
export type FinanceRecurrenceController = ReturnType<typeof useFinanceRecurrence>;
