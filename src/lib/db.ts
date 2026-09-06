import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.CHIBAKO_DATA_DIR ?? process.env.DATA_DIR ?? path.join(process.cwd(), "data");

let _db: Database.Database | null = null;

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS folders (path TEXT PRIMARY KEY);`,
  `
  CREATE TABLE IF NOT EXISTS notes (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    folder     TEXT NOT NULL DEFAULT '',
    content    TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL DEFAULT 'note',   -- note | wiki | index
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes (folder);
  CREATE INDEX IF NOT EXISTS idx_notes_title  ON notes (title);
  `,
  `
  -- Materialized [[wikilinks]]: rebuilt whenever a note changes.
  CREATE TABLE IF NOT EXISTS links (
    source_id    TEXT NOT NULL,
    target_title TEXT NOT NULL,
    target_id    TEXT,
    PRIMARY KEY (source_id, target_title)
  );
  CREATE INDEX IF NOT EXISTS idx_links_target ON links (target_title);
  `,
  `
  -- Full-text search over note title + content. id is stored (unindexed) so
  -- search results map straight back to notes without relying on rowids.
  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    id UNINDEXED, title, content, folder, tokenize='unicode61'
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);
  `,
  `
  CREATE TABLE IF NOT EXISTS api_keys (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,          -- sha256 of the raw key
    scopes      TEXT NOT NULL DEFAULT 'notes:read',  -- comma separated
    created_at  INTEGER NOT NULL,
    last_used_at INTEGER
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS ingest_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id     TEXT NOT NULL,
    summary     TEXT NOT NULL,
    touched     TEXT NOT NULL DEFAULT '[]',
    contradictions TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL
  );
  `,
];

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "brain.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.exec("BEGIN");
  try {
    for (const m of MIGRATIONS) db.exec(m);
    // Additive column migrations (CREATE IF NOT EXISTS can't add columns,
    // so guard with PRAGMA — this block re-runs safely on every boot).
    const cols = db.prepare(`PRAGMA table_info(notes)`).all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("deleted_at")) db.exec(`ALTER TABLE notes ADD COLUMN deleted_at INTEGER`);
    if (!names.has("is_pinned")) db.exec(`ALTER TABLE notes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0`);
    // Preserve existing folders, including ancestors and folders of trashed notes.
    const folders = db.prepare("SELECT DISTINCT folder FROM notes").all() as Array<{ folder: string }>;
    const insertFolder = db.prepare("INSERT OR IGNORE INTO folders (path) VALUES (?)");
    for (const { folder } of folders) {
      const parts = folder.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) insertFolder.run(parts.slice(0, i).join("/"));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  _db = db;
  return db;
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function uid(): string {
  return crypto.randomUUID();
}