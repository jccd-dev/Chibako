"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceAccount, FinanceSummary } from "./types";

type AccountPage = { accounts: FinanceAccount[]; total: number };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load finance. Try again.");
  return body;
}

export function useFinanceAccounts() {
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const saving = useRef(false);
  const loadSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const [page, position] = await Promise.all([
        fetch(`/api/finance/accounts?limit=50&offset=${offset}&archived=${includeArchived ? "all" : "false"}`).then(readJson<AccountPage>),
        fetch("/api/finance/summary").then(readJson<FinanceSummary>),
      ]);
      if (sequence !== loadSequence.current) return;
      if (offset > 0 && offset >= page.total) {
        setOffset(Math.max(0, Math.ceil(page.total / 50) - 1) * 50);
        return;
      }
      setAccounts(page.accounts);
      setTotal(page.total);
      setSummary(position);
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : "Could not load finance. Try again.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [offset, includeArchived]);

  useEffect(() => { void refresh(); return () => { loadSequence.current += 1; }; }, [refresh]);

  async function save(id: string | null, input: Record<string, string | number | boolean>, message: string) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setSaveError("");
    setNotice("");
    const fingerprint = JSON.stringify({ id, ...input });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await fetch(id ? `/api/finance/accounts/${id}` : "/api/finance/accounts", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, request_id: pending.current.requestId }),
      }).then(readJson<{ account: FinanceAccount }>);
      pending.current = null;
      setNotice(message);
      await refresh();
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save account. Try again.");
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function resetSave() { pending.current = null; setSaveError(""); }
  function showArchived(value: boolean) { setOffset(0); setIncludeArchived(value); }

  return { accounts, summary, total, offset, setOffset, includeArchived, showArchived, loading, busy, loadError, saveError, notice, refresh, save, resetSave };
}
