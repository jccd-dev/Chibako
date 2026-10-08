"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { financeJson } from "./client-json";
import { TARSI_BACKUP_MAX_BYTES } from "./import-inspection-types";
import type { TarsiInspection } from "./import-inspection-types";
import type { TarsiPreview } from "./import-preview-types";

export function useFinanceImportInspection() {
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [report, setReport] = useState<TarsiInspection | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<TarsiPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewNeedsUpdate, setPreviewNeedsUpdate] = useState(false);
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const backup = useRef<unknown>(null);
  const sequence = useRef(0);

  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );

  const clearPreview = useCallback(() => {
    backup.current = null;
    setPreview(null);
    setPreviewBusy(false);
    setPreviewError("");
    setPreviewNeedsUpdate(false);
    setExclusions([]);
    setAcknowledged([]);
  }, []);

  const reset = useCallback(() => {
    sequence.current++;
    setFileName("");
    setFileSize(0);
    setReport(null);
    setError("");
    setBusy(false);
    clearPreview();
  }, [clearPreview]);

  const inspect = useCallback(
    async (file: File) => {
      const current = ++sequence.current;
      setFileName(file.name);
      setFileSize(file.size);
      setReport(null);
      setError("");
      setBusy(false);
      clearPreview();
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
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          if (current === sequence.current) {
            setError("This file is not valid JSON.");
          }
          return;
        }
        const result = await fetch("/api/finance/import/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: bytes,
        }).then(financeJson<TarsiInspection>);
        if (current === sequence.current) {
          backup.current = parsed;
          setReport(result);
        }
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
    },
    [clearPreview],
  );

  const requestPreview = useCallback(
    async (sent: {
      exclusions: string[];
      acknowledged_exclusions: string[];
    }): Promise<TarsiPreview | null> => {
      if (!backup.current) return null;
      const current = ++sequence.current;
      setPreviewBusy(true);
      setPreviewError("");
      setPreviewNeedsUpdate(true);
      try {
        const result = await fetch("/api/finance/import/inspect?preview=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            backup: backup.current,
            exclusions: sent.exclusions,
            acknowledged_exclusions: sent.acknowledged_exclusions,
          }),
        }).then(financeJson<TarsiPreview>);
        if (current === sequence.current) {
          setPreview(result);
          setPreviewNeedsUpdate(false);
          return result;
        }
      } catch (thrown) {
        if (current === sequence.current) {
          setPreviewError(
            thrown instanceof Error
              ? thrown.message
              : "Could not prepare this preview. Try again.",
          );
        }
      } finally {
        if (current === sequence.current) setPreviewBusy(false);
      }
      return null;
    },
    [],
  );

  const startPreview = useCallback(async () => {
    const result = await requestPreview({
      exclusions: [],
      acknowledged_exclusions: [],
    });
    if (result) {
      setExclusions([]);
      setAcknowledged(
        result.exclusions.filter(row => row.acknowledged).map(row => row.path),
      );
    }
  }, [requestPreview]);

  const updatePreview = useCallback(async () => {
    const result = await requestPreview({
      exclusions,
      acknowledged_exclusions: acknowledged,
    });
    if (result) {
      setAcknowledged(prev =>
        result.exclusions
          .filter(row => prev.includes(row.path) || row.acknowledged)
          .map(row => row.path),
      );
    }
  }, [requestPreview, exclusions, acknowledged]);

  const toggleExclusion = useCallback((path: string) => {
    setPreviewNeedsUpdate(true);
    setPreviewError("");
    setAcknowledged(prev => prev.filter(row => row !== path
      && !row.startsWith(`${path}.`) && !row.startsWith(`${path}[`)
      && !path.startsWith(`${row}.`) && !path.startsWith(`${row}[`)));
    setExclusions(prev =>
      prev.includes(path)
        ? prev.filter(row => row !== path)
        : [...prev, path],
    );
  }, []);

  const toggleAcknowledgment = useCallback((path: string) => {
    setPreviewNeedsUpdate(true);
    setAcknowledged(prev =>
      prev.includes(path)
        ? prev.filter(row => row !== path)
        : [...prev, path],
    );
  }, []);

  return {
    fileName,
    fileSize,
    report,
    error,
    busy,
    inspect,
    reset,
    preview,
    previewBusy,
    previewError,
    previewNeedsUpdate,
    exclusions,
    acknowledged,
    startPreview,
    updatePreview,
    toggleExclusion,
    toggleAcknowledgment,
  };
}
