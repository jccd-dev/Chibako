"use client";

import { useCallback, useRef, useState } from "react";
import type { FinanceSchedule } from "./recurrence-types";
import { financeJson } from "./client-json";
import type { FinancePlanningController } from "./use-finance-planning";
import { localCalendarDate } from "./presentation";

export function useFinanceRecurrence(planning: FinancePlanningController) {
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  async function save(id: string | null, operation: "create" | "edit" | "pause" | "resume" | "delete", input: object) {
    if (saving.current) return null;
    const path = id ? `/api/finance/schedules/${id}${operation === "pause" || operation === "resume" ? `/${operation}` : ""}` : "/api/finance/schedules";
    const method = operation === "edit" ? "PATCH" : operation === "delete" ? "DELETE" : "POST";
    const payload = operation === "resume" && !("resume_after" in input) ? { ...input, resume_after: localCalendarDate() } : input;
    const fingerprint = JSON.stringify({ path, method, payload });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    saving.current = true; setBusy(true); setSaveError(""); setNotice("");
    let result: { schedule: FinanceSchedule };
    try {
      result = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, request_id: pending.current.requestId }) }).then(financeJson<{ schedule: FinanceSchedule }>);
      pending.current = null;
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Could not save schedule. Retry unchanged fields."); saving.current = false; setBusy(false); return null; }
    setNotice(`${operation === "pause" ? "Schedule paused. Existing pending occurrences remain" : operation === "resume" ? "Schedule resumed from the next future due date" : operation === "delete" ? "Schedule deleted. Recorded history preserved and pending occurrences cancelled" : "Schedule saved. Posted history preserved"}.${result.schedule.handling === "automatic" && operation !== "pause" && operation !== "delete" ? " Automatic handling records due activity while the server is running." : " Balances unchanged."}`);
    try {
      window.dispatchEvent(new Event("finance-changed"));
      if ((operation === "create" || operation === "edit" || operation === "resume") && !await planning.save(null, "catch-up", {})) setSaveError("Schedule saved, but payments could not refresh. Reload Planning before making further changes.");
    }
    catch { setSaveError("Schedule saved, but related plans could not refresh. Reload before making further changes."); }
    finally { saving.current = false; setBusy(false); }
    return result;
  }
  const resetSave = useCallback(() => { pending.current = null; setSaveError(""); }, []);
  return { saveError, notice, busy, save, resetSave };
}
export type FinanceRecurrenceController = ReturnType<typeof useFinanceRecurrence>;
