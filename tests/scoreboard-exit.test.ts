import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = join(import.meta.dirname, "..");

test("a fixture Scoreboard run exits right after cleanup, so a late Provider answer cannot touch the deleted Vault", async () => {
  const work = mkdtempSync(join(tmpdir(), "chibako-scoreboard-exit-"));
  const pathFile = join(work, "vault-path");
  try {
    const { stdout } = await run(process.execPath, [
      "--import", "tsx", "--import", join(root, "tests/fixtures/late-provider-answer.mjs"),
      join(root, "scripts/scoreboard.ts"), "--fixture", "--out", join(work, "results"),
    ], { cwd: root, env: { ...process.env, VAULT_PATH_FILE: pathFile }, timeout: 20_000 });
    assert.match(stdout, /Saved /, "the report is fully written before the process exits");
    const vault = readFileSync(pathFile, "utf8");
    assert.match(vault, /chibako-scoreboard-fixture-/);
    assert.equal(existsSync(vault), false, "nothing recreated the deleted Vault copy while the process lingered");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
