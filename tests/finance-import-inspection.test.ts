import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { getDb } from "../src/lib/db";
import { inspectTarsiBackup } from "../src/features/finance/import-inspection";
import { createNote, getNote } from "../src/lib/notes";
import { createAccount } from "../src/features/finance/accounts";

const vault = mkdtempSync(join(tmpdir(), "chibako-finance-inspection-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

test("backup inspection denies agent and trusted-local actors before parsing source", () => {
  assert.throws(() => inspectTarsiBackup({ kind: "trusted-local" }, null), { status: 403, code: "owner_required" });
  assert.throws(() => inspectTarsiBackup({ kind: "api-key", id: "agent", scopes: ["finance:read", "finance:write", "finance:manage", "*"] }, null), { status: 403, code: "owner_required" });
});

function source() {
  const collections = {
    accounts: [{ id: "test-cash", name: "Synthetic cash", currency: "PHP", balance: 125.5, type: "debit" }],
    expenses: [{ id: "test-expense", accountId: "test-cash", amount: 2.5, date: "2020-02-29", note: "Synthetic text" }],
    incomes: [], transfers: [], balanceAdjustments: [],
  };
  return { app: "Tarsi", exportedAt: "2026-01-01T00:00:00Z", data: { ...collections, activeProfileId: "test-profile", profiles: { "test-profile": structuredClone(collections) } } };
}

test("owner inspection selects one mirrored source and preserves Notes with zero Vault writes", () => {
  const note = createNote({ title: "TEST inspection existing Note", content: "Existing [[Knowledge]]" });
  const before = getDb().serialize();
  const backup = source();
  const report = inspectTarsiBackup({ kind: "owner" }, backup);
  assert.equal(report.stage, "source-inspection");
  assert.equal(report.eligible, true);
  assert.equal(report.representation, "top-level");
  assert.equal(report.sections.find(section => section.name === "expenses")?.count, 1);
  assert.deepEqual(report.mirrors, [{ profile_id: "test-profile", compared_sections: 5, divergent_sections: [] }]);
  assert.ok(report.dates.some(date => date.value === "2020-02-29" && date.status === "calendar-day"));
  assert.deepEqual(report.currencies, ["PHP"]);
  assert.ok(report.relationships.some(reference => reference.target_id === "test-cash" && reference.resolved));
  assert.deepEqual(getDb().serialize(), before);
  assert.deepEqual(getNote(note.id), note);
  assert.deepEqual(backup, source());
});

test("source inspection reports divergent mirrors, unsupported data, currencies, dates, and missing-account exceptions", () => {
  const backup = source();
  const data = {
    ...backup.data,
    accounts: [...backup.data.accounts, { id: "foreign", name: "Synthetic foreign", currency: "USD", balance: 1, type: "debit" }],
    expenses: [
      ...backup.data.expenses,
      { id: "bad-day", accountId: "missing", amount: 1, date: "2023-02-29", note: "" },
      { id: "ambiguous-day", accountId: "test-cash", amount: 1, date: "2020-03-01T23:30:00-05:00", note: "" },
    ],
    balanceAdjustments: [{ id: "orphan", accountId: "missing", currency: "PHP", date: "2020-03-01", previousBalance: 1, nextBalance: 2 }],
    unsupportedCollection: [{ id: "private-synthetic", secretText: "DO NOT RETURN RAW ROW TEXT" }],
  };
  const before = getDb().serialize();
  const report = inspectTarsiBackup({ kind: "owner" }, { ...backup, data });
  for (const code of ["mirrored_divergence", "unsupported_section", "unsupported_currency", "invalid_date", "ambiguous_date", "unresolved_reference", "missing_account_adjustment"]) {
    assert.ok(report.issues.some(issue => issue.code === code), code);
  }
  assert.equal(report.can_proceed, false);
  assert.equal(report.sections.find(section => section.name === "expenses")?.count, 3);
  assert.equal(report.relationships.find(reference => reference.path === "balanceAdjustments[0].accountId")?.resolved, false);
  assert.ok(report.issues.some(issue => issue.code === "missing_account_adjustment" && issue.severity === "exception"));
  assert.equal(JSON.stringify(report).includes("DO NOT RETURN RAW ROW TEXT"), false);
  assert.deepEqual(getDb().serialize(), before);
});

test("invalid envelopes, duplicate identities, missing currencies and dates cannot silently pass inspection", () => {
  for (const input of [null, [], {}, { app: "Other", data: {} }, { app: "Tarsi", data: {} }]) {
    assert.throws(() => inspectTarsiBackup({ kind: "owner" }, input), { status: 400, code: "invalid_input" });
  }
  const backup = source();
  const report = inspectTarsiBackup({ kind: "owner" }, { ...backup, data: {
    accounts: [{ id: "duplicate" }, { id: "duplicate" }],
    expenses: [{ id: "no-day", accountId: "duplicate", amount: 1, createdAt: "2020-01-01T00:00:00Z" }],
  } });
  for (const code of ["duplicate_id", "missing_currency", "missing_date"]) assert.ok(report.issues.some(issue => issue.code === code), code);
  assert.equal(report.can_proceed, false);
});

test("active-profile inspection reports top-level sections that would otherwise be left out", () => {
  const backup = source();
  const report = inspectTarsiBackup({ kind: "owner" }, { app: "Tarsi", data: {
    activeProfileId: "test-profile", profiles: { "test-profile": { accounts: backup.data.accounts } },
    expenses: backup.data.expenses,
  } });
  assert.equal(report.representation, "profile");
  assert.ok(report.mirrors[0].divergent_sections.includes("expenses"));
  assert.ok(report.issues.some(issue => issue.code === "unselected_top_level_section" && issue.path === "data.expenses"));
  assert.equal(report.can_proceed, false);
});

test("profile-only backups use only the explicit active profile and finance data blocks initial eligibility", () => {
  const backup = source();
  const profileOnly = { ...backup, data: { profiles: backup.data.profiles, activeProfileId: "test-profile" } };
  assert.equal(inspectTarsiBackup({ kind: "owner" }, profileOnly).representation, "profile");
  createAccount({ kind: "owner" }, { request_id: "test-inspection-account", name: "TEST existing finance", kind: "money", currency: "PHP", opening_balance: "0" });
  const before = getDb().serialize();
  const report = inspectTarsiBackup({ kind: "owner" }, profileOnly);
  assert.equal(report.eligible, false);
  assert.equal(report.can_proceed, false);
  assert.ok(report.issues.some(issue => issue.code === "finance_not_empty"));
  assert.deepEqual(getDb().serialize(), before);
});
