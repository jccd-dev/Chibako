import { MemoryClientError } from "./client-error";
import { mkdir, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export async function privateDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory)) throw new MemoryClientError("Private data path must be absolute.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new MemoryClientError("Private data directory must be owned by this user with mode 0700.");
}
export async function readOptional(file: string): Promise<string | null> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.()) throw new MemoryClientError("Refusing a non-owned file or symlink.");
    if (info.size > 2_000_000) throw new MemoryClientError("Configuration or state exceeds size limit.");
    return await readFile(file, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
export async function atomicPrivateWrite(file: string, value: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
    await handle.close();
    await rename(temporary, file);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
const busy = "Memory profile is busy or locked. Retry after its operation finishes; inspect stale locks only after the process stops.";
const lockWaitMs = 2_000;
// Longer than every hook timeout, so a lock this old is stale even if its PID was reused.
const staleLockMs = 120_000;

async function isStaleLock(file: string): Promise<boolean> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.uid !== process.getuid?.()) return false;
    const age = Date.now() - info.mtimeMs;
    if (age > staleLockMs) return true;
    const pid = Number(await readFile(file, "utf8"));
    // An empty lock may belong to a holder that has not written its PID yet.
    if (!Number.isInteger(pid) || pid <= 0) return age > lockWaitMs;
    try { process.kill(pid, 0); return false; }
    catch (error) { return error instanceof Error && "code" in error && error.code === "ESRCH"; }
  } catch { return false; }
}
// Hook timeouts kill holders before `finally` runs, so a dead holder's lock is reclaimed instead of blocking every later event.
// shortcut: two waiters reclaiming the same stale lock can race in a narrow window; switch to an OS file lock if that is observed.
export async function acquirePrivateLock(file: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + lockWaitMs;
  for (;;) {
    try {
      const handle = await open(file, "wx", 0o600);
      try { await handle.writeFile(String(process.pid)); }
      catch (error) { await handle.close().catch(() => {}); await unlink(file).catch(() => {}); throw error; }
      return async () => { await handle.close(); await unlink(file); };
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    }
    if (await isStaleLock(file)) { await unlink(file).catch(() => {}); continue; }
    if (Date.now() >= deadline) throw new MemoryClientError(busy);
    await delay(50);
  }
}
export async function withPrivateLock<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const release = await acquirePrivateLock(file);
  try { return await operation(); }
  finally { await release(); }
}
