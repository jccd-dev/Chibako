import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FinanceImportCommit } from "../src/features/finance/components/FinanceImportCommit";
import type { TarsiCommitGate } from "../src/features/finance/import-commit-gate";
import type { TarsiImportSummary } from "../src/features/finance/import-commit-flow";

const backup = {
  id: "7b1f1a4e-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
  sha256: "e".repeat(64),
  size_bytes: 2048,
  created_at: 1,
  verified: true as const,
};

function gate(overrides: Partial<TarsiCommitGate> = {}): TarsiCommitGate {
  return {
    canConfirm: true,
    ready: false,
    checks: [
      { key: "blockers", label: "Blockers settled", met: true },
      { key: "exclusions", label: "Every exclusion acknowledged", met: true },
      { key: "current", label: "Preview reflects your latest choices", met: true },
      { key: "backup", label: "Recoverable backup verified", met: false },
      { key: "confirmation", label: "Reviewed proposal confirmed", met: false },
    ],
    ...overrides,
  };
}

const summary: TarsiImportSummary = {
  counts: { imported: 2, skipped: 1, excluded: 1 },
  balances: [{ account_id: "cash", name: "TEST cash", source_cents: 10000, effects_cents: -500, opening_cents: 10500, reconciled_cents: 10000, opening_inferred: true, historical_balances_verified: false }],
  pausedSchedules: [{ path: "recurringExpenses:monthly", collection: "recurringExpenses", label: "TEST rent" }],
  startingProgress: [{ path: "goals:goal", collection: "goals", label: "TEST goal", cents: 1500, kind: "saved" }],
  skipped: [{ path: "accountGroups[0]", collection: "accountGroups", label: "TEST group", reason: "No finance capability." }],
  relationships: [{
    path: "accounts[0].linkedGoalId",
    field: "linkedGoalId",
    referenceCollection: "goals",
    referenceSourceId: "linked",
    referenceTargetId: null,
    reason: "The source reference is retained in source_json only.",
  }],
  exclusions: [{ path: "legacyRows[0]", reason: "Explicit owner exclusion from this proposal.", acknowledged: true }],
};

function render(props: Partial<Parameters<typeof FinanceImportCommit>[0]> = {}): string {
  return renderToStaticMarkup(
    <FinanceImportCommit
      gate={gate()}
      confirmed={false}
      backup={null}
      backupBusy={false}
      backupError=""
      commitBusy={false}
      commitError=""
      committed={false}
      result={null}
      locked={false}
      onCreateBackup={() => {}}
      onToggleConfirmed={() => {}}
      onCommit={() => {}}
      {...props}
    />,
  );
}

test("before a verified backup exists, commit is disabled and no download link is shown", () => {
  const html = render();
  assert.match(html, /Create verified backup/);
  assert.doesNotMatch(html, /Download backup/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Commit import<\/button>/);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*disabled=""/);
});

test("with a verified backup and a confirmed review, the download link and an enabled commit appear", () => {
  const html = render({
    gate: { ...gate(), ready: true },
    confirmed: true,
    backup,
  });
  assert.match(html, /href="\/api\/finance\/import\/backup\/7b1f1a4e-2c3d-4e5f-8a9b-0c1d2e3f4a5b"[^>]*download/);
  assert.match(html, /Verified backup created/);
  assert.doesNotMatch(html, /<button[^>]* disabled=""[^>]*>Commit import<\/button>/);
  assert.match(html, /<button [^>]*>Commit import<\/button>/);
});

test("a locked panel disables backup creation, the confirmation, and commit while a commit is active", () => {
  const html = render({
    gate: { ...gate(), ready: true },
    confirmed: true,
    backup,
    commitBusy: true,
    locked: true,
  });
  assert.match(html, /Committing import/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Committing import…<\/button>/);
  assert.match(html, /role="status"[^>]*>Committing/);
});

test("a committed result shows private reconciliation, paused schedules, progress, skips, and exclusions", () => {
  const html = render({ committed: true, result: summary });
  assert.match(html, /Import committed/);
  assert.match(html, /aria-label="Import result"/);
  assert.match(html, /TEST cash/);
  assert.match(html, /TEST rent/);
  assert.match(html, /Imported recurring definitions stay paused/);
  assert.match(html, /TEST goal/);
  assert.match(html, /Saved toward the goal/);
  assert.match(html, /linkedGoalId/);
  assert.match(html, /accounts\[0\]\.linkedGoalId/);
  assert.match(html, /The source reference is retained in source_json only\./);
  assert.match(html, /No finance capability\./);
  assert.match(html, /Excluded:<\/span> legacyRows\[0\]\./);
  assert.match(html, /Explicit owner exclusion from this proposal\./);
  assert.match(html, /private owner-only location/);
  assert.doesNotMatch(html, /Commit import/);
});

test("the offline recovery warning is shown and no in-app restore control is offered", () => {
  const html = render({ gate: { ...gate(), ready: true }, confirmed: true, backup });
  assert.match(html, /Restoring this backup is not an in-app action/);
  assert.match(html, /changes must be accounted for during any offline recovery/);
  assert.doesNotMatch(html, />Restore/);
});

test("a commit error is surfaced as an actionable alert rather than swallowed", () => {
  const html = render({ gate: { ...gate(), ready: true }, confirmed: true, backup, commitError: "The reviewed proposal changed; review the current preview again" });
  assert.match(html, /The reviewed proposal changed; review the current preview again/);
});
