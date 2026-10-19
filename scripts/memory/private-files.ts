import { MemoryClientError } from "./client-error";
import { mkdir, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
export async function withPrivateLock<T>(file: string, operation: () => Promise<T>): Promise<T> {
  let handle;
  try { handle = await open(file, "wx", 0o600); }
  catch { throw new MemoryClientError("Memory profile is busy or locked. Retry after its operation finishes; inspect stale locks only after the process stops."); }
  try { return await operation(); }
  finally { await handle.close(); await unlink(file); }
}
