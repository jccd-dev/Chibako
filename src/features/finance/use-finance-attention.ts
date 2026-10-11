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
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await fetch(`/api/finance/attention?limit=50&offset=${offset}`).then(financeJson<FinanceAttentionPage>);
      if (current === sequence.current) setPage(result);
    } catch (caught) {
      if (current === sequence.current) setError(caught instanceof Error ? caught.message : "Could not load the attention queue.");
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    setOffset(0);
  }, [revision]);

  useEffect(() => {
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener("finance-changed", changed);
    return () => {
      sequence.current++;
      window.removeEventListener("finance-changed", changed);
    };
  }, [refresh, revision]);

  return { page, loading, error, offset, setOffset, refresh };
}

export type FinanceAttentionController = ReturnType<typeof useFinanceAttention>;
