"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FinanceClientError, financeJson } from "./client-json";
import {
  buildTarsiCommitPayload,
  commitFingerprint,
  commitRequestFor,
  summarizeTarsiImportResult,
  type TarsiCommitRequest,
  type TarsiImportSummary,
} from "./import-commit-flow";
import type { TarsiImportBackup, TarsiImportResult } from "./import-commit";
import type { TarsiPreview } from "./import-preview-types";

export function useFinanceImportCommit({
  getSource,
  preview,
  exclusions,
  acknowledged,
  confirmed,
  onBackupInvalidated,
}: {
  getSource: () => unknown;
  preview: TarsiPreview | null;
  exclusions: string[];
  acknowledged: string[];
  confirmed: boolean;
  onBackupInvalidated: () => void;
}) {
  const [backup, setBackup] = useState<TarsiImportBackup | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [result, setResult] = useState<TarsiImportSummary | null>(null);
  const request = useRef<TarsiCommitRequest | null>(null);
  const sequence = useRef(0);
  const active = useRef(false);

  useEffect(() => () => { sequence.current++; }, []);

  const committed = result !== null;

  const reset = useCallback(() => {
    if (active.current) return;
    sequence.current++;
    request.current = null;
    setBackup(null);
    setBackupBusy(false);
    setBackupError("");
    setCommitBusy(false);
    setCommitError("");
    setResult(null);
  }, []);

  const createBackup = useCallback(async () => {
    if (active.current || committed) return null;
    const current = ++sequence.current;
    active.current = true;
    setBackupBusy(true);
    setBackupError("");
    setBackup(null);
    try {
      const created = await fetch("/api/finance/import/backup", { method: "POST" }).then(financeJson<TarsiImportBackup>);
      if (current !== sequence.current) return null;
      setBackup(created);
      return created;
    } catch (thrown) {
      if (current === sequence.current) {
        setBackupError(thrown instanceof Error ? thrown.message : "Could not create a verified backup. Try again.");
      }
      return null;
    } finally {
      if (current === sequence.current) {
        active.current = false;
        setBackupBusy(false);
      }
    }
  }, [committed]);

  const commit = useCallback(async () => {
    if (active.current || committed || !backup || !preview || !confirmed) return null;
    const current = ++sequence.current;
    active.current = true;
    setCommitBusy(true);
    setCommitError("");
    const fingerprint = commitFingerprint({ backupId: backup.id, proposalHash: preview.proposal_hash, exclusions, acknowledged });
    const attempt = commitRequestFor(request.current, fingerprint, () => crypto.randomUUID());
    request.current = attempt;
    const review = { backupId: backup.id, proposalHash: preview.proposal_hash, exclusions, acknowledged };
    try {
      const response = await fetch("/api/finance/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTarsiCommitPayload(review, attempt.requestId, getSource())),
      }).then(financeJson<TarsiImportResult>);
      if (current !== sequence.current) return null;
      const summary = summarizeTarsiImportResult(response, preview);
      setResult(summary);
      return summary;
    } catch (thrown) {
      if (current === sequence.current) {
        setCommitError(thrown instanceof Error ? thrown.message : "Could not commit this import. Try again.");
        if (thrown instanceof FinanceClientError && ["backup_stale", "backup_unavailable"].includes(thrown.code ?? "")) {
          setBackup(null);
          onBackupInvalidated();
        }
      }
      return null;
    } finally {
      if (current === sequence.current) {
        active.current = false;
        setCommitBusy(false);
      }
    }
  }, [acknowledged, backup, committed, confirmed, exclusions, getSource, onBackupInvalidated, preview]);

  return {
    backup,
    backupBusy,
    backupError,
    createBackup,
    commit,
    commitBusy,
    commitError,
    committed,
    result,
    reset,
    busy: backupBusy || commitBusy,
  };
}
