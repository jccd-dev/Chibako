"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createObligationSchema, updateObligationSchema, postObligationMovementSchema, type FinanceObligation, type FinanceObligationList } from "./obligation-types";
import { financeJson } from "./client-json";
import { localCalendarDate, formatPHP } from "./presentation";
import type { FinanceActivityController } from "./use-finance-activity";

export function useFinanceObligations(activity: FinanceActivityController) {
  const [page, setPage] = useState<FinanceObligationList | null>(null);
  const [archived, setArchived] = useState(false), [overdue, setOverdue] = useState(false), [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [panel, setPanel] = useState<"definition" | "movement" | null>(null), [editing, setEditing] = useState<FinanceObligation | null>(null);
  const [inspecting, setInspecting] = useState(false), [inspectError, setInspectError] = useState("");
  const [kind, setKind] = useState<"debt" | "receivable">("debt");
  const [name, setName] = useState(""), [principal, setPrincipal] = useState("0"), [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState(""), [accountId, setAccountId] = useState(""), [date, setDate] = useState(localCalendarDate()), [text, setText] = useState("");
  const [busy, setBusy] = useState(false), [saveError, setSaveError] = useState(""), [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sequence = useRef(0), inspection = useRef(0), saving = useRef(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const refresh = useCallback(async () => {
    const run = ++sequence.current;
    setLoading(true); setLoadError("");
    try {
      const result = await fetch(`/api/finance/obligations?limit=25&offset=${offset}&archived=${archived}&overdue=${overdue}`).then(financeJson<FinanceObligationList>);
      if (run !== sequence.current) return;
      if (offset > 0 && offset >= result.total) { setOffset(Math.max(0, Math.floor((result.total - 1) / 25) * 25)); return; }
      setPage(result);
    } catch (error) { if (run === sequence.current) setLoadError(error instanceof Error ? error.message : "Could not load obligations."); }
    finally { if (run === sequence.current) setLoading(false); }
  }, [offset, archived, overdue]);
  useEffect(() => {
    const changed = () => { void refresh(); };
    changed(); window.addEventListener("finance-changed", changed);
    return () => { sequence.current++; window.removeEventListener("finance-changed", changed); };
  }, [refresh]);
  function populate(record: FinanceObligation) { setEditing(record); setKind(record.kind); setName(record.name); setDueDate(record.due_date ?? ""); }
  function resetDraft() {
    pending.current = null; activity.resetSave(); setSaveError(""); setInspectError(""); setErrors({}); setNotice("");
    setAmount(""); setAccountId(""); setDate(localCalendarDate()); setText("");
  }
  function openCreate(mode: "definition" | "movement") {
    inspection.current++; setInspecting(false); resetDraft(); setEditing(null); setKind("debt"); setName(""); setPrincipal("0"); setDueDate(""); setPanel(mode);
  }
  async function openEdit(record: FinanceObligation) {
    const run = ++inspection.current;
    resetDraft(); populate(record); setPanel("definition"); setInspecting(true);
    try {
      const result = await fetch(`/api/finance/obligations/${record.id}`).then(financeJson<{ obligation: FinanceObligation }>);
      if (run === inspection.current) populate(result.obligation);
    } catch (error) { if (run === inspection.current) setInspectError(error instanceof Error ? error.message : "Could not inspect obligation."); }
    finally { if (run === inspection.current) setInspecting(false); }
  }
  function close() { inspection.current++; setPanel(null); setEditing(null); pending.current = null; setInspecting(false); }
  function validate(input: object, schema: typeof createObligationSchema | typeof updateObligationSchema | typeof postObligationMovementSchema) {
    const parsed = schema.safeParse({ ...input, request_id: "validation" });
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "form")] = issue.message;
      setErrors(fields); return false;
    }
    setErrors({}); return true;
  }
  async function mutate(input: object) {
    if (saving.current || inspecting || inspectError) return null;
    const path = editing ? `/${editing.id}` : "", method = editing ? "PATCH" : "POST";
    const fingerprint = JSON.stringify({ path, method, input });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    saving.current = true; setBusy(true); setSaveError("");
    try {
      const result = await fetch(`/api/finance/obligations${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: pending.current.requestId }) }).then(financeJson<{ obligation: FinanceObligation }>);
      pending.current = null; populate(result.obligation); setPanel("definition");
      await refresh(); window.dispatchEvent(new Event("finance-changed")); return result.obligation;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not save obligation."); return null; }
    finally { saving.current = false; setBusy(false); }
  }
  async function save(another = false) {
    if (panel === "movement") {
      if (saving.current || activity.busy || inspecting || inspectError) return;
      const input = { type: kind === "debt" ? "borrowing" : "lending", ...(editing ? { obligation_id: editing.id, version: editing.version } : { name, due_date: dueDate || null }), account_id: accountId, amount, transaction_date: date, text };
      if (!validate(input, postObligationMovementSchema)) return;
      saving.current = true;
      try {
        const result = await activity.postObligation(input);
        if (result) {
          if (another) { openCreate("movement"); setKind(kind); setAccountId(accountId); setDate(date); }
          else { populate(result.obligation); setPanel("definition"); setAmount(""); }
          setNotice(`Cash movement recorded. Outstanding principal: ${formatPHP(result.obligation.outstanding_cents)}.${another ? " Enter the next borrowing or lending." : " Inspect corrections in Activity."}`);
          await refresh(); return true;
        }
      } finally { saving.current = false; }
    } else {
      const input = editing ? { version: editing.version, name, due_date: dueDate || null } : { kind, name, principal, due_date: dueDate || null };
      if (validate(input, editing ? updateObligationSchema : createObligationSchema) && await mutate(input)) {
        if (another) { openCreate("definition"); setKind(kind); }
        setNotice("Obligation saved. No cash moved."); return true;
      }
    }
  }
  async function archive() {
    if (!editing) return;
    if (await mutate({ version: editing.version, archived: !editing.archived })) setNotice("Archive state saved. Cash and outstanding principal are retained.");
  }
  function startMovement() { activity.resetSave(); setSaveError(""); setErrors({}); setNotice(""); setAmount(""); setPanel("movement"); }
  return { page, archived, overdue, offset, setOffset, setArchived: (v: boolean) => { setArchived(v); setOffset(0); }, setOverdue: (v: boolean) => { setOverdue(v); setOffset(0); }, loading, loadError, refresh,
    panel, editing, inspecting, inspectError, openCreate, openEdit, close, kind, setKind, name, setName, principal, setPrincipal, dueDate, setDueDate, amount, setAmount, accountId, setAccountId, date, setDate, text, setText,
    busy: busy || activity.busy, saveError: saveError || activity.saveError, notice, errors, save, archive, startMovement };
}
export type FinanceObligationsController = ReturnType<typeof useFinanceObligations>;
