"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanPage, FinancePlan, SatisfiedPlan } from "./planning-types";
import { financeJson } from "./client-json";
import { allocationWarningText, formatPHP, localCalendarDate } from "./presentation";

export function useFinancePlanning(activityNotice: string, onSaved: () => Promise<void>) {
  const [status, setStatus] = useState("pending");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<PlanPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasMoreCatchUp, setHasMoreCatchUp] = useState(false);
  const preparedInitialDue = useRef(false);
  const sequence = useRef(0), saving = useRef(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setError("");
    try {
      const result = await fetch(`/api/finance/plans?${new URLSearchParams({ status, limit: "25", offset: String(offset), include_details: "true" })}`).then(financeJson<PlanPage>);
      if (sequence.current === current) setPage(result);
    } catch (e) { if (sequence.current === current) setError(e instanceof Error ? e.message : "Could not load plans."); }
    finally { if (sequence.current === current) setLoading(false); }
  }, [status, offset]);
  useEffect(() => {
    void refresh();
    if (!preparedInitialDue.current) { preparedInitialDue.current = true; void save(null, "catch-up", {}); }
    return () => { sequence.current++; };
  }, [refresh, activityNotice]);
  async function save(id: string | null, operation: "create" | "edit" | "cancel" | "post" | "match" | "skip" | "catch-up", input: object) {
    if (saving.current) return null;
    const path = operation === "skip" || operation === "catch-up" ? `/api/finance/plans/${operation}` : id ? `/api/finance/plans/${id}${operation === "post" || operation === "match" ? `/${operation}` : ""}` : "/api/finance/plans";
    const method = operation === "edit" ? "PATCH" : operation === "cancel" ? "DELETE" : "POST";
    const payload = operation === "catch-up" && !("through_date" in input) ? { ...input, through_date: localCalendarDate() } : input;
    const fingerprint = JSON.stringify({ path, method, input: payload });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    saving.current = true; setBusy(true); setSaveError(""); setNotice("");
    let result: { plan: FinancePlan } | SatisfiedPlan | { plans: FinancePlan[] } | { created_count: number; has_more: boolean };
    try {
      result = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, request_id: pending.current.requestId }) }).then(financeJson<typeof result>);
      if ("has_more" in result) setHasMoreCatchUp(result.has_more);
      pending.current = null;
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Could not save the plan. Try again."); saving.current = false; setBusy(false); return null; }
    const label = { create: "Plan saved. Balances unchanged", edit: "Plan updated. Balances unchanged", cancel: "Plan cancelled. Balances unchanged", post: "Actual activity posted once", match: "Existing activity matched. No new cash movement", skip: "Selected occurrences skipped. Balances unchanged", "catch-up": "Due occurrences prepared for review. Balances unchanged" }[operation];
    setNotice(`${label}.${"balance_cents" in result ? ` Account balance: ${formatPHP(result.balance_cents)}.${result.warnings.includes("negative_balance") ? " Negative balance: review this account." : ""}${allocationWarningText(result)}` : ""}`);
    try { await Promise.all([refresh(), onSaved()]); }
    catch { setError("Plan saved, but related totals could not refresh. Reload before making further changes."); }
    finally { saving.current = false; setBusy(false); }
    return result;
  }
  function resetSave() { pending.current = null; setSaveError(""); }
  return { page, status, changeStatus: (value: string) => { setStatus(value); setOffset(0); }, offset, setOffset, loading, error, saveError, notice, busy, hasMoreCatchUp, refresh, save, resetSave };
}
export type FinancePlanningController = ReturnType<typeof useFinancePlanning>;
