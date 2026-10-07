"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createObligationSchema, updateObligationSchema, postObligationMovementSchema, postObligationPaymentSchema, closeObligationSchema, type FinanceObligation, type FinanceObligationList, type FinanceObligationHistory, type PostedObligationPayment } from "./obligation-types";
import type { ActivityPage, FinanceTransaction } from "./activity-types";
import { financeJson } from "./client-json";
import { decimalCents } from "./money";
import { decimalPHP, localCalendarDate, formatPHP } from "./presentation";
import type { FinanceActivityController } from "./use-finance-activity";

export function useFinanceObligations(activity: FinanceActivityController) {
  const [page, setPage] = useState<FinanceObligationList | null>(null);
  const [archived, setArchived] = useState(false), [overdue, setOverdue] = useState(false), [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [panel, setPanel] = useState<"definition" | "movement" | "payment" | "closure" | null>(null), [editing, setEditing] = useState<FinanceObligation | null>(null);
  const [inspecting, setInspecting] = useState(false), [inspectError, setInspectError] = useState("");
  const [kind, setKind] = useState<"debt" | "receivable">("debt");
  const [name, setName] = useState(""), [principal, setPrincipal] = useState("0"), [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState(""), [accountId, setAccountId] = useState(""), [date, setDate] = useState(localCalendarDate()), [text, setText] = useState("");
  const [busy, setBusy] = useState(false), [saveError, setSaveError] = useState(""), [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pSource, setPSource] = useState<"new" | "existing">("new");
  const [pSelected, setPSelected] = useState<FinanceTransaction | null>(null);
  const [pCandidates, setPCandidates] = useState<FinanceTransaction[]>([]);
  const [pTotal, setPTotal] = useState(0), [pOffset, setPOffset] = useState(0), [pLoading, setPLoading] = useState(false), [pError, setPError] = useState("");
  const [history, setHistory] = useState<FinanceObligationHistory | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0), [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [paymentReview, setPaymentReview] = useState<{ description: string; input: object } | null>(null);
  const [closureReview, setClosureReview] = useState<{ description: string; input: object } | null>(null);
  const sequence = useRef(0), inspection = useRef(0), saving = useRef(false);
  const candidates = useRef(0), historySequence = useRef(0);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const paymentPending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const closePending = useRef<{ fingerprint: string; requestId: string } | null>(null);

  async function loadHistory(id: string, nextOffset = 0) {
    const run = ++historySequence.current;
    setHistoryLoading(true); setHistoryError("");
    const total = history?.total ?? 0;
    if (nextOffset > 0 && nextOffset >= total) nextOffset = Math.max(0, Math.floor((total - 1) / 25) * 25);
    try {
      const result = await fetch(`/api/finance/obligations/${id}/history?limit=25&offset=${nextOffset}&include_details=true`).then(financeJson<FinanceObligationHistory>);
      if (run !== historySequence.current) return;
      setHistory(result); setHistoryOffset(nextOffset);
    } catch (error) { if (run === historySequence.current) setHistoryError(error instanceof Error ? error.message : "Could not load payment history."); }
    finally { if (run === historySequence.current) setHistoryLoading(false); }
  }
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
    pending.current = null; paymentPending.current = null; closePending.current = null;
    activity.resetSave(); setSaveError(""); setInspectError(""); setErrors({}); setNotice("");
    setAmount(""); setAccountId(""); setDate(localCalendarDate()); setText("");
    setPSource("new"); setPSelected(null); setPCandidates([]); setPTotal(0); setPOffset(0); setPLoading(false); setPError("");
    setCloseReason(""); setPaymentReview(null); setClosureReview(null);
    candidates.current++;
    historySequence.current++; setHistory(null); setHistoryOffset(0); setHistoryLoading(false); setHistoryError("");
  }
  function openCreate(mode: "definition" | "movement") {
    inspection.current++; setInspecting(false); resetDraft(); setEditing(null); setKind("debt"); setName(""); setPrincipal("0"); setDueDate(""); setPanel(mode);
  }
  async function openEdit(record: FinanceObligation) {
    const run = ++inspection.current;
    resetDraft(); populate(record); setPanel("definition"); setInspecting(true);
    void loadHistory(record.id, 0);
    try {
      const result = await fetch(`/api/finance/obligations/${record.id}`).then(financeJson<{ obligation: FinanceObligation }>);
      if (run === inspection.current) populate(result.obligation);
    } catch (error) { if (run === inspection.current) setInspectError(error instanceof Error ? error.message : "Could not inspect obligation."); }
    finally { if (run === inspection.current) setInspecting(false); }
  }
  function close() { inspection.current++; candidates.current++; historySequence.current++; setPanel(null); setEditing(null); pending.current = null; setInspecting(false); }

  async function loadCandidates(nextOffset: number) {
    if (!editing) return;
    const run = ++candidates.current;
    setPLoading(true); setPError("");
    const type = editing.kind === "debt" ? "expense" : "income";
    try {
      const result = await fetch(`/api/finance/activity?limit=25&offset=${nextOffset}&type=${type}&payment_matchable=true&include_details=true`).then(financeJson<ActivityPage>);
      if (run !== candidates.current) return;
      setPCandidates(result.transactions); setPTotal(result.total); setPOffset(nextOffset);
    } catch (error) { if (run === candidates.current) setPError(error instanceof Error ? error.message : "Could not load matching activity."); }
    finally { if (run === candidates.current) setPLoading(false); }
  }
  function choosePaymentSource(value: "new" | "existing") {
    setPSource(value); setErrors({});
    if (value === "new") setPSelected(null);
    else if (!pSelected) void loadCandidates(0);
  }
  function selectCandidate(record: FinanceTransaction) {
    setPSelected(record); setErrors({});
    setAmount(decimalPHP(record.amount_cents)); setAccountId(record.account_id); setDate(record.transaction_date);
  }
  function clearCandidate() { setPSelected(null); setErrors({}); void loadCandidates(0); }

  function validate(input: object, schema: typeof createObligationSchema | typeof updateObligationSchema | typeof postObligationMovementSchema) {
    const parsed = schema.safeParse({ ...input, request_id: "validation" });
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "form")] = issue.message;
      setErrors(fields); return false;
    }
    setErrors({}); return true;
  }
  function validatePayment(input: object): object | null {
    const matched = pSelected;
    const parsed = postObligationPaymentSchema.safeParse({ ...input, request_id: "validation" });
    const fields: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "form")] = issue.message;
    if (!fields.amount && Number((input as { amount: string }).amount) <= 0) fields.amount = "Use a positive PHP amount with at most two decimal places.";
    if (matched && !fields.amount && (input as { amount: string }).amount !== decimalPHP(matched.amount_cents)) fields.amount = "The amount must equal the selected activity exactly.";
    if (matched && !fields.account_id && (input as { account_id: string }).account_id !== matched.account_id) fields.account_id = "The account must be the one on the selected activity.";
    if (matched && !fields.transaction_date && (input as { transaction_date: string }).transaction_date !== matched.transaction_date) fields.transaction_date = "The date must be the one on the selected activity.";
    if (Object.keys(fields).length) { setErrors(fields); return null; }
    setErrors({}); return input;
  }
  function startPayment() {
    if (!editing) return;
    activity.resetSave(); setSaveError(""); setErrors({}); setNotice("");
    setAmount(""); setAccountId(""); setDate(localCalendarDate()); setText("");
    setPSource("new"); setPSelected(null); setPaymentReview(null);
    setPanel("payment");
  }
  function startMovement() { activity.resetSave(); setSaveError(""); setErrors({}); setNotice(""); setAmount(""); setPanel("movement"); }
  async function payConfirmed(input: object): Promise<PostedObligationPayment | null> {
    if (saving.current || activity.busy || inspecting || inspectError || !editing) return null;
    const fingerprint = JSON.stringify({ path: "/api/finance/obligations/payments", input });
    if (paymentPending.current?.fingerprint !== fingerprint) paymentPending.current = { fingerprint, requestId: crypto.randomUUID() };
    saving.current = true; setBusy(true); setSaveError(""); setNotice("");
    try {
      const result = await fetch("/api/finance/obligations/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: paymentPending.current.requestId }) }).then(financeJson<PostedObligationPayment>);
      paymentPending.current = null; setPaymentReview(null);
      populate(result.obligation); setPanel("definition");
      setAmount(""); setAccountId(""); setDate(localCalendarDate()); setText(""); setPSelected(null); setPSource("new");
      const balances = result.balances.map(balance => `${activity.accounts.find(account => account.id === balance.account_id)?.name ?? "Account"}: ${formatPHP(balance.balance_cents)}`).join("; ");
      setNotice(`Principal ${editing.kind === "debt" ? "payment" : "collection"} recorded. ${balances}. Remaining principal: ${formatPHP(result.obligation.outstanding_cents)}.${result.warnings.length ? ` Warnings: ${result.warnings.join("; ")}.` : ""} Corrections happen through Activity and restore remaining principal.`);
      setHistory(null); void loadHistory(result.obligation.id, 0);
      await Promise.all([refresh(), activity.refreshHistory(), activity.refreshTotals()]);
      window.dispatchEvent(new Event("finance-changed"));
      return result;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not record the payment."); return null; }
    finally { saving.current = false; setBusy(false); }
  }
  async function pay(): Promise<PostedObligationPayment | null> {
    if (saving.current || activity.busy || inspecting || inspectError || !editing) return null;
    if (pSource === "existing" && !pSelected) {
      setErrors({ cash_activity_id: "Select the existing cash activity to link, or choose a new cash transaction." });
      return null;
    }
    const input = { obligation_id: editing.id, obligation_version: editing.version, account_id: accountId, amount, transaction_date: date, text,
      ...(pSource === "existing" && pSelected ? { cash_activity_id: pSelected.id, cash_activity_version: pSelected.version } : {}) };
    const validated = validatePayment(input); if (!validated) return null;
    if (pSource === "existing" && pSelected) { setPaymentReview({ description: `Link ${formatPHP(pSelected.amount_cents)} from ${pSelected.account_name} on ${pSelected.transaction_date} as principal. Its cash effect stays as recorded; no second cash movement is posted. This amount is removed from income or spending reports, including its original category. Corrections later update cash and principal together through Activity.`, input: validated }); return null; }
    return payConfirmed(validated);
  }
  function startClose() {
    if (!editing) return;
    activity.resetSave(); setSaveError(""); setErrors({}); setNotice("");
    setAmount(decimalPHP(editing.outstanding_cents)); setCloseReason(""); setClosureReview(null);
    setPanel("closure");
  }
  function reviewClose() {
    if (!editing) return;
    const input = { version: editing.version, amount, reason: closeReason };
    const parsed = closeObligationSchema.safeParse({ ...input, request_id: "validation" });
    const fields: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "form")] = issue.message;
    if (!fields.amount) {
      try {
        if (decimalCents(amount) !== editing.outstanding_cents) fields.amount = "The amount must equal the current remaining principal.";
      } catch { fields.amount = "Use an amount within the supported exact-cent range."; }
    }
    if (Object.keys(fields).length) { setErrors(fields); return; }
    setErrors({});
    setClosureReview({ description: `This writes off the remaining principal, ${formatPHP(editing.outstanding_cents)}. No cash movement, income or spending is recorded, and amounts already paid and written off stay distinct.`, input });
  }
  async function executeClose(input: object): Promise<FinanceObligation | null> {
    if (saving.current || activity.busy || inspecting || inspectError || !editing) return null;
    const fingerprint = JSON.stringify({ path: `/api/finance/obligations/${editing.id}/close`, input });
    if (closePending.current?.fingerprint !== fingerprint) closePending.current = { fingerprint, requestId: crypto.randomUUID() };
    saving.current = true; setBusy(true); setSaveError(""); setNotice("");
    try {
      const result = await fetch(`/api/finance/obligations/${editing.id}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: closePending.current.requestId }) }).then(financeJson<{ obligation: FinanceObligation }>);
      closePending.current = null;
      populate(result.obligation); setPanel("definition");
      setClosureReview(null); setAmount(""); setCloseReason("");
      setNotice(`Remaining principal written off. No cash movement, income or spending was recorded. Paid and written-off amounts stay distinct. Remaining principal: ${formatPHP(result.obligation.outstanding_cents)}.`);
      setHistory(null); void loadHistory(result.obligation.id, 0);
      await refresh(); window.dispatchEvent(new Event("finance-changed"));
      return result.obligation;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not close the obligation."); return null; }
    finally { saving.current = false; setBusy(false); }
  }
  function changeHistoryOffset(next: number) {
    if (!editing) return;
    void loadHistory(editing.id, next);
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
    if (await mutate({ version: editing.version, archived: !editing.archived })) setNotice("Archive state saved. Cash, paid and written-off amounts are retained.");
  }
  return { page, archived, overdue, offset, setOffset, setArchived: (v: boolean) => { setArchived(v); setOffset(0); }, setOverdue: (v: boolean) => { setOverdue(v); setOffset(0); }, loading, loadError, refresh,
    panel, setPanel, editing, inspecting, inspectError, openCreate, openEdit, close, kind, setKind, name, setName, principal, setPrincipal, dueDate, setDueDate, amount, setAmount, accountId, setAccountId, date, setDate, text, setText,
    busy: busy || activity.busy, saveError: saveError || activity.saveError, notice, errors, save, archive, startMovement,
    pSource, choosePaymentSource, pSelected, selectCandidate, clearCandidate, pCandidates, pTotal, pOffset, pLoading, pError, loadCandidates, startPayment, pay, payConfirmed, setPaymentReview, paymentReview,
    closeReason, setCloseReason, startClose, reviewClose, closureReview, setClosureReview, executeClose,
    history, historyOffset, historyLoading, historyError, changeHistoryOffset };
}
export type FinanceObligationsController = ReturnType<typeof useFinanceObligations>;
