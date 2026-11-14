"use client";

import { useEffect, useState } from "react";
import type { SearchResult } from "@/lib/notes";

/**
 * Debounced `/api/search` for a search box. A newer query aborts the older
 * request, so a slow response never replaces fresher results.
 */
export function useNoteSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [previous, setPrevious] = useState(query);
  if (previous !== query) {
    setPrevious(query);
    setBusy(Boolean(query.trim()));
    if (!query.trim()) setResults([]);
  }

  useEffect(() => {
    if (!query.trim()) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        // A rejected query (such as an invalid folder path) has no matches.
        setResults(res.ok ? (await res.json()).results : []);
        setBusy(false);
      } catch {
        // Aborted by a newer query, or offline: the newer query owns busy.
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  return { results, busy };
}
