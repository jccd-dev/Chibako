"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { financeJson } from "./client-json";
import { TARSI_BACKUP_MAX_BYTES } from "./import-inspection-types";
import type { TarsiInspection } from "./import-inspection-types";

export function useFinanceImportInspection() {
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [report, setReport] = useState<TarsiInspection | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);

  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );

  const reset = useCallback(() => {
    sequence.current++;
    setFileName("");
    setFileSize(0);
    setReport(null);
    setError("");
    setBusy(false);
  }, []);

  const inspect = useCallback(async (file: File) => {
    const current = ++sequence.current;
    setFileName(file.name);
    setFileSize(file.size);
    setReport(null);
    setError("");
    setBusy(false);
    if (file.size === 0) {
      setError("The selected file is empty.");
      return;
    }
    if (file.size > TARSI_BACKUP_MAX_BYTES) {
      setError(
        "This backup is larger than the inspection limit. Choose a smaller backup file.",
      );
      return;
    }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const result = await fetch("/api/finance/import/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bytes,
      }).then(financeJson<TarsiInspection>);
      if (current === sequence.current) setReport(result);
    } catch (thrown) {
      if (current === sequence.current) {
        setError(
          thrown instanceof Error
            ? thrown.message
            : "Could not inspect this backup.",
        );
      }
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }, []);

  return { fileName, fileSize, report, error, busy, inspect, reset };
}
