import type { TarsiImportResult } from "./import-commit";
import type { TarsiPreview, TarsiProposalRecord } from "./import-preview-types";

export interface TarsiCommitReview {
  backupId: string;
  proposalHash: string;
  exclusions: string[];
  acknowledged: string[];
  acknowledgedConflicts: string[];
}

export interface TarsiCommitRequest {
  fingerprint: string;
  requestId: string;
}

export interface TarsiImportItem {
  path: string;
  collection: string;
  label: string;
}

export interface TarsiImportSummary {
  counts: TarsiImportResult["counts"];
  balances: TarsiImportResult["balances"];
  pausedSchedules: TarsiImportItem[];
  startingProgress: (TarsiImportItem & { cents: number; kind: string })[];
  skipped: (TarsiImportItem & { reason: string })[];
  conflicts: (TarsiImportItem & { reason: string; previousSource: Record<string, unknown>; currentSource: Record<string, unknown> })[];
  relationships: {
    path: string;
    field: string;
    referenceCollection: string;
    referenceSourceId: string;
    referenceTargetId: string | null;
    reason: string;
  }[];
  exclusions: { path: string; reason: string; acknowledged: boolean }[];
}

export function tarsiBackupHref(id: string): string {
  return `/api/finance/import/backup/${encodeURIComponent(id)}`;
}

export function commitFingerprint(review: TarsiCommitReview): string {
  return JSON.stringify([
    review.backupId,
    review.proposalHash,
    [...review.exclusions].sort(),
    [...review.acknowledged].sort(),
    [...review.acknowledgedConflicts].sort(),
  ]);
}

export function commitRequestFor(
  current: TarsiCommitRequest | null,
  fingerprint: string,
  createId: () => string,
): TarsiCommitRequest {
  if (current?.fingerprint === fingerprint) return current;
  return { fingerprint, requestId: createId() };
}

export function buildTarsiCommitPayload(review: TarsiCommitReview, requestId: string, source: unknown) {
  return {
    request_id: requestId,
    backup_id: review.backupId,
    proposal_hash: review.proposalHash,
    backup: source,
    exclusions: review.exclusions,
    acknowledged_exclusions: review.acknowledged,
    acknowledged_conflicts: review.acknowledgedConflicts,
    final_confirmation: true as const,
  };
}

function recordLabel(record: TarsiProposalRecord | undefined, fallback: string): string {
  for (const key of ["name", "text"]) {
    const value = record?.target[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export function summarizeTarsiImportResult(result: TarsiImportResult, preview: TarsiPreview): TarsiImportSummary {
  const previewBySource = new Map(preview.records.map(record => [`${record.collection}:${record.source_id}`, record]));
  const labelFor = (collection: string, sourceId: string) => recordLabel(
    previewBySource.get(`${collection}:${sourceId}`),
    `${collection} ${sourceId || "(no source ID)"}`,
  );

  return {
    counts: result.counts,
    balances: result.balances,
    pausedSchedules: result.schedules.map(row => ({
      path: `${row.source_collection}:${row.source_id}`,
      collection: row.source_collection,
      label: labelFor(row.source_collection, row.source_id),
    })),
    startingProgress: result.progress.map(row => ({
      path: `${row.source_collection}:${row.source_id}`,
      collection: row.source_collection,
      label: labelFor(row.source_collection, row.source_id),
      cents: row.starting_progress_cents,
      kind: row.kind,
    })),
    skipped: result.records
      .filter(row => row.status === "skipped")
      .map(row => ({
        path: row.path,
        collection: row.collection,
        label: labelFor(row.collection, row.source_id),
        reason: row.reason ?? "No reason recorded.",
      })),
    conflicts: preview.records
      .filter(row => row.status === "conflict" && row.previous_source)
      .map(row => ({
        path: row.path,
        collection: row.collection,
        label: labelFor(row.collection, row.source_id),
        reason: row.reason ?? "Changed source identity retained for owner review.",
        previousSource: row.previous_source!,
        currentSource: row.source,
      })),
    relationships: result.relationships.map(row => ({
      path: row.source_path,
      field: row.field,
      referenceCollection: row.reference_collection,
      referenceSourceId: row.reference_source_id,
      referenceTargetId: row.reference_target_id,
      reason: row.reason,
    })),
    exclusions: result.exclusions.map(row => ({ path: row.path, reason: row.reason, acknowledged: row.acknowledged })),
  };
}
