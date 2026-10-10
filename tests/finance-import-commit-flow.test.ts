import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTarsiCommitPayload,
  commitFingerprint,
  commitRequestFor,
  summarizeTarsiImportResult,
  tarsiBackupHref,
} from "../src/features/finance/import-commit-flow";
import { FinanceClientError, financeJson } from "../src/features/finance/client-json";
import type { TarsiImportResult } from "../src/features/finance/import-commit";
import type { TarsiPreview } from "../src/features/finance/import-preview-types";
import { tarsiIdentityKey } from "../src/features/finance/import-preview-types";

const review = {
  backupId: "7b1f1a4e-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
  proposalHash: "a".repeat(64),
  exclusions: ["legacyRows", "legacyConfig"],
  acknowledged: ["legacyRows", "legacyConfig"],
  acknowledgedConflicts: [],
};

test("the commit fingerprint is stable for the same review and changes with the proposal, backup, or choices", () => {
  const same = commitFingerprint({ ...review, exclusions: [...review.exclusions].reverse(), acknowledged: [...review.acknowledged].reverse() });
  assert.equal(commitFingerprint(review), same);
  assert.notEqual(commitFingerprint(review), commitFingerprint({ ...review, proposalHash: "b".repeat(64) }));
  assert.notEqual(commitFingerprint(review), commitFingerprint({ ...review, backupId: "00000000-0000-4000-8000-000000000000" }));
  assert.notEqual(commitFingerprint(review), commitFingerprint({ ...review, exclusions: ["legacyRows"] }));
  assert.notEqual(commitFingerprint(review), commitFingerprint({ ...review, acknowledgedConflicts: [tarsiIdentityKey("expenses", "expense-1")] }));
});

test("a retry of the same review reuses its request ID, so a repeated commit cannot repeat effects", () => {
  let next = 0;
  const createId = () => `request-${++next}`;
  const first = commitRequestFor(null, commitFingerprint(review), createId);
  const retry = commitRequestFor(first, commitFingerprint(review), createId);
  assert.equal(retry.requestId, first.requestId);
  assert.equal(next, 1);
});

test("a changed proposal or backup gets a new request ID instead of replaying the old one", () => {
  let next = 0;
  const createId = () => `request-${++next}`;
  const first = commitRequestFor(null, commitFingerprint(review), createId);
  const changed = commitRequestFor(first, commitFingerprint({ ...review, proposalHash: "c".repeat(64) }), createId);
  assert.notEqual(changed.requestId, first.requestId);
});

test("the commit payload carries the exact server contract, including final confirmation", () => {
  const source = { app: "Tarsi", data: {} };
  const payload = buildTarsiCommitPayload(review, "request-1", source);
  assert.deepEqual(payload, {
    request_id: "request-1",
    backup_id: review.backupId,
    proposal_hash: review.proposalHash,
    backup: source,
    exclusions: review.exclusions,
    acknowledged_exclusions: review.acknowledged,
    acknowledged_conflicts: [],
    final_confirmation: true,
  });
});

test("backup download links keep the verified backup ID as a single path segment", () => {
  assert.equal(tarsiBackupHref(review.backupId), `/api/finance/import/backup/${review.backupId}`);
  assert.equal(tarsiBackupHref("a/b"), "/api/finance/import/backup/a%2Fb");
});

function preview(): TarsiPreview {
  return {
    stage: "reconciled-preview",
    proposal_hash: review.proposalHash,
    inspection: {} as TarsiPreview["inspection"],
    can_approve: true,
    issues: [],
    counts: [],
    records: [
      { collection: "goals", source_id: "goal", path: "goals[0]", status: "accepted", source: {}, target: { name: "TEST goal", starting_progress_cents: 1500 }, effects: [] },
      { collection: "recurringExpenses", source_id: "monthly", path: "recurringExpenses[0]", status: "accepted", source: {}, target: { text: "Rent", paused: true }, effects: [] },
    ],
    balances: [],
    exclusions: [],
    exclusion_choices: [],
    commit_notice: "",
  };
}

function result(): TarsiImportResult {
  return {
    migration_id: "migration-1",
    source_hash: "d".repeat(64),
    proposal_hash: review.proposalHash,
    counts: { imported: 2, skipped: 2, conflicts: 0, excluded: 1 },
    records: [
      { collection: "goals", source_id: "goal", path: "goals[0]", parent_source_id: null, status: "imported", reason: null },
      { collection: "recurringExpenses", source_id: "monthly", path: "recurringExpenses[0]", parent_source_id: null, status: "imported", reason: null },
      { collection: "goals.contributions", source_id: "saved", path: "goals[0].contributions[0]", parent_source_id: "goal", status: "skipped", reason: "Starting progress is preserved on the parent record; historical cash is not replayed." },
      { collection: "accountGroups", source_id: "group", path: "accountGroups[0]", parent_source_id: null, status: "skipped", reason: "This source collection has no corresponding finance capability." },
      { collection: "legacyRows", source_id: "legacy", path: "legacyRows[0]", parent_source_id: null, status: "excluded", reason: "Owner-approved exclusion." },
    ],
    balances: [],
    schedules: [{ source_collection: "recurringExpenses", source_id: "monthly", target_id: "recurringExpenses:monthly", paused: true }],
    progress: [{ source_collection: "goals", source_id: "goal", target_collection: "goals", target_id: "goals:goal", kind: "saved", starting_progress_cents: 1500 }],
    relationships: [{
      source_collection: "accounts", source_id: "cash", source_path: "accounts[0].linkedGoalId",
      source_target_id: "accounts:cash", field: "linkedGoalId", reference_collection: "goals",
      reference_source_id: "linked", reference_target_id: null, preservation: "source_metadata",
      reason: "The referenced goal has no native destination record, and finance accounts have no linked-goal field; the source reference is retained in source_json only.",
    }],
    exclusions: [{ path: "legacyRows[0]", reason: "Explicit owner exclusion from this proposal.", acknowledged: true, source: null }],
  };
}

test("the result summary reports paused schedules, preserved progress, skips, and exclusions from the server outcome", () => {
  const summary = summarizeTarsiImportResult(result(), preview());
  assert.deepEqual(summary.counts, { imported: 2, skipped: 2, conflicts: 0, excluded: 1 });
  assert.deepEqual(summary.pausedSchedules, [{ path: "recurringExpenses:monthly", collection: "recurringExpenses", label: "Rent" }]);
  assert.deepEqual(summary.startingProgress, [{ path: "goals:goal", collection: "goals", label: "TEST goal", cents: 1500, kind: "saved" }]);
  assert.deepEqual(summary.skipped.map(row => row.collection), ["goals.contributions", "accountGroups"]);
  assert.deepEqual(summary.conflicts, []);
  assert.deepEqual(summary.relationships, [{
    path: "accounts[0].linkedGoalId",
    field: "linkedGoalId",
    referenceCollection: "goals",
    referenceSourceId: "linked",
    referenceTargetId: null,
    reason: "The referenced goal has no native destination record, and finance accounts have no linked-goal field; the source reference is retained in source_json only.",
  }]);
  assert.deepEqual(summary.exclusions, [{ path: "legacyRows[0]", reason: "Explicit owner exclusion from this proposal.", acknowledged: true }]);
});

test("financeJson preserves the server error code so callers can react to backup_stale and similar failures", async () => {
  const stale = new Response(
    JSON.stringify({ error: "Verified backup no longer matches this Vault", code: "backup_stale" }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
  await assert.rejects(
    financeJson(stale),
    (thrown: unknown) => {
      assert.ok(thrown instanceof FinanceClientError);
      assert.equal(thrown.code, "backup_stale");
      assert.equal(thrown.message, "Verified backup no longer matches this Vault");
      return true;
    },
  );
  const uncoded = new Response(JSON.stringify({ error: "Could not load finance. Try again." }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
  await assert.rejects(
    financeJson(uncoded),
    (thrown: unknown) => thrown instanceof FinanceClientError && thrown.code === undefined,
  );
  const nonJson = new Response("Gateway timeout", { status: 502, headers: { "Content-Type": "text/plain" } });
  await assert.rejects(
    financeJson(nonJson),
    (thrown: unknown) => thrown instanceof FinanceClientError && thrown.message === "Could not load finance. Try again.",
  );
});

test("result labels fall back to the source identity when the proposal has no readable name", () => {
  const unnamed = { ...preview(), records: [] };
  const summary = summarizeTarsiImportResult(result(), unnamed);
  assert.equal(summary.pausedSchedules[0].label, "recurringExpenses monthly");
  assert.equal(summary.startingProgress[0].label, "goals goal");
});
