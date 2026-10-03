import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * Vault directory. Resolved on first use rather than at import so tests can
 * point CHIBAKO_DATA_DIR at a temporary vault after the module is loaded.
 */
export function dataDir(): string {
  return process.env.CHIBAKO_DATA_DIR ?? process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

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
  -- Title lookups are case-insensitive, so the BINARY index above cannot serve
  -- them. unlinkedMentions excludes already-linked notes with a NOCASE match.
  CREATE INDEX IF NOT EXISTS idx_links_target_nocase ON links (target_title COLLATE NOCASE);
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
  `
  -- Optional dense embeddings for semantic recall. Populated only when an
  -- embedding provider is configured (CHIBAKO_EMBEDDING_* env). id maps to
  -- notes.id; the vector is stored as a JSON number array (384-dim small / 1536 etc).
  CREATE TABLE IF NOT EXISTS note_embeddings (
    note_id     TEXT PRIMARY KEY,
    model       TEXT NOT NULL,
    vector      TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  `,
  `
  -- Explicit memory observations recorded by agents (narrow version of the
  -- "fill itself" hook idea: agents call memory_save to persist decisions and
  -- patterns; auto-capture hooks are post-MVP).
  CREATE TABLE IF NOT EXISTS observations (
    id          TEXT PRIMARY KEY,
    note_id     TEXT,
    content     TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'agent',
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_observations_note ON observations (note_id);
  CREATE INDEX IF NOT EXISTS idx_observations_created ON observations (created_at);
  `,
  `
  -- Obsidian-style bookmarks: notes with a custom display label, optional
  -- group and a manual sort order (group_name avoids the reserved word GROUP).
  CREATE TABLE IF NOT EXISTS bookmarks (
    id         TEXT PRIMARY KEY,
    note_id    TEXT NOT NULL,
    label      TEXT NOT NULL DEFAULT '',
    group_name TEXT NOT NULL DEFAULT '',
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bookmarks_note ON bookmarks (note_id);
  `,
  `
  CREATE TABLE IF NOT EXISTS finance_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('money', 'asset')),
    currency TEXT NOT NULL CHECK (currency = 'PHP'),
    opening_balance_cents INTEGER NOT NULL CHECK (typeof(opening_balance_cents) = 'integer' AND opening_balance_cents BETWEEN -9007199254740991 AND 9007199254740991),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_finance_accounts_list ON finance_accounts (archived, created_at, id);
  CREATE TABLE IF NOT EXISTS finance_requests (
    actor_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (actor_id, request_id)
  );
  CREATE TABLE IF NOT EXISTS finance_audit (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    affected_ids TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (actor_id, request_id) REFERENCES finance_requests (actor_id, request_id) DEFERRABLE INITIALLY DEFERRED
  );
  CREATE INDEX IF NOT EXISTS idx_finance_audit_created ON finance_audit (created_at, id);
  `,
  `
  CREATE TABLE IF NOT EXISTS finance_classifications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('category', 'tag')),
    type TEXT CHECK (type IN ('income', 'expense')),
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES finance_classifications(id),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK ((kind = 'category' AND type IS NOT NULL) OR (kind = 'tag' AND type IS NULL AND parent_id IS NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_finance_classifications_list ON finance_classifications (kind, type, parent_id, name, id);
  CREATE TABLE IF NOT EXISTS finance_transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    account_id TEXT NOT NULL REFERENCES finance_accounts(id),
    amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents BETWEEN 1 AND 9007199254740991),
    transaction_date TEXT NOT NULL,
    category_id TEXT REFERENCES finance_classifications(id),
    subcategory_id TEXT REFERENCES finance_classifications(id),
    text TEXT NOT NULL DEFAULT '',
    tag_ids TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_finance_transactions_date ON finance_transactions (transaction_date DESC, created_at DESC, id);
  CREATE INDEX IF NOT EXISTS idx_finance_transactions_account ON finance_transactions (account_id, transaction_date);
  CREATE INDEX IF NOT EXISTS idx_finance_transactions_category ON finance_transactions (category_id, transaction_date);
  `,
  `
  CREATE TABLE IF NOT EXISTS finance_movements (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('transfer', 'reconciliation', 'valuation')),
    account_id TEXT NOT NULL REFERENCES finance_accounts(id),
    destination_account_id TEXT REFERENCES finance_accounts(id),
    amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents BETWEEN -9007199254740991 AND 9007199254740991),
    transaction_date TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    tag_ids TEXT NOT NULL DEFAULT '[]',
    fee_transaction_id TEXT UNIQUE REFERENCES finance_transactions(id),
    compared_balance_cents INTEGER,
    actual_balance_cents INTEGER,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK ((type = 'transfer' AND destination_account_id IS NOT NULL AND destination_account_id != account_id AND amount_cents > 0 AND compared_balance_cents IS NULL AND actual_balance_cents IS NULL)
      OR (type != 'transfer' AND destination_account_id IS NULL AND fee_transaction_id IS NULL AND compared_balance_cents IS NOT NULL AND actual_balance_cents IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_finance_movements_date ON finance_movements (transaction_date DESC, created_at DESC, id);
  CREATE INDEX IF NOT EXISTS idx_finance_movements_account ON finance_movements (account_id, transaction_date);
  CREATE INDEX IF NOT EXISTS idx_finance_movements_destination ON finance_movements (destination_account_id, transaction_date);
  `,
];

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "brain.db"));
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
    // Materialized property cache (JSON). The raw YAML frontmatter embedded in
    // content remains the source of truth; this column exists for cheap
    // WHERE-based filtering and list payloads, and is re-synced on every write.
    if (!names.has("properties")) db.exec(`ALTER TABLE notes ADD COLUMN properties TEXT NOT NULL DEFAULT '{}'`);
    // Embedding freshness metadata (see CONTEXT.md / docs/adr/0001). Guarded the
    // same way so this block re-runs safely on every boot.
    const embCols = db.prepare(`PRAGMA table_info(note_embeddings)`).all() as Array<{ name: string }>;
    const embNames = new Set(embCols.map((c) => c.name));
    if (!embNames.has("content_hash")) db.exec(`ALTER TABLE note_embeddings ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''`);
    if (!embNames.has("dim")) db.exec(`ALTER TABLE note_embeddings ADD COLUMN dim INTEGER NOT NULL DEFAULT 0`);
    if (!embNames.has("input_version")) db.exec(`ALTER TABLE note_embeddings ADD COLUMN input_version INTEGER NOT NULL DEFAULT 1`);
    for (const table of ["finance_transactions", "finance_movements"]) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      const existing = new Set(columns.map(column => column.name));
      if (!existing.has("hidden")) db.exec(`ALTER TABLE ${table} ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))`);
      if (!existing.has("reverted")) db.exec(`ALTER TABLE ${table} ADD COLUMN reverted INTEGER NOT NULL DEFAULT 0 CHECK (reverted IN (0, 1))`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS finance_refunds (
      id TEXT PRIMARY KEY, expense_id TEXT NOT NULL REFERENCES finance_transactions(id),
      account_id TEXT NOT NULL REFERENCES finance_accounts(id),
      amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents BETWEEN 1 AND 9007199254740991),
      transaction_date TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', tag_ids TEXT NOT NULL DEFAULT '[]',
      hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)), reverted INTEGER NOT NULL DEFAULT 0 CHECK (reverted IN (0, 1)),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_finance_refunds_expense ON finance_refunds(expense_id);`);
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

/** Execute the minimal probe used by the health adapter. */
export function checkDatabase(): void {
  getDb().prepare("SELECT 1").get();
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function uid(): string {
  return crypto.randomUUID();
}
