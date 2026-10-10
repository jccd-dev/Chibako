"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { financeJson } from "./client-json";
import { evaluateTarsiCommitGate } from "./import-commit-gate";
import { TARSI_BACKUP_MAX_BYTES } from "./import-inspection-types";
import { tarsiIdentityKey } from "./import-preview-types";
import type { TarsiInspection } from "./import-inspection-types";
import type { TarsiPreview } from "./import-preview-types";
import { useFinanceImportCommit } from "./use-finance-import-commit";

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
  const [acknowledgedConflicts, setAcknowledgedConflicts] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const backup = useRef<unknown>(null);
  const sequence = useRef(0);
  const getSource = useCallback(() => backup.current, []);
  const invalidateConfirmation = useCallback(() => setConfirmed(false), []);
  const commitFlow = useFinanceImportCommit({
    getSource,
    preview,
    exclusions,
    acknowledged,
    acknowledgedConflicts,
    confirmed,
    onBackupInvalidated: invalidateConfirmation,
  });
  const resetCommit = commitFlow.reset;
  const commitActive = commitFlow.busy;
  const committed = commitFlow.committed;
  const locked = commitActive || committed;

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
    setAcknowledgedConflicts([]);
    setConfirmed(false);
    resetCommit();
  }, [resetCommit]);

  const reset = useCallback(() => {
    if (commitActive) return;
    sequence.current++;
    setFileName("");
    setFileSize(0);
    setReport(null);
    setError("");
    setBusy(false);
    clearPreview();
  }, [clearPreview, commitActive]);

  const inspect = useCallback(
    async (file: File) => {
      if (locked) return;
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
    [clearPreview, locked],
  );

  const requestPreview = useCallback(
    async (sent: {
      exclusions: string[];
      acknowledged_exclusions: string[];
      acknowledged_conflicts: string[];
    }): Promise<TarsiPreview | null> => {
      if (!backup.current || locked) return null;
      const current = ++sequence.current;
      setPreviewBusy(true);
      setPreviewError("");
      setPreviewNeedsUpdate(true);
      setConfirmed(false);
      resetCommit();
      try {
        const result = await fetch("/api/finance/import/inspect?preview=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            backup: backup.current,
            exclusions: sent.exclusions,
            acknowledged_exclusions: sent.acknowledged_exclusions,
            acknowledged_conflicts: sent.acknowledged_conflicts,
          }),
        }).then(financeJson<TarsiPreview>);
        if (current === sequence.current) {
          setPreview(result);
          setPreviewNeedsUpdate(false);
          setConfirmed(false);
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
    [locked, resetCommit],
  );

  const startPreview = useCallback(async () => {
    const result = await requestPreview({
      exclusions: [],
      acknowledged_exclusions: [],
      acknowledged_conflicts: [],
    });
    if (result) {
      setExclusions([]);
      setAcknowledged(
        result.exclusions.filter(row => row.acknowledged).map(row => row.path),
      );
      setAcknowledgedConflicts([]);
    }
  }, [requestPreview]);

  const updatePreview = useCallback(async () => {
    const result = await requestPreview({
      exclusions,
      acknowledged_exclusions: acknowledged,
      acknowledged_conflicts: acknowledgedConflicts,
    });
    if (result) {
      setAcknowledged(prev =>
        result.exclusions
          .filter(row => prev.includes(row.path) || row.acknowledged)
          .map(row => row.path),
      );
      setAcknowledgedConflicts(prev => result.records
        .filter(row => row.status === "conflict" && prev.includes(tarsiIdentityKey(row.collection, row.source_id)))
        .map(row => tarsiIdentityKey(row.collection, row.source_id)));
    }
  }, [requestPreview, exclusions, acknowledged, acknowledgedConflicts]);

  const toggleExclusion = useCallback((path: string) => {
    if (locked) return;
    setPreviewNeedsUpdate(true);
    setConfirmed(false);
    resetCommit();
    setPreviewError("");
    setAcknowledged(prev => prev.filter(row => row !== path
      && !row.startsWith(`${path}.`) && !row.startsWith(`${path}[`)
      && !path.startsWith(`${row}.`) && !path.startsWith(`${row}[`)));
    setExclusions(prev =>
      prev.includes(path)
        ? prev.filter(row => row !== path)
        : [...prev, path],
    );
  }, [locked, resetCommit]);

  const toggleAcknowledgment = useCallback((path: string) => {
    if (locked) return;
    setPreviewNeedsUpdate(true);
    setConfirmed(false);
    resetCommit();
    setAcknowledged(prev =>
      prev.includes(path)
        ? prev.filter(row => row !== path)
        : [...prev, path],
    );
  }, [locked, resetCommit]);

  const toggleConflictAcknowledgment = useCallback((key: string) => {
    if (locked) return;
    setPreviewNeedsUpdate(true);
    setConfirmed(false);
    resetCommit();
    setAcknowledgedConflicts(prev => prev.includes(key) ? prev.filter(row => row !== key) : [...prev, key]);
  }, [locked, resetCommit]);

  const toggleConfirmed = useCallback(() => {
    if (locked) return;
    setConfirmed(prev => !prev);
  }, [locked]);

  const commitGate = evaluateTarsiCommitGate({
    preview,
    needsUpdate: previewNeedsUpdate,
    busy: previewBusy || commitActive,
    acknowledged,
    backupVerified: commitFlow.backup !== null,
    confirmed,
  });

  const commitNow = useCallback(async () => {
    if (!commitGate.ready || locked) return null;
    return commitFlow.commit();
  }, [commitFlow, commitGate.ready, locked]);

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
    acknowledgedConflicts,
    confirmed,
    commitGate,
    startPreview,
    updatePreview,
    toggleExclusion,
    toggleAcknowledgment,
    toggleConflictAcknowledgment,
    toggleConfirmed,
    backup: commitFlow.backup,
    backupBusy: commitFlow.backupBusy,
    backupError: commitFlow.backupError,
    createBackup: commitFlow.createBackup,
    commitBusy: commitFlow.commitBusy,
    commitError: commitFlow.commitError,
    commitResult: commitFlow.result,
    committed,
    commitNow,
    locked,
  };
}
