"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatPHP, financeControl as control } from "@/features/finance/presentation";
import type { TarsiPreview, TarsiProposalRecord } from "@/features/finance/import-preview-types";

const summaryClass =
  "min-h-11 cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring";
const statusLabels: Record<TarsiProposalRecord["status"], string> = {
  accepted: "Accepted",
  blocked: "Blocked",
  excluded: "Excluded",
};
const statusClasses: Record<TarsiProposalRecord["status"], string> = {
  accepted: "font-medium",
  blocked: "font-medium text-destructive",
  excluded: "font-medium text-muted-foreground",
};

function detailRows(record: TarsiProposalRecord): [string, string][] {
  const target = record.target;
  const text = (key: string) =>
    typeof target[key] === "string" && target[key] ? String(target[key]) : null;
  const rows: [string, string][] = [];
  const add = (label: string, value: string | null) => {
    if (value !== null) rows.push([label, value]);
  };
  const addMoney = (label: string, key: string) => {
    const value = target[key];
    if (typeof value === "number") add(label, formatPHP(value));
  };
  add("Kind", text("kind"));
  add("Name", text("name"));
  add("Text", text("text"));
  addMoney("Amount", "amount_cents");
  addMoney("Target amount", "target_cents");
  addMoney("Exported balance", "snapshot_cents");
  addMoney("Opening principal", "opening_principal_cents");
  addMoney("Starting progress", "starting_progress_cents");
  addMoney("Outstanding", "outstanding_cents");
  if (typeof target.interval_count === "number" && typeof target.interval_unit === "string") {
    add("Repeats", `Every ${target.interval_count} ${target.interval_unit}`);
  }
  add("Date", text("transaction_date"));
  add("Starts", text("start_date"));
  add("Ends", text("end_date"));
  add("Due", text("due_date"));
  add("Account", text("account_id"));
  add("From account", text("from_account_id"));
  add("To account", text("to_account_id"));
  add("Category", text("category_id"));
  add("Subcategory", text("subcategory_id"));
  add("Tag", text("tag_id"));
  add("From schedule", text("schedule_id"));
  add("Parent category", text("parent_id"));
  add("Currency", text("currency"));
  add("Source kind", text("source_kind"));
  if (target.status === "pending") add("Activity status", "Pending, no cash effect yet");
  if (target.status === "posted") add("Activity status", "Posted");
  return rows;
}

function effectsLine(record: TarsiProposalRecord): string | null {
  if (record.status !== "accepted") return null;
  if (!record.effects.length) return "No cash effects.";
  return `Cash effects: ${record.effects
    .map(effect => `${effect.account_id} ${formatPHP(effect.amount_cents)}`)
    .join("; ")}.`;
}

function allocationsLine(record: TarsiProposalRecord): string | null {
  const allocations = record.target.allocations;
  if (!Array.isArray(allocations) || allocations.length === 0) return null;
  const values: unknown[] = allocations;
  const rows = values.flatMap(row => {
    if (typeof row !== "object" || row === null || !("account_id" in row) || !("amount_cents" in row)
      || typeof row.account_id !== "string" || typeof row.amount_cents !== "number") return [];
    return [`${row.account_id} ${formatPHP(row.amount_cents)}`];
  });
  return rows.length ? `Starting allocations: ${rows.join("; ")}.` : null;
}

export function FinanceImportPreview({
  preview,
  busy,
  error,
  needsUpdate,
  exclusions,
  acknowledged,
  onUpdate,
  onToggleExclusion,
  onToggleAcknowledgment,
}: {
  preview: TarsiPreview;
  busy: boolean;
  error: string;
  needsUpdate: boolean;
  exclusions: string[];
  acknowledged: string[];
  onUpdate: () => void;
  onToggleExclusion: (path: string) => void;
  onToggleAcknowledgment: (path: string) => void;
}) {
  const totals = preview.counts.reduce(
    (sum, row) => ({
      accepted: sum.accepted + row.accepted,
      skipped: sum.skipped + row.skipped,
      excluded: sum.excluded + row.excluded,
      blocked: sum.blocked + row.blocked,
    }),
    { accepted: 0, skipped: 0, excluded: 0, blocked: 0 },
  );

  return (
    <section aria-label="Migration preview" className="grid gap-4 border-t border-border pt-4">
      <section
        aria-label="Preview summary"
        className="grid gap-2 rounded-md border border-border bg-muted p-4 text-sm"
      >
        <p>
          Server decision:{" "}
          <strong>{needsUpdate ? "update required" : preview.can_approve ? "ready for approval" : "not approvable yet"}</strong>.
          {preview.can_approve && !needsUpdate
            ? " Approval and commit are separate later steps."
            : " Settle the blockers, exclusions, and acknowledgments below, then update the preview."}
        </p>
        <p className="tabular-nums">
          Proposal: {totals.accepted} accepted, {totals.skipped} skipped,{" "}
          {totals.excluded} excluded, {totals.blocked} blocked across{" "}
          {preview.counts.length} collection{preview.counts.length === 1 ? "" : "s"}.
        </p>
        <p className="text-muted-foreground">{preview.commit_notice}</p>
      </section>

      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Updating preview…
        </p>
      )}
      {error && (
        <Alert>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <details open>
        <summary className={summaryClass}>
          Proposal counts ({preview.counts.length})
        </summary>
        <ul className="mt-3 grid gap-3">
          {preview.counts.map(row => (
            <li
              key={row.collection}
              className="rounded-md border border-border p-3 text-sm"
            >
              <p className="break-words font-medium">{row.collection}</p>
              <p className="mt-1 tabular-nums text-muted-foreground">
                {row.accepted} accepted, {row.skipped} skipped,{" "}
                {row.excluded} excluded,{" "}
                <span className={row.blocked ? "font-medium text-destructive" : ""}>
                  {row.blocked} blocked
                </span>
              </p>
            </li>
          ))}
          {!preview.counts.length && (
            <li className="text-sm text-muted-foreground">No collections found.</li>
          )}
        </ul>
      </details>

      <details open>
        <summary className={summaryClass}>
          Reconciled balances ({preview.balances.length})
        </summary>
        <p className="mt-2 text-sm text-muted-foreground">
          Each opening balance is inferred so that the opening plus accepted
          historical effects matches the exported account snapshot exactly to
          the cent. Earlier historical balances are unverified.
        </p>
        <ul className="mt-3 grid gap-3">
          {preview.balances.map(row => (
            <li key={row.account_id} className="rounded-md border border-border p-3">
              <p className="break-all text-sm font-medium">
                {row.name}{" "}
                <span className="break-all font-normal text-muted-foreground">
                  ({row.account_id})
                </span>
              </p>
              <dl className="mt-2 grid gap-1 text-sm tabular-nums">
                <div className="flex flex-wrap justify-between gap-x-3">
                  <dt className="text-muted-foreground">Exported source snapshot</dt>
                  <dd>{formatPHP(row.source_cents)}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-x-3">
                  <dt className="text-muted-foreground">Accepted historical effects</dt>
                  <dd>{formatPHP(row.effects_cents)}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-x-3">
                  <dt className="text-muted-foreground">Inferred opening balance</dt>
                  <dd>{formatPHP(row.opening_cents)}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-x-3">
                  <dt className="text-muted-foreground">Reconciled balance</dt>
                  <dd className="font-medium">{formatPHP(row.reconciled_cents)}</dd>
                </div>
              </dl>
            </li>
          ))}
          {!preview.balances.length && (
            <li className="text-sm text-muted-foreground">
              No in-scope accounts found.
            </li>
          )}
        </ul>
      </details>

      <details>
        <summary className={summaryClass}>
          Proposed records ({preview.records.length})
        </summary>
        <p className="mt-2 text-sm text-muted-foreground">
          Each record keeps its source collection and ID identity. Recurring
          definitions are imported paused, and saved, paid, or collected amounts
          become starting progress without new cash movement.
        </p>
        <ul className="mt-3 grid gap-3">
          {preview.records.map((record, index) => {
            const rows = detailRows(record);
            const effects = effectsLine(record);
            const allocations = allocationsLine(record);
            const paused = record.target.paused === true;
            return (
              <li
                key={`${record.path}-${index}`}
                className="rounded-md border border-border p-3 text-sm"
              >
                <p className={statusClasses[record.status]}>
                  {statusLabels[record.status]}: {record.collection}{" "}
                  {record.source_id || "(no source ID)"}
                </p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {record.path}
                </p>
                {rows.length > 0 && (
                  <div className="mt-2 grid gap-1">
                    {rows.map(([label, value]) => (
                      <p key={label} className="break-words">
                        <span className="text-muted-foreground">{label}: </span>
                        {value}
                      </p>
                    ))}
                  </div>
                )}
                {paused && (
                  <p className="mt-2 font-medium">
                    Imported schedule starts paused; historical links are retained.
                  </p>
                )}
                {effects && <p className="mt-2 break-words tabular-nums">{effects}</p>}
                {allocations && (
                  <p className="mt-2 break-words tabular-nums">{allocations}</p>
                )}
                <details className="mt-2">
                  <summary className={summaryClass}>Preserved source data</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(record.source, null, 2)}</pre>
                </details>
              </li>
            );
          })}
          {!preview.records.length && (
            <li className="text-sm text-muted-foreground">No records found.</li>
          )}
        </ul>
      </details>

      <details>
        <summary className={summaryClass}>
          Preview issues ({preview.issues.length})
        </summary>
        <ul className="mt-3 grid gap-3">
          {preview.issues.map((issue, index) => (
            <li
              key={`${issue.code}-${issue.path}-${index}`}
              className="rounded-md border border-border p-3"
            >
              <p
                className={
                  issue.severity === "blocker"
                    ? "font-medium text-destructive"
                    : "font-medium"
                }
              >
                {issue.severity === "blocker" ? "Blocker" : "Exception"}:{" "}
                {issue.message}
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {issue.code} at {issue.path}
              </p>
            </li>
          ))}
          {!preview.issues.length && (
            <li className="text-sm text-muted-foreground">No issues reported.</li>
          )}
        </ul>
      </details>

      <details open>
        <summary className={summaryClass}>
          Exclusions and acknowledgments
        </summary>
        {preview.exclusion_choices.length > 0 && (
          <fieldset className="mt-3 grid gap-1" disabled={busy}>
            <legend className="text-sm font-medium">Explicit exclusions</legend>
            <p className="text-sm text-muted-foreground">
              Leave chosen source records or unsupported data out of this
              proposal. Update the preview to apply your choices.
            </p>
            {preview.exclusion_choices.map(choice => (
              <label
                key={choice.path}
                className="flex min-h-11 items-start gap-3 py-1 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={exclusions.includes(choice.path)}
                  onChange={() => onToggleExclusion(choice.path)}
                />
                <span className="min-w-0">
                  <span className="break-words">{choice.label}</span>
                  <span className="block break-all text-xs text-muted-foreground">
                    {choice.path}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {preview.exclusions.length > 0 && (
          <fieldset className="mt-4 grid gap-1" disabled={busy}>
            <legend className="text-sm font-medium">
              Exclusion acknowledgments
            </legend>
            <p className="text-sm text-muted-foreground">
              Acknowledge each exclusion and its reason; excluded data never
              becomes Vault records.
            </p>
            {preview.exclusions.map(row => (
              <div key={row.path}>
                <label
                  className="flex min-h-11 items-start gap-3 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={acknowledged.includes(row.path)}
                    onChange={() => onToggleAcknowledgment(row.path)}
                  />
                  <span className="min-w-0">
                    <span className="break-words">{row.reason}</span>
                    <span className="block break-all text-xs text-muted-foreground">
                      {row.path}
                    </span>
                  </span>
                </label>
                <details>
                  <summary className={summaryClass}>Excluded source data at {row.path}</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(row.source, null, 2)}</pre>
                </details>
              </div>
            ))}
          </fieldset>
        )}
        <div className="mt-4 grid gap-2">
          <Button
            type="button"
            variant="outline"
            className={control}
            disabled={busy}
            onClick={onUpdate}
          >
            Update preview
          </Button>
          <p className="text-xs text-muted-foreground">
            Resends your exclusions and acknowledgments to the server for a
            fresh proposal. Nothing is written to your Vault.
          </p>
        </div>
      </details>
    </section>
  );
}
