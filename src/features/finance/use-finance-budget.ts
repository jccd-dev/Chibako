"use client";

import { useEffect, useRef, useState } from "react";
import type { BudgetSnapshot } from "./budget-types";
import { setBudgetSchema } from "./budget-types";
import { financeJson } from "./client-json";
import { localCalendarDate } from "./presentation";
export function useFinanceBudget(onSaved: () => Promise<void>) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [month, setMonth] = useState(localCalendarDate().slice(0, 7));
  const [mode, setMode] = useState("forward");
  const [amount, setAmount] = useState("");
  const [snapshot, setSnapshot] = useState<BudgetSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  useEffect(() => {
    setSnapshot(null); setLoadError(""); setSaveError(""); setAmount(""); pending.current = null;
    if (!open || !category || !month) return;
    const abort = new AbortController();
    void fetch(`/api/finance/budgets?${new URLSearchParams({ category_id: category, month })}`, { signal: abort.signal }).then(financeJson<{ budget: BudgetSnapshot }>).then(({ budget }) => {
      if (abort.signal.aborted) return;
      setSnapshot(budget);
      setAmount(budget.limit_cents === null ? "" : `${Math.floor(budget.limit_cents / 100)}.${String(budget.limit_cents % 100).padStart(2, "0")}`);
    }).catch(error => { if (!abort.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load budget."); });
    return () => abort.abort();
  }, [open, category, month, reload]);
  function refresh() { setReload(value => value + 1); }
  async function save() {
    if (!snapshot || saving.current) return false;
    const input = { category_id: category, month, mode, amount, version: snapshot.version };
    const validation = setBudgetSchema.safeParse({ ...input, request_id: "validate" });
    if (!validation.success) { setSaveError(validation.error.issues[0]?.message ?? "Check the budget fields."); return false; }
    saving.current = true; setBusy(true); setSaveError(""); setNotice("");
    const fingerprint = JSON.stringify(input);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await fetch("/api/finance/budgets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: pending.current.requestId }) }).then(financeJson<{ budget: BudgetSnapshot }>);
      pending.current = null; setOpen(false); setNotice("Budget saved. Earlier monthly limits are preserved.");
      await onSaved(); return true;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not save budget. Try again."); return false; }
    finally { saving.current = false; setBusy(false); }
  }
  return { open, setOpen, category, setCategory, month, setMonth, mode, setMode, amount, setAmount, snapshot, loadError, saveError, busy, notice, refresh, save };
}
export type FinanceBudgetController = ReturnType<typeof useFinanceBudget>;
