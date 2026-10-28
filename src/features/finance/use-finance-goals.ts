"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceGoal, FinanceGoalList, FinanceReservationAccount } from "./goal-types";
import { createGoalSchema, updateGoalSchema, moveGoalMoneySchema } from "./goal-types";
import { financeJson } from "./client-json";
import { decimalPHPInput, formatPHP } from "./presentation";
import { decimalCents } from "./money";

type ReservationAccount = FinanceReservationAccount & { archived: boolean };

export function useFinanceGoals() {
  const [page, setPage] = useState<FinanceGoalList | null>(null);
  const [archived, setArchived] = useState(false), [offset, setOffset] = useState(0);
  const [accounts, setAccounts] = useState<ReservationAccount[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false), [inspecting, setInspecting] = useState(false);
  const [panel, setPanel] = useState<string | null>(null), [editing, setEditing] = useState<FinanceGoal | null>(null);
  const [name, setName] = useState(""), [target, setTarget] = useState(""), [dueDate, setDueDate] = useState("");
  const [linkedAccount, setLinkedAccount] = useState(""), [direction, setDirection] = useState<"deposit" | "withdrawal">("deposit");
  const [accountId, setAccountId] = useState(""), [amount, setAmount] = useState("");
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
    const requests = sequence;
    const changed = () => { void refresh(); };
    changed(); window.addEventListener("finance-changed", changed);
    return () => { requests.current++; window.removeEventListener("finance-changed", changed); };
  }, [refresh]);

  const populate = useCallback((goal: FinanceGoal) => {
    setEditing(goal); setName(goal.name); setTarget(decimalPHPInput(goal.target_cents)); setDueDate(goal.due_date ?? "");
    setLinkedAccount(goal.linked_account_id ?? "");
  }, []);
  function openCreate() {
    inspection.current++; pending.current = null; setInspecting(false); setEditing(null);
    setName(""); setTarget(""); setDueDate(""); setLinkedAccount("");
    setDirection("deposit"); setAccountId(""); setAmount(""); setSaveError(""); setNotice(""); setPanel("create");
  }
  const openEdit = useCallback(async (goal: FinanceGoal) => {
    const run = ++inspection.current;
    pending.current = null; populate(goal); setDirection("deposit"); setAccountId(""); setAmount(""); setSaveError(""); setNotice(""); setPanel(goal.id); setInspecting(true);
    try {
      const result = await fetch(`/api/finance/goals/${goal.id}`).then(financeJson<{ goal: FinanceGoal }>);
      if (run === inspection.current) populate(result.goal);
    } catch (error) { if (run === inspection.current) setSaveError(error instanceof Error ? error.message : "Could not inspect goal."); }
    finally { if (run === inspection.current) setInspecting(false); }
  }, [populate]);
  const openForAccount = useCallback(async (accountId: string) => {
    const run = ++inspection.current;
    try {
      let nextOffset = 0;
      while (true) {
        const result = await fetch(`/api/finance/goals?limit=100&offset=${nextOffset}&archived=false`).then(financeJson<FinanceGoalList>);
        if (run !== inspection.current) return false;
        const goal = result.goals.find((row) =>
          row.linked_account_id === accountId
          || row.allocations.some((allocation) => allocation.account_id === accountId),
        );
        if (goal) {
          await openEdit(goal);
          return true;
        }
        nextOffset += result.goals.length;
        if (nextOffset >= result.total || result.goals.length === 0) return false;
      }
    } catch (error) {
      if (run === inspection.current) setLoadError(error instanceof Error ? error.message : "Could not find a goal for this account.");
      return false;
    }
  }, [openEdit]);
  function closePanel() { inspection.current++; setPanel(null); setEditing(null); setSaveError(""); setNotice(""); pending.current = null; }

  function selectLinkedAccount(id: string) {
    setLinkedAccount(id);
    if (id && accountId === id) setAccountId("");
  }
  function selectDirection(next: "deposit" | "withdrawal") {
    setDirection(next); setAmount("");
    if (editing?.linked_account_id && accountId === editing.linked_account_id) setAccountId("");
  }
  function selectAccount(id: string) { setAccountId(id); }

  async function mutate(path: string, method: string, input: object) {
    if (saving.current || inspecting) return null;
    const fingerprint = JSON.stringify({ path, method, input });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    saving.current = true; setBusy(true); setSaveError(""); setNotice("");
    try {
      const result = await fetch(`/api/finance/goals${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: pending.current.requestId }) }).then(financeJson<{ goal: FinanceGoal }>);
      pending.current = null;
      await refresh();
      window.dispatchEvent(new Event("finance-changed"));
      return result.goal;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not save goal. Try again."); return null; }
    finally { saving.current = false; setBusy(false); }
  }
  async function save() {
    const input = editing
      ? { version: editing.version, name, target, due_date: dueDate || null, linked_account_id: linkedAccount || null }
      : { name, target, ...(dueDate ? { due_date: dueDate } : {}), linked_account_id: linkedAccount || null };
    const validation = (editing ? updateGoalSchema : createGoalSchema).safeParse({ ...input, request_id: "validate" });
    if (!validation.success) { setSaveError(validation.error.issues[0]?.message ?? "Check the fields."); return; }
    const goal = await mutate(editing ? `/${editing.id}` : "", editing ? "PATCH" : "POST", input);
    if (goal) {
      populate(goal); setPanel(goal.id);
      setNotice(editing ? "Goal saved. Use Add money or Withdraw to move real cash." : "Goal created. Use Add money to move real cash into it.");
    }
  }
  async function moveMoney() {
    if (!editing) return;
    if (editing.linked_account_id && accountId === editing.linked_account_id) {
      setSaveError("Choose an account other than the linked account."); return;
    }
    const input = { version: editing.version, direction, account_id: accountId, amount };
    const validation = moveGoalMoneySchema.safeParse({ ...input, request_id: "validate" });
    if (!validation.success) { setSaveError(validation.error.issues[0]?.message ?? "Check the money movement."); return; }
    let cents: number;
    try { cents = decimalCents(amount); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Check the amount."); return; }
    if (cents <= 0) { setSaveError("Use an amount above PHP 0.00"); return; }
    if (direction === "withdrawal" && cents > editing.saved_cents) {
      setSaveError(`Amount exceeds the money in this goal. Available: ${formatPHP(editing.saved_cents)}.`); return;
    }
    const goal = await mutate(`/${editing.id}/movements`, "POST", input);
    if (goal) {
      const amountText = formatPHP(cents);
      const destination = accounts.find((row) => row.account_id === accountId)?.account_name ?? "the chosen account";
      const linkedName = goal.linked_account_name ?? "the linked account";
      setEditing(goal); setAmount("");
      setNotice(
        direction === "deposit"
          ? goal.linked_account_id
            ? `Added ${amountText} to the linked account ${linkedName}.`
            : `Added ${amountText} to ${goal.name}.`
          : `Moved ${amountText} into ${destination}.`,
      );
    }
  }
  async function archive() {
    if (!editing) return;
    if (await mutate(`/${editing.id}`, "PATCH", { version: editing.version, archived: true })) closePanel();
  }
  async function remove() {
    if (!editing || saving.current || inspecting) return;
    const target = editing, input = { version: target.version };
    const fingerprint = JSON.stringify({ path: `/${target.id}`, method: "DELETE", input });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    saving.current = true; setBusy(true); setSaveError(""); setNotice("");
    try {
      await fetch(`/api/finance/goals/${target.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: pending.current.requestId }) }).then(financeJson<{ deleted: true; id: string }>);
      closePanel();
      await refresh();
      window.dispatchEvent(new Event("finance-changed"));
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not delete goal. Try again."); }
    finally { saving.current = false; setBusy(false); }
  }
  return { page, archived, changeArchived: (value: boolean) => { setArchived(value); setOffset(0); }, offset, setOffset, accounts, loading, loadError, busy, inspecting, panel, editing,
    name, setName, target, setTarget, dueDate, setDueDate,
    linkedAccount, selectLinkedAccount, direction, selectDirection,
    accountId, selectAccount, amount, setAmount, saveError, notice, refresh, save, moveMoney, archive, remove, openCreate, openEdit, openForAccount, closePanel };
}
export type FinanceGoalsController = ReturnType<typeof useFinanceGoals>;
