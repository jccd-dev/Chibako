"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceGoal, FinanceGoalList, FinanceReservationAccount } from "./goal-types";
import { createGoalSchema, updateGoalSchema, setGoalAllocationSchema } from "./goal-types";
import { financeJson } from "./client-json";
import { decimalPHP } from "./presentation";

type ReservationAccount = FinanceReservationAccount & { archived: boolean };

export function useFinanceGoals() {
  const [page, setPage] = useState<FinanceGoalList | null>(null);
  const [archived, setArchived] = useState(false), [offset, setOffset] = useState(0);
  const [accounts, setAccounts] = useState<ReservationAccount[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false), [inspecting, setInspecting] = useState(false);
  const [panel, setPanel] = useState<string | null>(null), [editing, setEditing] = useState<FinanceGoal | null>(null);
  const [name, setName] = useState(""), [target, setTarget] = useState(""), [dueDate, setDueDate] = useState("");
  const [accountId, setAccountId] = useState(""), [amount, setAmount] = useState("0.00");
  const [saveError, setSaveError] = useState(""), [notice, setNotice] = useState("");
  const saving = useRef(false), sequence = useRef(0), inspection = useRef(0);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const refresh = useCallback(async () => {
    const run = ++sequence.current;
    setLoading(true); setLoadError("");
    try {
      const goals = await fetch(`/api/finance/goals?limit=25&offset=${offset}&archived=${archived}`).then(financeJson<FinanceGoalList>);
      if (run !== sequence.current) return;
      if (offset > 0 && offset >= goals.total) { setOffset(Math.max(0, Math.floor((goals.total - 1) / 25) * 25)); return; }
      const allAccounts: ReservationAccount[] = [];
      let accountOffset = 0;
      while (true) {
        const result = await fetch(`/api/finance/goals/accounts?limit=100&offset=${accountOffset}&archived=all`).then(financeJson<{ accounts: ReservationAccount[]; total: number }>);
        allAccounts.push(...result.accounts);
        accountOffset += result.accounts.length;
        if (accountOffset >= result.total || result.accounts.length === 0) break;
      }
      if (run === sequence.current) { setPage(goals); setAccounts(allAccounts); }
    } catch (error) {
      if (run === sequence.current) setLoadError(error instanceof Error ? error.message : "Could not load goals. Try again.");
    } finally { if (run === sequence.current) setLoading(false); }
  }, [archived, offset]);

  useEffect(() => {
    const changed = () => { void refresh(); };
    changed(); window.addEventListener("finance-changed", changed);
    return () => { sequence.current++; window.removeEventListener("finance-changed", changed); };
  }, [refresh]);

  function populate(goal: FinanceGoal) {
    setEditing(goal); setName(goal.name); setTarget(decimalPHP(goal.target_cents)); setDueDate(goal.due_date ?? "");
  }
  function openCreate() {
    inspection.current++; pending.current = null; setInspecting(false); setEditing(null);
    setName(""); setTarget(""); setDueDate(""); setAccountId(""); setAmount("0.00"); setSaveError(""); setNotice(""); setPanel("create");
  }
  async function openEdit(goal: FinanceGoal) {
    const run = ++inspection.current;
    pending.current = null; populate(goal); setAccountId(""); setAmount("0.00"); setSaveError(""); setNotice(""); setPanel(goal.id); setInspecting(true);
    try {
      const result = await fetch(`/api/finance/goals/${goal.id}`).then(financeJson<{ goal: FinanceGoal }>);
      if (run === inspection.current) populate(result.goal);
    } catch (error) { if (run === inspection.current) setSaveError(error instanceof Error ? error.message : "Could not inspect goal."); }
    finally { if (run === inspection.current) setInspecting(false); }
  }
  function closePanel() { inspection.current++; setPanel(null); setEditing(null); setSaveError(""); setNotice(""); pending.current = null; }
  function selectAccount(id: string) { setAccountId(id); setAmount(decimalPHP(editing?.allocations.find(row => row.account_id === id)?.amount_cents ?? 0)); }

  async function mutate(path: string, method: string, input: object) {
    if (saving.current || inspecting) return null;
    const fingerprint = JSON.stringify({ path, method, input });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    saving.current = true; setBusy(true); setSaveError(""); setNotice("");
    try {
      const result = await fetch(`/api/finance/goals${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: pending.current.requestId }) }).then(financeJson<{ goal: FinanceGoal }>);
      pending.current = null;
      await refresh();
      return result.goal;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not save goal. Try again."); return null; }
    finally { saving.current = false; setBusy(false); }
  }
  async function save() {
    const input = editing ? { version: editing.version, name, target, due_date: dueDate || null } : { name, target, ...(dueDate ? { due_date: dueDate } : {}) };
    const validation = (editing ? updateGoalSchema : createGoalSchema).safeParse({ ...input, request_id: "validate" });
    if (!validation.success) { setSaveError(validation.error.issues[0]?.message ?? "Check the fields."); return; }
    const goal = await mutate(editing ? `/${editing.id}` : "", editing ? "PATCH" : "POST", input);
    if (goal) { populate(goal); setPanel(goal.id); setNotice("Goal saved. Reserve account money below; cash stays unchanged."); }
  }
  async function allocate(value = amount) {
    if (!editing) return;
    const input = { version: editing.version, account_id: accountId, amount: value };
    const validation = setGoalAllocationSchema.safeParse({ ...input, request_id: "validate" });
    if (!validation.success) { setSaveError(validation.error.issues[0]?.message ?? "Check the allocation."); return; }
    const goal = await mutate(`/${editing.id}/allocations`, "PUT", input);
    if (goal) { setEditing(goal); setAmount(decimalPHP(goal.allocations.find(row => row.account_id === accountId)?.amount_cents ?? 0)); setNotice("Reservation saved. Account cash balances unchanged."); }
  }
  async function archive() {
    if (!editing) return;
    if (await mutate(`/${editing.id}`, "PATCH", { version: editing.version, archived: true })) closePanel();
  }
  return { page, archived, changeArchived: (value: boolean) => { setArchived(value); setOffset(0); }, offset, setOffset, accounts, loading, loadError, busy, inspecting, panel, editing,
    name, setName, target, setTarget, dueDate, setDueDate, accountId, selectAccount, amount, setAmount, saveError, notice, refresh, save, allocate, archive, openCreate, openEdit, closePanel };
}
export type FinanceGoalsController = ReturnType<typeof useFinanceGoals>;
