"use client";

import { useRef, useState } from "react";
import type { FinanceAccount } from "./types";
import type { FinanceTransaction } from "./activity-types";
import type { FinanceCreditCycle } from "./credit-cycle-types";
import { financeJson } from "./client-json";
import { previewCents } from "./money";
import { decimalPHPInput, formatPHP, localCalendarDate } from "./presentation";
import { cashbackSplit } from "./cashback-split";

interface Pick { on: boolean; amount: string; date: string }

export function useFinanceCreditPayment(card: FinanceAccount, cycle: FinanceCreditCycle, olderUnpaidCents: number, includedThroughDate: string | null, cash: FinanceAccount[], rewards: FinanceTransaction[], onSaved: () => void) {
  const today = localCalendarDate();
  const [source, setSource] = useState(cash.some(a => a.id === card.payment_account_id) ? card.payment_account_id ?? "" : "");
  const [typed, setTyped] = useState<string | null>(null); // null until the user edits cash
  const [date, setDate] = useState(today);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const pickFor = (reward: FinanceTransaction): Pick => picks[reward.id] ?? { on: false, amount: decimalPHPInput(cashbackSplit(reward).pending), date: today };
  const patch = (id: string, change: Partial<Pick>, reward: FinanceTransaction) => setPicks(all => ({ ...all, [id]: { ...pickFor(reward), ...all[id], ...change } }));

  const chosen = rewards.filter(r => pickFor(r).on);
  const cashbackCents = chosen.reduce((sum, r) => sum + previewCents(pickFor(r).amount), 0);
  // A confirmed bank balance already includes credits dated on/before its cutoff: they still post, but reduce nothing more.
  const includedCashbackCents = includedThroughDate ? chosen.reduce((sum, r) => pickFor(r).date <= includedThroughDate ? sum + previewCents(pickFor(r).amount) : sum, 0) : 0;
  const extraCashbackCents = cashbackCents - includedCashbackCents;
  // Until edited, cash covers older unpaid statements plus this one, minus cashback not already in the confirmed statement.
  const amount = typed ?? decimalPHPInput(Math.max(0, olderUnpaidCents + cycle.remaining_due_cents - extraCashbackCents));
  const cashCents = previewCents(amount);
  const applied = cashCents + cashbackCents;
  // Payments settle older unpaid statements first, then this one, then later balances.
  const statementApplied = cashCents + extraCashbackCents;
  const toOlder = Math.min(statementApplied, olderUnpaidCents);
  const toThis = Math.min(statementApplied - toOlder, cycle.remaining_due_cents);
  const preview = { cashCents, cashbackCents, includedCashbackCents, applied, toOlder, olderLeft: olderUnpaidCents - toOlder, remaining: cycle.remaining_due_cents - toThis, over: statementApplied - toOlder - toThis };

  function validate(): string {
    if (!/^\d+(\.\d{1,2})?$/.test(amount || "0")) return "Enter the cash amount as a PHP amount with at most 2 decimals.";
    if (cashCents > 0 && !source) return "Choose the cash account the payment comes from.";
    if (date > today) return "Payment date cannot be in the future.";
    if (!date) return "Choose the payment date.";
    for (const reward of chosen) {
      const pick = pickFor(reward); const cents = previewCents(pick.amount); const { pending: open } = cashbackSplit(reward);
      if (!/^\d+(\.\d{1,2})?$/.test(pick.amount) || cents <= 0 || cents > open) return `Cashback from ${reward.transaction_date} must be between 0.01 and ${formatPHP(open)}.`;
      if (!pick.date || pick.date > today || pick.date < reward.transaction_date) return `Cashback credited date for ${reward.transaction_date} must be on or after the purchase and not in the future.`;
    }
    return applied > 0 ? "" : "Enter a cash amount or choose cashback to apply.";
  }

  async function submit() {
    if (lock.current) return;
    const problem = validate();
    if (problem) { setError(problem); return; }
    lock.current = true; setBusy(true); setError("");
    const input = {
      version: card.version, statement_date: cycle.statement_date, ...(cashCents > 0 ? { source_account_id: source } : {}),
      amount: amount || "0", transaction_date: date,
      ...(chosen.length ? { cashbacks: chosen.map(r => ({ expense_id: r.id, version: r.version, amount: pickFor(r).amount, transaction_date: pickFor(r).date })) } : {}),
    };
    const fingerprint = JSON.stringify(input);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await fetch(`/api/finance/accounts/${card.id}/payment`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: pending.current.requestId }),
      }).then(financeJson<{ account: FinanceAccount }>);
      pending.current = null;
      window.dispatchEvent(new Event("finance-changed"));
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not record payment. Your entries are kept; retry safely.");
    } finally { lock.current = false; setBusy(false); }
  }
  return { source, setSource, amount, setAmount: setTyped, date, setDate, today, pickFor, patch, busy, error, preview, submit };
}
