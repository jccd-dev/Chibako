import { getDb } from "../../lib/db";
import { NoteInputError } from "../../lib/note-errors";

export function normalizeFolder(path: string): string {
  const normalized = path.trim().replace(/^\/+|\/+$/g, "");
  if (
    normalized.length > 512 ||
    /[\\\x00-\x1f]/.test(normalized) ||
    (normalized && normalized.split("/").some((part) => !part.trim() || part === "." || part === ".."))
  ) {
    throw new NoteInputError("Invalid folder path.");
  }
  return normalized;
}

/** Ensure a folder and every ancestor are represented in the folder index. */
export function ensureFolder(path: string): void {
  const insert = getDb().prepare("INSERT OR IGNORE INTO folders (path) VALUES (?)");
  const parts = path.split("/").filter(Boolean);
  for (let i = 1; i <= parts.length; i += 1) insert.run(parts.slice(0, i).join("/"));
}

export function folderTree(): string[] {
  return (getDb().prepare("SELECT path FROM folders ORDER BY path").all() as Array<{ path: string }>).map((row) => row.path);
}

export function createFolder(path: string): string {
  path = normalizeFolder(path);
  if (!path) throw new NoteInputError("Enter a folder name.");
  return getDb().transaction(() => {
    if (folderTree().includes(path)) throw new NoteInputError("Folder already exists.", 409);
    ensureFolder(path);
    return path;
  })();
}
