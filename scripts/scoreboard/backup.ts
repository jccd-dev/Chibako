import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

/** Copies a Vault's database with SQLite's online backup (WAL-safe) into a new OS-temp directory. */
export async function backupVaultToTemp(sourceDir: string): Promise<{ dir: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "chibako-scoreboard-copy-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  let source: Database.Database | undefined;
  try {
    // Opened inside the try: a missing brain.db throws here, and the new directory must still be removed.
    source = new Database(join(sourceDir, "brain.db"), { readonly: true, fileMustExist: true });
    await source.backup(join(dir, "brain.db"));
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    source?.close();
  }
  return { dir, cleanup };
}
