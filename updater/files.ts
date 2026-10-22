import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CREATE_EXCLUSIVE = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;

/** Unpredictable sibling name: a directory the app can write to must not let it pre-plant a link we would follow as root. */
const stagingPath = (file: string) => `${file}.tmp-${randomBytes(8).toString("hex")}`;

/** Crash-safe replace: write an exclusive sibling temp file, fsync, rename, fsync the directory. */
export function writeFileAtomic(file: string, content: string, mode = 0o600): void {
  const temp = stagingPath(file);
  const fd = fs.openSync(temp, CREATE_EXCLUSIVE, mode);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  fsyncDir(path.dirname(file));
}

export function fsyncDir(dir: string): void {
  const fd = fs.openSync(dir, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/**
 * Copies into an exclusive unpredictable temp file, then renames over `to`, so no existing
 * file or link at the destination is ever written through. `owner` gives the result the
 * app's ownership (the vault directory's) and private permissions.
 */
export function copyFileDurable(from: string, to: string, owner?: fs.Stats): void {
  const temp = stagingPath(to);
  fs.copyFileSync(from, temp, fs.constants.COPYFILE_EXCL);
  try {
    const fd = fs.openSync(temp, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error(`${temp} was replaced while copying`);
      if (owner) { fs.fchownSync(fd, owner.uid, owner.gid); fs.fchmodSync(fd, 0o600); }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, to);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

/** The vault directory is writable by the app, so a vault file that is a link or hard-linked is never touched. False when absent. */
export function assertPlainVaultFile(file: string): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(`${path.basename(file)} in the vault is a link or special file; refusing to touch it.`);
  return true;
}

/** Throws unless the path is a regular file that is not a symlink. */
export function assertRegularFile(file: string): void {
  if (!fs.lstatSync(file).isFile()) throw new Error(`${file} must be a regular file, not a link`);
}

export function readBounded(file: string, maxBytes: number): string | null {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}
