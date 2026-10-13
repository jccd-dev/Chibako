"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceAccount, FinanceAccountList } from "./types";
import type { ActivityPage, ActivityTotals, ClassificationPage, FinanceClassification, FinanceTransaction, PostedTransaction } from "./activity-types";
import type { CorrectedActivity } from "./correction-types";
import type { PostedObligationMovement } from "./obligation-types";
import type { PostedMovement } from "./movement-types";
import { financeJson as json } from "./client-json";
import { allocationWarningText, formatPHP, localCalendarDate } from "./presentation";

export type ActivityVisibility = "false" | "true" | "all";
export interface ActivityFilters { obligation_id?: string; q: string; date_from: string; date_to: string; account_id: string; category_id: string; type: string; hidden: ActivityVisibility; reverted: ActivityVisibility }
const emptyFilters: ActivityFilters = { q: "", date_from: "", date_to: "", account_id: "", category_id: "", type: "", hidden: "false", reverted: "false" };

export function useFinanceActivity(onPosted: () => Promise<void>) {
  const [filters, setFilters] = useState<ActivityFilters>(emptyFilters);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ActivityPage | null>(null);
  const [totals, setTotals] = useState<ActivityTotals | null>(null);
  const [month, setMonth] = useState(localCalendarDate().slice(0, 7));
  const [classifications, setClassifications] = useState<FinanceClassification[]>([]);
  const [classificationTotal, setClassificationTotal] = useState(0);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [accountTotal, setAccountTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [totalsError, setTotalsError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const historySequence = useRef(0);
  const totalsSequence = useRef(0);
  const optionLoading = useRef(false);
  const historyKey = `${JSON.stringify(filters)}:${offset}`;
  const [previousHistoryKey, setPreviousHistoryKey] = useState(historyKey);
  if (previousHistoryKey !== historyKey) {
    setPreviousHistoryKey(historyKey);
    setLoading(true); setLoadError("");
  }
  const [previousMonth, setPreviousMonth] = useState(month);
  if (previousMonth !== month) {
    setPreviousMonth(month);
    setTotals(null); setTotalsError("");
  }

  const loadHistory = useCallback(() => {
    const sequence = ++historySequence.current;
    const query = new URLSearchParams({ limit: "25", offset: String(offset) });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    return fetch(`/api/finance/activity?${query}`).then(json<ActivityPage>)
      .then(result => { if (sequence === historySequence.current) setPage(result); })
      .catch(error => { if (sequence === historySequence.current) setLoadError(error instanceof Error ? error.message : "Could not load activity."); })
      .finally(() => { if (sequence === historySequence.current) setLoading(false); });
  }, [filters, offset]);
  const refreshHistory = useCallback(() => {
    setLoading(true); setLoadError("");
    return loadHistory();
  }, [loadHistory]);
  const loadTotals = useCallback(() => {
    const sequence = ++totalsSequence.current;
    return fetch(`/api/finance/activity/totals?month=${month}`).then(json<ActivityTotals>)
      .then(result => { if (sequence === totalsSequence.current) setTotals(result); })
      .catch(error => { if (sequence === totalsSequence.current) setTotalsError(error instanceof Error ? error.message : "Could not load totals."); });
  }, [month]);
  const refreshTotals = useCallback(() => {
    setTotals(null); setTotalsError("");
    return loadTotals();
  }, [loadTotals]);
  const loadOptions = useCallback(() => {
    return Promise.all([
        fetch("/api/finance/accounts?archived=all&limit=100").then(json<FinanceAccountList>),
        fetch("/api/finance/classifications?archived=all&limit=100").then(json<ClassificationPage>),
      ]).then(([accountPage, classificationPage]) => {
      setAccounts(accountPage.accounts); setAccountTotal(accountPage.total);
      setClassifications(classificationPage.classifications); setClassificationTotal(classificationPage.total);
      }).catch(error => { setOptionsError(error instanceof Error ? error.message : "Could not load categories and accounts."); });
  }, []);
  const refreshOptions = useCallback(() => { setOptionsError(""); return loadOptions(); }, [loadOptions]);
  useEffect(() => {
    const requests = historySequence;
    void loadHistory();
    return () => { requests.current++; };
  }, [loadHistory]);
  useEffect(() => {
    const requests = totalsSequence;
    void loadTotals();
    return () => { requests.current++; };
  }, [loadTotals]);
  useEffect(() => { void loadOptions(); }, [loadOptions]);

  async function ensureClassification(id: string) {
    if (classifications.some(row => row.id === id)) return true;
    let nextOffset = classifications.length;
    while (true) {
      const result = await fetch(`/api/finance/classifications?archived=all&limit=100&offset=${nextOffset}`).then(json<ClassificationPage>);
      const found = result.classifications.some(row => row.id === id);
      setClassifications(current => [...current, ...result.classifications.filter(row => !current.some(item => item.id === row.id))]);
      if (found) return true;
      nextOffset += result.classifications.length;
      if (nextOffset >= result.total || result.classifications.length === 0) return false;
    }
  }

  async function loadMoreOptions(kind: "accounts" | "classifications") {
    if (optionLoading.current) return;
    optionLoading.current = true;
    setOptionsError("");
    try {
      if (kind === "accounts") {
        const result = await fetch(`/api/finance/accounts?archived=all&limit=100&offset=${accounts.length}`).then(json<FinanceAccountList>);
        setAccounts(current => [...current, ...result.accounts.filter(row => !current.some(item => item.id === row.id))]); setAccountTotal(result.total);
      } else {
        const result = await fetch(`/api/finance/classifications?archived=all&limit=100&offset=${classifications.length}`).then(json<ClassificationPage>);
        setClassifications(current => [...current, ...result.classifications.filter(row => !current.some(item => item.id === row.id))]); setClassificationTotal(result.total);
      }
    } catch (error) { setOptionsError(error instanceof Error ? error.message : "Could not load more options."); }
    finally { optionLoading.current = false; }
  }
  async function save<T>(path: string, input: object, method: string, onSuccess: (result: T) => Promise<void>): Promise<T | null> {
    if (saving.current) return null;
    saving.current = true; setBusy(true); setSaveError(""); setNotice("");
    const fingerprint = JSON.stringify({ path, input, method });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const result = await fetch(`/api/finance/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: pending.current.requestId }) }).then(json<T>);
      pending.current = null;
      window.dispatchEvent(new Event("finance-changed"));
      await onSuccess(result);
      return result;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not save. Try again."); return null; }
    finally { saving.current = false; setBusy(false); }
  }
  async function post(input: object) {
    return save<PostedTransaction>("activity", input, "POST", async result => {
      setNotice(`${result.warnings.includes("negative_balance") ? "Transaction saved. Negative balance: review this account." : "Transaction saved."}${result.cashback ? ` Cashback income recorded: ${formatPHP(result.cashback.amount_cents)}.` : ""}${allocationWarningText(result)}`);
      await Promise.all([refreshHistory(), refreshTotals(), refreshOptions(), onPosted()]);
    });
  }
  async function postMovement(path: "transfers" | "reconciliations" | "valuations", input: object) {
    return save<PostedMovement>(`activity/${path}`, input, "POST", async result => {
      const balances = result.balances.map(balance => `${accounts.find(account => account.id === balance.account_id)?.name ?? "Account"}: ${formatPHP(balance.balance_cents)}`).join("; ");
      setNotice(`Saved. ${balances}.${result.warnings.includes("negative_balance") ? " Negative balance: review this account." : ""}${allocationWarningText(result)}`);
      await Promise.all([refreshHistory(), refreshTotals(), refreshOptions(), onPosted()]);
    });
  }
  async function postObligation(input: object) {
    return save<PostedObligationMovement>("obligations/movements", input, "POST", async result => {
      const balances = result.balances.map(balance => `${accounts.find(account => account.id === balance.account_id)?.name ?? "Account"}: ${formatPHP(balance.balance_cents)}`).join("; ");
      setNotice(`Recorded ${result.transaction.type}. ${balances}. Outstanding ${result.obligation.kind}: ${formatPHP(result.obligation.outstanding_cents)}.${result.warnings.includes("negative_balance") ? " Negative balance: review this account." : ""}${allocationWarningText(result)}`);
      await Promise.all([refreshHistory(), refreshTotals(), refreshOptions(), onPosted()]);
    });
  }
  async function correct(id: string, action: "edit" | "hide" | "revert" | "refund", input: object) {
    const suffix = action === "revert" || action === "refund" ? `/${action}` : "";
    return save<CorrectedActivity>(`activity/${id}${suffix}`, input, action === "edit" ? "PATCH" : action === "hide" ? "DELETE" : "POST", async result => {
      const balances = result.balances.map(balance => `${accounts.find(account => account.id === balance.account_id)?.name ?? "Account"}: ${formatPHP(balance.balance_cents)}`).join("; ");
      const label = { edit: "Correction saved", hide: "Deleted from default Activity; financial effects retained", revert: "Activity reverted", refund: "Refund recorded" }[action];
      setNotice(`${label}. ${balances}.${result.obligation ? ` Outstanding ${result.obligation.kind}: ${formatPHP(result.obligation.outstanding_cents)}.` : ""}${result.warnings.includes("negative_balance") ? " Negative balance: review this account." : ""}${allocationWarningText(result)}`);
      await Promise.all([refreshHistory(), refreshTotals(), refreshOptions(), onPosted()]);
    });
  }
  async function setNoteLinks(id: string, input: object) {
    return save<{ transaction: FinanceTransaction; note_ids: string[]; balances: { account_id: string; balance_cents: number }[] }>(`activity/${id}/notes`, input, "PUT", async result => {
      const balances = result.balances.map(balance => `${accounts.find(account => account.id === balance.account_id)?.name ?? "Account"}: ${formatPHP(balance.balance_cents)}`).join("; ");
      setNotice(`Note links saved. Notes and balances unchanged. ${balances}.`);
      await refreshHistory();
    });
  }
  async function saveClassification(id: string | null, input: object) {
    return save<{ classification: FinanceClassification }>(id ? `classifications/${id}` : "classifications", input, id ? "PATCH" : "POST", async () => {
      setNotice("Classification saved.");
      await Promise.all([refreshOptions(), refreshHistory()]);
    });
  }
  const inspect = useCallback(async (id: string) => {
    return fetch(`/api/finance/activity/${id}?include_details=true`).then(json<{ transaction: FinanceTransaction }>).then(result => result.transaction);
  }, []);
  function applyFilters(value: ActivityFilters) { setOffset(0); setFilters(value); }
  function clearFilters() { applyFilters(emptyFilters); }
  const resetSave = useCallback(() => { pending.current = null; setSaveError(""); }, []);
  return { filters, applyFilters, clearFilters, offset, setOffset, page, totals, month, setMonth, classifications, classificationTotal, accounts, accountTotal, loading, loadError, optionsError, totalsError, saveError, notice, busy, post, postMovement, postObligation, correct, setNoteLinks, saveClassification, inspect, refreshHistory, refreshTotals, refreshOptions, ensureClassification, loadMoreOptions, resetSave };
}
export type FinanceActivityController = ReturnType<typeof useFinanceActivity>;
