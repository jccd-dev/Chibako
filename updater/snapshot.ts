import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertPlainVaultFile, copyFileDurable, fsyncDir, writeFileAtomic } from "./files";

export interface SnapshotMeta { sha256: string; bytes: number; userVersion: number }

const VAULT_FILES = ["brain.db", "brain.db-wal", "brain.db-shm"];

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function inspect(file: string): { ok: boolean; userVersion: number } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const check = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
    const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
    return { ok: check.length === 1 && check[0].integrity_check === "ok", userVersion: version.user_version };
  } finally {
    db.close();
  }
}

/** Bytes needed to snapshot safely: the database and its WAL, with headroom. */
export function requiredBytes(dataDir: string): number {
  const size = VAULT_FILES.reduce((sum, name) => {
    try { return sum + fs.statSync(path.join(dataDir, name)).size; } catch { return sum; }
  }, 0);
  return size * 2 + 64 * 1024 * 1024;
}

export function assertSpace(dataDir: string, backupDir: string): void {
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stats = fs.statfsSync(backupDir);
  if (stats.bavail * stats.bsize < requiredBytes(dataDir)) throw new Error("Not enough free disk space for a backup before updating.");
}

/**
 * Consistent copy of the live vault including uncheckpointed WAL content
 * (VACUUM INTO reads one snapshot). Verified before it is trusted; an existing
 * verified snapshot is reused so a resumed operation never re-snapshots a
 * database that has since been touched by the new image.
 */
export function createSnapshot(dataDir: string, snapshotDir: string): SnapshotMeta {
  const metaFile = path.join(snapshotDir, "meta.json");
  if (fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as SnapshotMeta;
    if (sha256(path.join(snapshotDir, "brain.db")) === meta.sha256) return meta;
    throw new Error("Existing snapshot failed verification.");
  }
  fs.mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });
  const source = path.join(dataDir, "brain.db");
  const present = VAULT_FILES.map((name) => assertPlainVaultFile(path.join(dataDir, name)));
  if (!present[0]) throw new Error("No vault database found to back up.");
  const target = path.join(snapshotDir, "brain.db");
  fs.rmSync(`${target}.partial`, { force: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${`${target}.partial`.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
  const verified = inspect(`${target}.partial`);
  if (!verified.ok) {
    fs.rmSync(`${target}.partial`, { force: true });
    throw new Error("The backup failed its integrity check; the update was not started.");
  }
  const fd = fs.openSync(`${target}.partial`, "r+");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(`${target}.partial`, target);
  const meta = { sha256: sha256(target), bytes: fs.statSync(target).size, userVersion: verified.userVersion };
  writeFileAtomic(metaFile, JSON.stringify(meta));
  fsyncDir(snapshotDir);
  return meta;
}

/** Moves the live database aside (never deletes it) so a restore cannot discard anything. */
export function quarantineVault(dataDir: string, quarantineDir: string): void {
  fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
  for (const name of VAULT_FILES) {
    const file = path.join(dataDir, name);
    if (!assertPlainVaultFile(file)) continue;
    if (!name.endsWith("-shm")) copyFileDurable(file, path.join(quarantineDir, name)); // the wal-index is rebuilt on open
    fs.rmSync(file);
  }
}

export function restoreSnapshot(dataDir: string, snapshotDir: string, meta: SnapshotMeta): void {
  const source = path.join(snapshotDir, "brain.db");
  if (!fs.existsSync(source) || sha256(source) !== meta.sha256) throw new Error("The backup is missing or failed verification.");
  for (const name of VAULT_FILES.slice(1)) fs.rmSync(path.join(dataDir, name), { force: true }); // stale WAL/SHM must not replay onto the restored file
  copyFileDurable(source, path.join(dataDir, "brain.db"), fs.statSync(dataDir)); // app-owned, like the file it replaces
  fsyncDir(dataDir);
}
