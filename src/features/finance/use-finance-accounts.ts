"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceAccount } from "./types";
import type { FinanceOverview } from "./overview-types";
type AccountPage = { accounts: FinanceAccount[]; total: number };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Could not load finance. Try again.");
  return body;
}

export function useFinanceAccounts() {
  const [summary, setSummary] = useState<FinanceOverview | null>(null);
  const [allAccounts, setAllAccounts] = useState<FinanceAccount[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(
    null,
  );
  const saving = useRef(false);
  const loadSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const [page, position] = await Promise.all([
        fetch("/api/finance/accounts?limit=100&archived=all").then(
          readJson<AccountPage>,
        ),
        fetch("/api/finance/overview").then(readJson<FinanceOverview>),
      ]);
      const rows = [...page.accounts];
      while (rows.length < page.total) {
        const next = await fetch(
          `/api/finance/accounts?limit=100&offset=${rows.length}&archived=all`,
        ).then(readJson<AccountPage>);
        if (!next.accounts.length)
          throw new Error("Account list changed. Try loading again.");
        rows.push(...next.accounts);
      }
      if (sequence !== loadSequence.current) return;
      setAllAccounts(rows);
      setSummary(position);
    } catch (error) {
      if (sequence === loadSequence.current)
        setLoadError(
          error instanceof Error
            ? error.message
            : "Could not load finance. Try again.",
        );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const changed = () => {
      void refresh();
    };
    changed();
    window.addEventListener("finance-changed", changed);
    return () => {
      loadSequence.current += 1;
      window.removeEventListener("finance-changed", changed);
    };
  }, [refresh]);

  async function save(
    id: string | null,
    input: Record<string, string | number | boolean>,
    message: string,
  ) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setSaveError("");
    setNotice("");
    const fingerprint = JSON.stringify({ id, ...input });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const result = await fetch(
        id ? `/api/finance/accounts/${id}` : "/api/finance/accounts",
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            request_id: pending.current.requestId,
          }),
        },
      ).then(readJson<{ account: FinanceAccount }>);
      pending.current = null;
      setNotice(message);
      await refresh();
      return result.account;
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not save account. Try again.",
      );
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function resetSave() {
    pending.current = null;
    setSaveError("");
  }
  function showArchived(value: boolean) {
    setIncludeArchived(value);
  }

  const accounts = allAccounts.filter(
    (account) => includeArchived || !account.archived,
  );
  return {
    accounts,
    allAccounts,
    summary,
    total: accounts.length,
    includeArchived,
    showArchived,
    loading,
    busy,
    loadError,
    saveError,
    notice,
    refresh,
    save,
    resetSave,
  };
}
export type FinanceAccountsController = ReturnType<typeof useFinanceAccounts>;
