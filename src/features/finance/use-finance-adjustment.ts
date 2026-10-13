"use client";

import { useCallback, useEffect, useState } from "react";
import { createAccountSchema, type FinanceAccount } from "./types";
import { postAdjustmentSchema } from "./movement-types";
import { decimalCents, exactCents } from "./money";
import { localCalendarDate } from "./presentation";
import type { FinanceActivityController } from "./use-finance-activity";

export function useFinanceAdjustment(activity: FinanceActivityController, accountId: string | null, maintainingBalance?: string) {
  const [account, setAccount] = useState<FinanceAccount | null>(null);
  const [actual, setActual] = useState("");
  const [date, setDate] = useState(localCalendarDate);
  const [text, setText] = useState("");
  const [loadError, setLoadError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  const [previousAccountId, setPreviousAccountId] = useState(accountId);
  if (previousAccountId !== accountId) {
    setPreviousAccountId(accountId);
    setActual(""); setDate(localCalendarDate()); setText(""); setErrors({});
  }
  const requestKey = `${accountId ?? ""}:${refreshKey}`;
  const [previousRequestKey, setPreviousRequestKey] = useState(requestKey);
  if (previousRequestKey !== requestKey) {
    setPreviousRequestKey(requestKey);
    setAccount(null); setLoadError("");
  }
  useEffect(() => {
    if (!accountId) return;
    const abort = new AbortController();
    void fetch(`/api/finance/accounts/${accountId}`, { signal: abort.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load current balance.");
      if (!abort.signal.aborted) setAccount(result.account);
    }).catch(error => { if (!abort.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load current balance."); });
    return () => abort.abort();
  }, [accountId, refreshKey]);
  let expectedBalance: number | null = null;
  let difference: number | null = null;
  if (account && (maintainingBalance === undefined || createAccountSchema.shape.maintaining_balance.safeParse(maintainingBalance).success)) {
    try {
      // Only our reserve edit changes the baseline; concurrent activity must still conflict.
      expectedBalance = exactCents(BigInt(account.balance_cents) + (maintainingBalance === undefined ? 0n
        : BigInt(decimalCents(maintainingBalance)) - BigInt(account.maintaining_balance_cents)));
      if (postAdjustmentSchema.shape.actual_balance.safeParse(actual).success)
        difference = exactCents(BigInt(decimalCents(actual)) - BigInt(expectedBalance));
    } catch { /* Validation below explains invalid or out-of-range amounts. */ }
  }
  function validate() {
    if (!account) return false;
    if (expectedBalance === null) {
      setErrors({ actual_balance: "Enter a maintaining balance and net balance within the exact-cent range." });
      return false;
    }
    const input = { account_id: account.id, actual_balance: actual, expected_balance_cents: expectedBalance, transaction_date: date, text };
    const parsed = postAdjustmentSchema.safeParse({ request_id: "validate", ...input });
    const validation: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) validation[String(issue.path[0])] = issue.message;
    if (!validation.actual_balance && difference === null) validation.actual_balance = "Enter a PHP balance and difference within the exact-cent range.";
    setErrors(validation);
    return Object.keys(validation).length === 0;
  }
  async function save() {
    if (!account || expectedBalance === null || !validate()) return false;
    const input = { account_id: account.id, actual_balance: actual, expected_balance_cents: expectedBalance, transaction_date: date, text };
    return !!await activity.postMovement(account.kind === "asset" ? "valuations" : "reconciliations", input);
  }
  return { account, actual, setActual, date, setDate, text, setText, loadError, errors, difference, expectedBalance, refresh, validate, save };
}
