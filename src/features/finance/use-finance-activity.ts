"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceAccount, FinanceAccountList } from "./types";
import type { ActivityPage, ActivityTotals, ClassificationPage, FinanceClassification, FinanceTransaction, PostedTransaction } from "./activity-types";
import type { CorrectedActivity } from "./correction-types";
import type { PostedMovement } from "./movement-types";
import { financeJson as json } from "./client-json";
import { formatPHP, localCalendarDate } from "./presentation";

export type ActivityVisibility = "false" | "true" | "all";
export interface ActivityFilters { q: string; date_from: string; date_to: string; account_id: string; category_id: string; type: string; hidden: ActivityVisibility; reverted: ActivityVisibility }
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

  const refreshHistory = useCallback(async () => {
    const sequence = ++historySequence.current;
    setLoading(true); setLoadError("");
    const query = new URLSearchParams({ limit: "25", offset: String(offset) });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    try {
      const result = await fetch(`/api/finance/activity?${query}`).then(json<ActivityPage>);
      if (sequence === historySequence.current) setPage(result);
    } catch (error) {
      if (sequence === historySequence.current) setLoadError(error instanceof Error ? error.message : "Could not load activity.");
    } finally { if (sequence === historySequence.current) setLoading(false); }
  }, [filters, offset]);
  const refreshTotals = useCallback(async () => {
    const sequence = ++totalsSequence.current;
    setTotals(null); setTotalsError("");
    try {
      const result = await fetch(`/api/finance/activity/totals?month=${month}`).then(json<ActivityTotals>);
      if (sequence === totalsSequence.current) setTotals(result);
    } catch (error) { if (sequence === totalsSequence.current) setTotalsError(error instanceof Error ? error.message : "Could not load totals."); }
  }, [month]);
  const refreshOptions = useCallback(async () => {
    setOptionsError("");
    try {
      const [accountPage, classificationPage] = await Promise.all([
        fetch("/api/finance/accounts?archived=all&limit=100").then(json<FinanceAccountList>),
        fetch("/api/finance/classifications?archived=all&limit=100").then(json<ClassificationPage>),
      ]);
      setAccounts(accountPage.accounts); setAccountTotal(accountPage.total);
      setClassifications(classificationPage.classifications); setClassificationTotal(classificationPage.total);
    } catch (error) { setOptionsError(error instanceof Error ? error.message : "Could not load categories and accounts."); }
  }, []);
  useEffect(() => { void refreshHistory(); return () => { historySequence.current++; }; }, [refreshHistory]);
  useEffect(() => { void refreshTotals(); return () => { totalsSequence.current++; }; }, [refreshTotals]);
  useEffect(() => { void refreshOptions(); }, [refreshOptions]);

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
      await onSuccess(result);
      return result;
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not save. Try again."); return null; }
    finally { saving.current = false; setBusy(false); }
  }
  async function post(input: object) {
    return save<PostedTransaction>("activity", input, "POST", async result => {
      setNotice(result.warnings.includes("negative_balance") ? "Transaction saved. Negative balance: review this account." : "Transaction saved.");
      await Promise.all([refreshHistory(), refreshTotals(), refreshOptions(), onPosted()]);
    });
  }
  async function postMovement(path: "transfers" | "reconciliations" | "valuations", input: object) {
    return save<PostedMovement>(`activity/${path}`, input, "POST", async result => {
      const balances = result.balances.map(balance => `${accounts.find(account => account.id === balance.account_id)?.name ?? "Account"}: ${formatPHP(balance.balance_cents)}`).join("; ");
      setNotice(`Saved. ${balances}.${result.warnings.includes("negative_balance") ? " Negative balance: review this account." : ""}`);
      await Promise.all([refreshHistory(), refreshTotals(), refreshOptions(), onPosted()]);
    });
  }
  async function correct(id: string, action: "edit" | "hide" | "revert" | "refund", input: object) {
    const suffix = action === "revert" || action === "refund" ? `/${action}` : "";
    return save<CorrectedActivity>(`activity/${id}${suffix}`, input, action === "edit" ? "PATCH" : action === "hide" ? "DELETE" : "POST", async result => {
      const balances = result.balances.map(balance => `${accounts.find(account => account.id === balance.account_id)?.name ?? "Account"}: ${formatPHP(balance.balance_cents)}`).join("; ");
      const label = { edit: "Correction saved", hide: "Deleted from default Activity; financial effects retained", revert: "Activity reverted", refund: "Refund recorded" }[action];
      setNotice(`${label}. ${balances}.${result.warnings.includes("negative_balance") ? " Negative balance: review this account." : ""}`);
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
  async function inspect(id: string) {
    return fetch(`/api/finance/activity/${id}?include_details=true`).then(json<{ transaction: FinanceTransaction }>).then(result => result.transaction);
  }
  function applyFilters(value: ActivityFilters) { setOffset(0); setFilters(value); }
  function clearFilters() { applyFilters(emptyFilters); }
  function resetSave() { pending.current = null; setSaveError(""); }
  return { filters, applyFilters, clearFilters, offset, setOffset, page, totals, month, setMonth, classifications, classificationTotal, accounts, accountTotal, loading, loadError, optionsError, totalsError, saveError, notice, busy, post, postMovement, correct, setNoteLinks, saveClassification, inspect, refreshHistory, refreshTotals, refreshOptions, loadMoreOptions, resetSave };
}
export type FinanceActivityController = ReturnType<typeof useFinanceActivity>;
