import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateTarsiCommitGate } from "../src/features/finance/import-commit-gate";

const approvable = {
  can_approve: true,
  exclusions: [{ path: "balanceAdjustments[0]", reason: "absent account", acknowledged: false, source: {} }],
};

function gate(overrides: Partial<Parameters<typeof evaluateTarsiCommitGate>[0]> = {}) {
  return evaluateTarsiCommitGate({
    preview: approvable,
    needsUpdate: false,
    busy: false,
    acknowledged: ["balanceAdjustments[0]"],
    backupVerified: true,
    confirmed: true,
    ...overrides,
  });
}

test("commit is ready only when blockers, exclusions, backup, and confirmation all pass", () => {
  assert.equal(gate().ready, true);
  assert.equal(gate({ preview: { can_approve: false, exclusions: [] } }).ready, false);
  assert.equal(gate({ acknowledged: [] }).ready, false);
  assert.equal(gate({ needsUpdate: true }).ready, false);
  assert.equal(gate({ backupVerified: false }).ready, false);
  assert.equal(gate({ confirmed: false }).ready, false);
  assert.equal(gate({ busy: true }).ready, false);
});

test("confirming the reviewed proposal requires settled review but not the backup or confirmation", () => {
  assert.equal(gate({ confirmed: false, backupVerified: false }).canConfirm, true);
  assert.equal(gate({ preview: null }).canConfirm, false);
  assert.equal(gate({ acknowledged: [] }).canConfirm, false);
  assert.equal(gate({ needsUpdate: true }).canConfirm, false);
  assert.equal(gate({ busy: true }).canConfirm, false);
});

test("a missing verified backup blocks readiness and the backup check reports it", () => {
  const backup = gate({ backupVerified: false });
  assert.equal(backup.ready, false);
  assert.equal(backup.checks.find(check => check.key === "backup")?.met, false);
  assert.equal(backup.canConfirm, true);
});

test("an unacknowledged exclusion is reported by its check rather than silently passing", () => {
  const exclusions = gate({ acknowledged: [] }).checks.find(check => check.key === "exclusions");
  assert.equal(exclusions?.met, false);
});
