"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatPHP, financeControl as control } from "@/features/finance/presentation";
import { cn } from "@/lib/utils";
import type { TarsiCommitGate } from "@/features/finance/import-commit-gate";
import type { TarsiImportBackup } from "@/features/finance/import-commit";
import { tarsiBackupHref } from "@/features/finance/import-commit-flow";
import type { TarsiImportSummary } from "@/features/finance/import-commit-flow";

const summaryClass =
  "min-h-11 cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring";

export function FinanceImportCommit({
  gate,
  confirmed,
  backup,
  backupBusy,
  backupError,
  commitBusy,
  commitError,
  committed,
  result,
  locked,
  onCreateBackup,
  onToggleConfirmed,
  onCommit,
}: {
  gate: TarsiCommitGate;
  confirmed: boolean;
  backup: TarsiImportBackup | null;
  backupBusy: boolean;
  backupError: string;
  commitBusy: boolean;
  commitError: string;
  committed: boolean;
  result: TarsiImportSummary | null;
  locked: boolean;
  onCreateBackup: () => void;
  onToggleConfirmed: () => void;
  onCommit: () => void;
}) {
  if (committed && result) return <ImportResult result={result} />;

  const reviewSettled = gate.checks.filter(check => check.key !== "backup" && check.key !== "confirmation").every(check => check.met);
  const busy = backupBusy || commitBusy;

  return (
    <section aria-label="Commit import" className="grid gap-3 rounded-md border border-border p-4 text-sm">
      <p className="font-medium">Before commit</p>
      <ul className="grid gap-2">
        {gate.checks.map(check => (
          <li key={check.key} className="flex flex-wrap justify-between gap-x-3">
            <span>{check.label}</span>
            <span className={check.met ? "font-medium" : "font-medium text-destructive"}>
              {check.met ? "Met" : "Pending"}
            </span>
          </li>
        ))}
      </ul>

      <div className="grid gap-2 border-t border-border pt-3">
        <p className="font-medium">1. Create a verified backup</p>
        <p className="text-muted-foreground">
          Creates a private SQLite copy of this Vault before any finance data changes. The backup
          file stays on this server in a private owner-only location. Download it and keep it
          somewhere safe.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className={control}
            disabled={busy || locked || !reviewSettled || backup !== null}
            onClick={onCreateBackup}
          >
            {backupBusy ? "Creating backup…" : backup ? "Verified backup created" : "Create verified backup"}
          </Button>
          {backup && (
            <a
              href={tarsiBackupHref(backup.id)}
              download
              className={cn(buttonVariants({ variant: "outline" }), control)}
            >
              Download backup
            </a>
          )}
        </div>
        {backup && (
          <p className="break-all text-xs text-muted-foreground tabular-nums">
            Verified backup {backup.id} · {formatBytes(backup.size_bytes)} · sha256 {backup.sha256}
          </p>
        )}
        {backupError && (
          <Alert>
            <AlertDescription>{backupError}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="grid gap-2 border-t border-border pt-3">
        <p className="font-medium">2. Confirm and commit</p>
        <label className="flex min-h-11 items-start gap-3 py-1">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            checked={confirmed}
            disabled={busy || locked || !gate.canConfirm || backup === null}
            onChange={onToggleConfirmed}
          />
          <span className="min-w-0">
            I reviewed this proposal, including its blockers, exclusions, and reconciled balances.
          </span>
        </label>
        <p className="text-muted-foreground">
          Restoring this backup is not an in-app action. If the Vault changes after the backup, those changes must be accounted for during any offline recovery.
        </p>
        <Button
          type="button"
          className={control}
          disabled={!gate.ready || locked}
          onClick={onCommit}
        >
          {commitBusy ? "Committing import…" : "Commit import"}
        </Button>
        {commitBusy && (
          <p role="status" className="text-sm text-muted-foreground">
            Committing. Keep this panel open until the result appears.
          </p>
        )}
        {commitError && (
          <Alert>
            <AlertDescription>{commitError}</AlertDescription>
          </Alert>
        )}
      </div>
    </section>
  );
}

function ImportResult({ result }: { result: TarsiImportSummary }) {
  const progressKind: Record<string, string> = {
    saved: "Saved toward the goal",
    paid: "Paid toward the obligation",
    collected: "Collected toward the obligation",
  };

  return (
    <section aria-label="Import result" className="grid gap-4 rounded-md border border-border p-4 text-sm">
      <p className="font-medium">Import committed</p>
      <p className="tabular-nums">
        {result.counts.imported} imported, {result.counts.skipped} skipped, {result.counts.excluded} excluded.
      </p>

      <details open>
        <summary className={summaryClass}>Reconciled accounts ({result.balances.length})</summary>
        <ul className="mt-3 grid gap-2">
          {result.balances.map(row => (
            <li key={row.account_id} className="flex flex-wrap justify-between gap-x-3 tabular-nums">
              <span className="break-words">{row.name}</span>
              <span className="font-medium">{formatPHP(row.reconciled_cents)}</span>
            </li>
          ))}
          {!result.balances.length && <li className="text-muted-foreground">No accounts reconciled.</li>}
        </ul>
      </details>

      <details open>
        <summary className={summaryClass}>Paused schedules ({result.pausedSchedules.length})</summary>
        <p className="mt-2 text-muted-foreground">Imported recurring definitions stay paused. Resume each one deliberately from Recurrence.</p>
        <ul className="mt-3 grid gap-2">
          {result.pausedSchedules.map(item => (
            <li key={item.path} className="break-words">{item.label}</li>
          ))}
          {!result.pausedSchedules.length && <li className="text-muted-foreground">No schedules imported.</li>}
        </ul>
      </details>

      <details open>
        <summary className={summaryClass}>Preserved progress ({result.startingProgress.length})</summary>
        <ul className="mt-3 grid gap-2">
          {result.startingProgress.map(item => (
            <li key={item.path} className="flex flex-wrap justify-between gap-x-3 tabular-nums">
              <span className="break-words">{item.label}</span>
              <span className="text-right">
                <span className="font-medium">{formatPHP(item.cents)}</span>{" "}
                <span className="text-muted-foreground">{progressKind[item.kind] ?? item.kind}</span>
              </span>
            </li>
          ))}
          {!result.startingProgress.length && <li className="text-muted-foreground">No starting progress recorded.</li>}
        </ul>
      </details>

      <details open>
        <summary className={summaryClass}>Source-only references ({result.relationships.length})</summary>
        <p className="mt-2 text-muted-foreground">
          Some source references have no field in the finance schema; the reference is kept in source metadata only.
        </p>
        <ul className="mt-3 grid gap-2">
          {result.relationships.map(item => (
            <li key={item.path} className="break-words">
              <span className="font-medium">{item.field}</span> at {item.path}. {item.reason}
            </li>
          ))}
          {!result.relationships.length && <li className="text-muted-foreground">No source-only references retained.</li>}
        </ul>
      </details>

      <details>
        <summary className={summaryClass}>Skipped and excluded ({result.skipped.length + result.exclusions.length})</summary>
        <ul className="mt-3 grid gap-2">
          {result.skipped.map(item => (
            <li key={item.path} className="break-words">
              <span className="font-medium">Skipped:</span> {item.label}. {item.reason}
            </li>
          ))}
          {result.exclusions.map(item => (
            <li key={item.path} className="break-words">
              <span className="font-medium">Excluded:</span> {item.path}. {item.reason}
            </li>
          ))}
          {!result.skipped.length && !result.exclusions.length && <li className="text-muted-foreground">Nothing skipped or excluded.</li>}
        </ul>
      </details>

      <p className="text-muted-foreground">
        Notes were not changed and no Note links were created. The verified backup stays on this
        server in a private owner-only location. Keep the downloaded copy until you are satisfied
        with the import.
      </p>
    </section>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
