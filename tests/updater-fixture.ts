import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { configSchema, type UpdaterConfig } from "../updater/config";
import type { ReleaseManifest } from "../src/features/updates/protocol";

export const OLD_DIGEST = `sha256:${"a".repeat(64)}`;
export const NEW_DIGEST = `sha256:${"b".repeat(64)}`;
export const OLD_REF = `ghcr.io/jccd-dev/chibako@${OLD_DIGEST}`;
export const NEW_REF = `ghcr.io/jccd-dev/chibako@${NEW_DIGEST}`;

export const manifest: ReleaseManifest = {
  schema: 1, version: "0.1.2", commit: "c".repeat(40), image: "ghcr.io/jccd-dev/chibako", digest: NEW_DIGEST,
  updater: { image: "ghcr.io/jccd-dev/chibako-updater", digest: `sha256:${"d".repeat(64)}` },
  minUpdaterProtocol: 1, publishedAt: "2026-10-21T00:00:00Z", notes: "Test release",
  url: "https://github.com/jccd-dev/chibako/releases/tag/v0.1.2",
};

/** A disposable deployment: real SQLite vault, real files, fake docker CLI on PATH. */
export function makeFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chibako-updater-")));
  const dirs = { data: join(root, "data"), backups: join(root, "backups"), control: join(root, "control"), fake: join(root, "fake"), bin: join(root, "bin") };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const pinFile = join(root, "pin.env");
  writeFileSync(pinFile, `KEEP_ME=1\nCHIBAKO_IMAGE=${OLD_REF}\n`, { mode: 0o600 });
  writeFileSync(join(root, "compose.yml"), "services: {}\n");
  copyFileSync(join(process.cwd(), "tests/fixtures/fake-docker.sh"), join(dirs.bin, "docker"));
  chmodSync(join(dirs.bin, "docker"), 0o755);
  if (spawnSync("sh", ["-c", "command -v flock"]).status !== 0) {
    // Hosts without flock(1) (macOS): same contract via a lock directory.
    writeFileSync(join(dirs.bin, "flock"), '#!/bin/sh\nshift 3; f="$1.d"; shift\nmkdir "$f" 2>/dev/null || exit 75\ntrap \'rmdir "$f"\' EXIT\n"$@"\n', { mode: 0o755 });
  }
  writeFileSync(join(dirs.fake, "versions"), `${OLD_REF} 0.1.1\n${NEW_REF} 0.1.2\n`);
  writeFileSync(join(dirs.fake, "running"), OLD_REF);
  writeFileSync(join(dirs.fake, "exists"), "");

  const dbFile = join(dirs.data, "brain.db");
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes(id INTEGER, title TEXT); INSERT INTO notes VALUES(1,'before-update'); PRAGMA user_version=1");
  db.exec("INSERT INTO notes VALUES(2,'only-in-wal')"); // left open: this row lives in the WAL until the snapshot reads it

  const config: UpdaterConfig = configSchema.parse({
    projectName: "chibako", projectDir: root, composeFiles: [join(root, "compose.yml")], envFiles: [pinFile],
    service: "chibako", pinFile, pinVar: "CHIBAKO_IMAGE", dataDir: dirs.data, backupDir: dirs.backups,
    controlDir: dirs.control, lockFile: join(root, "lock"), healthTimeoutSeconds: 10,
  });
  const env = { ...process.env, PATH: `${dirs.bin}:${process.env.PATH}`, FAKE: dirs.fake, FAKE_DB: dbFile, FAKE_PIN_FILE: pinFile };
  const previous = { PATH: process.env.PATH };
  Object.assign(process.env, { PATH: env.PATH, FAKE: dirs.fake, FAKE_DB: dbFile, FAKE_PIN_FILE: pinFile });
  const configFile = join(root, "updater.json");
  writeFileSync(configFile, JSON.stringify(config));

  return {
    root, dirs, config, configFile, env, pinFile, dbFile,
    pin: () => /^CHIBAKO_IMAGE=(.*)$/m.exec(readFileSync(pinFile, "utf8"))![1],
    calls: () => (existsSync(join(dirs.fake, "log")) ? readFileSync(join(dirs.fake, "log"), "utf8").split("\n").filter(Boolean) : []),
    knob: (name: string, value: string) => writeFileSync(join(dirs.fake, name), value),
    notes: (file = dbFile) => {
      const reader = new DatabaseSync(file, { readOnly: true });
      try { return (reader.prepare("SELECT title FROM notes ORDER BY id").all() as Array<{ title: string }>).map((row) => row.title); } finally { reader.close(); }
    },
    marker: () => existsSync(join(dirs.data, ".chibako-maintenance")),
    cleanup: () => {
      try { db.close(); } catch { /* already closed */ }
      process.env.PATH = previous.PATH;
      for (const key of ["FAKE", "FAKE_DB", "FAKE_PIN_FILE"]) delete process.env[key];
      rmSync(root, { recursive: true, force: true });
    },
  };
}
