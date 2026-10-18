"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { financeJson } from "./client-json";
import type { FinanceAttentionPage } from "./overview-types";

export function useFinanceAttention(revision: string) {
  const [page, setPage] = useState<FinanceAttentionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const sequence = useRef(0);
  const [previousRevision, setPreviousRevision] = useState(revision);
  const requestKey = `${revision}:${offset}`;
  const [previousRequestKey, setPreviousRequestKey] = useState(requestKey);
  if (previousRevision !== revision) {
    setPreviousRevision(revision);
    setOffset(0);
  }
  if (previousRequestKey !== requestKey) {
    setPreviousRequestKey(requestKey);
    setLoading(true);
    setError("");
  }
  const load = useCallback(() => {
    const current = ++sequence.current;
    return fetch(`/api/finance/attention?limit=50&offset=${offset}`).then(financeJson<FinanceAttentionPage>)
      .then(result => { if (current === sequence.current) setPage(result); })
      .catch(caught => { if (current === sequence.current) setError(caught instanceof Error ? caught.message : "Could not load the attention queue."); })
      .finally(() => { if (current === sequence.current) setLoading(false); });
  }, [offset]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError("");
    return load();
  }, [load]);

  useEffect(() => {
    const requests = sequence;
    void load();
    const changed = () => { void refresh(); };
    window.addEventListener("finance-changed", changed);
    return () => {
      requests.current++;
      window.removeEventListener("finance-changed", changed);
    };
  }, [load, refresh, revision]);

  return { page, loading, error, offset, setOffset, refresh };
}

export type FinanceAttentionController = ReturnType<typeof useFinanceAttention>;
