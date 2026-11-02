import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createAccount, getAccount } from "../../src/features/finance/accounts";
import { startAutomaticPlans } from "../../src/features/finance/automatic-plans";
import { createSchedule } from "../../src/features/finance/recurrence";
import { getDb, maintenanceMarkerPath } from "../../src/lib/db";

const vault = mkdtempSync(join(tmpdir(), "chibako-automatic-runner-"));
process.env.CHIBAKO_DATA_DIR = vault;
after(() => { getDb().close(); rmSync(vault, { recursive: true, force: true }); });

function stopRunner() {
  const runner = globalThis as typeof globalThis & { financeAutomaticPlansTimer?: ReturnType<typeof setInterval> };
  clearInterval(runner.financeAutomaticPlansTimer);
  delete runner.financeAutomaticPlansTimer;
}

test("runner silently skips maintenance and posts the due schedule on the next tick", (t) => {
  const owner = { kind: "owner" } as const;
  const account = createAccount(owner, { request_id: randomUUID(), name: "TEST runner", kind: "money", currency: "PHP", opening_balance: "100" }).account;
  createSchedule(owner, { request_id: randomUUID(), account_id: account.id, amount: "10", handling: "automatic",
    interval_count: 1, interval_unit: "day", start_date: "2020-01-01", max_occurrences: 1 });
  t.mock.timers.enable({ apis: ["setInterval"] });
  const log = t.mock.method(console, "error", () => {});
  t.after(stopRunner);
  writeFileSync(maintenanceMarkerPath(), "TEST maintenance");
  t.after(() => rmSync(maintenanceMarkerPath(), { force: true }));
  startAutomaticPlans();
  assert.equal(log.mock.callCount(), 0);
  rmSync(maintenanceMarkerPath());
  assert.equal(getAccount(owner, account.id).balance_cents, 10000);
  t.mock.timers.tick(60_000);
  assert.equal(getAccount(owner, account.id).balance_cents, 9000);
  assert.equal(log.mock.callCount(), 0);
});

test("runner logs the cause once per failure streak and resumes logging after recovery", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const log = t.mock.method(console, "error", () => {});
  const db = getDb();
  const failure = () => { throw new Error("TEST database unavailable"); };
  const prepare = t.mock.method(db, "prepare", failure);
  t.after(stopRunner);
  startAutomaticPlans();
  assert.deepEqual(log.mock.calls[0].arguments, ["Automatic finance processing failed: TEST database unavailable"]);
  t.mock.timers.tick(60_000);
  assert.equal(log.mock.callCount(), 1);
  writeFileSync(maintenanceMarkerPath(), "TEST maintenance");
  t.after(() => rmSync(maintenanceMarkerPath(), { force: true }));
  t.mock.timers.tick(60_000);
  rmSync(maintenanceMarkerPath());
  t.mock.timers.tick(60_000);
  assert.equal(log.mock.callCount(), 1, "maintenance does not reset a genuine failure streak");
  prepare.mock.restore();
  t.mock.timers.tick(60_000);
  t.mock.method(db, "prepare", failure);
  t.mock.timers.tick(60_000);
  assert.equal(log.mock.callCount(), 2);
});
