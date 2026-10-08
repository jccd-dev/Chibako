"use client";

import { useRef, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { financeControl as control, financeSheet } from "@/features/finance/presentation";
import { useFinanceImportInspection } from "@/features/finance/use-finance-import-inspection";
import { FinanceImportPreview } from "@/features/finance/components/FinanceImportPreview";
import { TARSI_BACKUP_MAX_BYTES } from "@/features/finance/import-inspection-types";
import type { TarsiInspection } from "@/features/finance/import-inspection-types";

const summaryClass =
  "min-h-11 cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring";
const dateStatusLabels: Record<TarsiInspection["dates"][number]["status"], string> = {
  "calendar-day": "Explicit calendar day, kept as written",
  timestamp: "Metadata timestamp, retained without day mapping",
  invalid: "Invalid date",
  ambiguous: "Ambiguous timestamp-to-day mapping",
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function FinanceImportInspection({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const inspection = useFinanceImportInspection();
  const inputRef = useRef<HTMLInputElement>(null);
  const limitLabel = formatBytes(TARSI_BACKUP_MAX_BYTES);

  function close(nextOpen: boolean) {
    if (nextOpen || inspection.busy || inspection.previewBusy) return;
    inspection.reset();
    onClose();
  }

  function change(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (file) void inspection.inspect(file);
  }

  const report = inspection.report;
  const collections =
    report?.sections.filter((section) => section.kind === "collection") ?? [];
  const recordCount = collections.reduce(
    (total, section) => total + (section.count ?? 0),
    0,
  );
  const blockers =
    report?.issues.filter((issue) => issue.severity === "blocker") ?? [];
  const exceptions =
    report?.issues.filter((issue) => issue.severity === "exception") ?? [];
  const unresolved =
    report?.relationships.filter((relation) => !relation.resolved) ?? [];
  const divergentMirrors =
    report?.mirrors.filter((mirror) => mirror.divergent_sections.length > 0) ??
    [];

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className={financeSheet} showCloseButton={false}>
        <SheetHeader className="border-b border-border p-6">
          <SheetTitle>Source inspection</SheetTitle>
          <SheetDescription className="text-sm">
            Choose a Tarsi backup to review its structure and preview a
            reconciled migration. Nothing is written to your Vault. The file is
            sent to this server for inspection and is never saved.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-6 p-6">
          <input
            ref={inputRef}
            id="tarsi-backup-file"
            type="file"
            aria-label="Tarsi backup JSON file"
            tabIndex={-1}
            accept=".json,application/json"
            className="sr-only"
            disabled={inspection.busy || inspection.previewBusy}
            onChange={change}
          />
          <div className="grid gap-2">
            <Button
              type="button"
              variant="outline"
              className={control}
              disabled={inspection.busy || inspection.previewBusy}
              onClick={() => inputRef.current?.click()}
            >
              {inspection.fileName
                ? "Choose a different backup"
                : "Choose backup file"}
            </Button>
            <p className="text-sm text-muted-foreground">
              JSON backups up to {limitLabel}. Inspection is read-only;
              afterwards you can request a reconciled migration preview.
            </p>
            {inspection.fileName && (
              <p className="text-sm">
                Selected:{" "}
                <span className="break-all font-medium">
                  {inspection.fileName}
                </span>{" "}
                <span className="tabular-nums text-muted-foreground">
                  ({formatBytes(inspection.fileSize)})
                </span>
              </p>
            )}
          </div>

          {inspection.error && (
            <Alert>
              <AlertDescription>
                {inspection.error} Choose a Tarsi backup JSON file up to{" "}
                {limitLabel} and try again.
              </AlertDescription>
            </Alert>
          )}
          {inspection.busy && (
            <p role="status" className="text-sm text-muted-foreground">
              Inspecting backup…
            </p>
          )}

          {report && (
            <>
              <section
                aria-label="Inspection summary"
                className="grid gap-2 rounded-md border border-border bg-muted p-4 text-sm"
              >
                <p>
                  Initial migration eligible:{" "}
                  <strong>{report.eligible ? "Yes" : "No"}</strong>. A backup
                  can be inspected at any time, even when this Vault already has
                  finance records.
                </p>
                <p>
                  Representation:{" "}
                  <strong className="break-words">
                    {report.representation}
                  </strong>
                  {report.profile_id && (
                    <>
                      {" "}
                      (profile <code className="break-all">{report.profile_id}</code>)
                    </>
                  )}
                  . Mirrored records are reported, never combined.
                </p>
                <p>
                  Records: {recordCount} across {collections.length}{" "}
                  collection{collections.length === 1 ? "" : "s"}.
                </p>
                <p>
                  Currencies:{" "}
                  {report.currencies.length
                    ? report.currencies.join(", ")
                    : "None found"}
                  .
                </p>
                <p>
                  {blockers.length} blocker{blockers.length === 1 ? "" : "s"}{" "}
                  and {exceptions.length} exception
                  {exceptions.length === 1 ? "" : "s"}.{" "}
                  {report.can_proceed
                    ? "The structure is ready for the next migration step."
                    : "Progression is blocked by the issues listed below."}
                </p>
                <p className="text-muted-foreground">
                  Choose Preview migration below to review the server-derived
                  reconciled proposal. Nothing is written to your Vault at any
                  step, and commit is a separate later step.
                </p>
              </section>

              {!inspection.preview && (
                <div className="grid gap-2">
                  <Button
                    type="button"
                    className={control}
                    disabled={inspection.busy || inspection.previewBusy}
                    onClick={() => void inspection.startPreview()}
                  >
                    Preview migration
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Prepares a reconciled proposal from this backup, even while
                    blockers remain. The file stays in this browser tab's memory
                    until you close the panel or choose a different file.
                  </p>
                  {inspection.previewBusy && (
                    <p role="status" className="text-sm text-muted-foreground">
                      Preparing preview…
                    </p>
                  )}
                  {inspection.previewError && (
                    <Alert>
                      <AlertDescription>
                        {inspection.previewError}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}

              {inspection.preview && (
                <FinanceImportPreview
                  preview={inspection.preview}
                  busy={inspection.previewBusy}
                  error={inspection.previewError}
                  needsUpdate={inspection.previewNeedsUpdate}
                  exclusions={inspection.exclusions}
                  acknowledged={inspection.acknowledged}
                  onUpdate={() => void inspection.updatePreview()}
                  onToggleExclusion={inspection.toggleExclusion}
                  onToggleAcknowledgment={inspection.toggleAcknowledgment}
                />
              )}

              <details>
                <summary className={summaryClass}>
                  Issues ({report.issues.length})
                </summary>
                <ul className="mt-3 grid gap-3">
                  {report.issues.map((issue, index) => (
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
                        {issue.severity === "blocker"
                          ? "Blocker"
                          : "Exception"}
                        : {issue.message}
                      </p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {issue.code} at {issue.path}
                      </p>
                    </li>
                  ))}
                  {!report.issues.length && (
                    <li className="text-sm text-muted-foreground">
                      No issues reported.
                    </li>
                  )}
                </ul>
              </details>

              <details>
                <summary className={summaryClass}>
                  Sections and counts ({report.sections.length})
                </summary>
                <ul className="mt-3 grid gap-3">
                  {report.sections.map((section) => (
                    <li
                      key={section.name}
                      className={
                        section.supported
                          ? "rounded-md border border-border p-3"
                          : "rounded-md border border-destructive/40 p-3"
                      }
                    >
                      <p className="break-words font-medium">
                        {section.name}
                        {!section.supported && (
                          <span className="ml-2 text-xs font-normal text-destructive">
                            Unsupported section
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {section.kind === "collection"
                          ? `${section.count ?? 0} record${(section.count ?? 0) === 1 ? "" : "s"}`
                          : `Single ${section.kind}`}
                      </p>
                      {section.fields.length > 0 && (
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          Fields: {section.fields.join(", ")}
                        </p>
                      )}
                      {section.ids.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          IDs:{" "}
                          {section.ids.map((id) => (
                            <code key={id} className="mr-2 break-all">
                              {id}
                            </code>
                          ))}
                        </p>
                      )}
                    </li>
                  ))}
                  {!report.sections.length && (
                    <li className="text-sm text-muted-foreground">
                      No sections found.
                    </li>
                  )}
                </ul>
              </details>

              <details>
                <summary className={summaryClass}>
                  Mirrored profiles ({report.mirrors.length})
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">
                  Only the selected representation is used for migration;
                  mirrored records are never combined.
                </p>
                <ul className="mt-3 grid gap-3">
                  {report.mirrors.map((mirror) => (
                    <li
                      key={mirror.profile_id}
                      className="rounded-md border border-border p-3"
                    >
                      <p className="break-all font-medium">
                        Profile {mirror.profile_id}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {mirror.compared_sections} section
                        {mirror.compared_sections === 1 ? "" : "s"} compared.
                      </p>
                      {mirror.divergent_sections.length > 0 ? (
                        <p className="mt-1 break-words text-xs font-medium text-destructive">
                          Divergent: {mirror.divergent_sections.join(", ")}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          No divergent sections.
                        </p>
                      )}
                    </li>
                  ))}
                  {!report.mirrors.length && (
                    <li className="text-sm text-muted-foreground">
                      No mirrored profiles found.
                    </li>
                  )}
                </ul>
                {report.mirrors.length > 0 && divergentMirrors.length === 0 && (
                  <p className="mt-3 text-sm">
                    All mirrors match the selected representation.
                  </p>
                )}
              </details>

              <details>
                <summary className={summaryClass}>
                  Relationships ({report.relationships.length},{" "}
                  {unresolved.length} unresolved)
                </summary>
                <ul className="mt-3 grid gap-3">
                  {report.relationships.map((relation, index) => (
                    <li
                      key={`${relation.path}-${relation.target_id}-${index}`}
                      className="rounded-md border border-border p-3"
                    >
                      <p className="break-all text-sm">{relation.path}</p>
                      <p
                        className={
                          relation.resolved
                            ? "mt-1 break-all text-xs text-muted-foreground"
                            : "mt-1 break-all text-xs font-medium text-destructive"
                        }
                      >
                        {relation.target_collection} {relation.target_id} —{" "}
                        {relation.resolved ? "resolved" : "unresolved"}
                      </p>
                    </li>
                  ))}
                  {!report.relationships.length && (
                    <li className="text-sm text-muted-foreground">
                      No references found.
                    </li>
                  )}
                </ul>
              </details>

              <details>
                <summary className={summaryClass}>
                  Dates ({report.dates.length})
                </summary>
                <ul className="mt-3 grid gap-3">
                  {report.dates.map((date, index) => (
                    <li
                      key={`${date.path}-${index}`}
                      className="rounded-md border border-border p-3"
                    >
                      <p className="break-all text-sm">{date.path}</p>
                      <p
                        className={
                          date.status === "invalid" || date.status === "ambiguous"
                            ? "mt-1 break-all text-xs font-medium text-destructive"
                            : "mt-1 break-all text-xs text-muted-foreground"
                        }
                      >
                        {String(date.value)} — {dateStatusLabels[date.status]}
                      </p>
                    </li>
                  ))}
                  {!report.dates.length && (
                    <li className="text-sm text-muted-foreground">
                      No dates found.
                    </li>
                  )}
                </ul>
              </details>
            </>
          )}

          <div className="mt-auto flex justify-end pt-4">
            <Button
              type="button"
              variant="outline"
              className={control}
              disabled={inspection.busy || inspection.previewBusy}
              onClick={() => close(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
