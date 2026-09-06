# Chibako

A self-hosted, Obsidian-like second brain. Markdown notes connected by
`[[wikilinks]]`, automatic backlinks, a linked graph view — and a
token-efficient REST + MCP layer so your own AI agent (Hermes, Claude, Cursor,
anything that speaks MCP) can read and write your notes directly.

Designed to run on a single small VPS (1 vCPU / 4 GB is plenty).

## Features

- **Obsidian-style notes** — plain Markdown, `[[wikilink]]` syntax, backlinks
  computed automatically, folders, note kinds (`note` / `wiki` / `index`)
- **Live editor** — edit / preview / split modes, autosave, toolbar, `⌘S`
- **Command palette** (`⌘K`) — search, jump, create notes; global `⌘N`
- **`[[` autocomplete** with duplicate-title warnings
- **Trash** — soft delete, restore, 30-day auto-purge, Undo toast
- **Graph view** — force-directed map of your vault; click a node to open it
- **Full-text search** with snippets
- **Knowledge schema** — an `AGENTS.md`-format file (editable in Settings) that
  tells your agent how to run the raw → wiki → outputs "second brain" loop
- **Agent access**
  - **REST API** — scoped, revocable API keys; every operation is an HTTP endpoint
  - **MCP server** — one stdio server with `list_notes`, `search_notes`,
    `read_note`, `get_links`, `create_note`, `update_note`, `ingest_note`
    (token-efficient bundle), `delete_note` (trash), `restore_note`,
    `purge_note`, `get_graph`, `get_knowledge_schema`, `get_stats`
- **Token efficiency by design** — notes are raw Markdown (no JSON block trees),
  list/links calls return titles and ids only, and `ingest_note` packs
  note + links + schema into a single round trip
- **Single admin auth** — password login + DB-backed sessions; one-time setup
- **One file to back up** — the whole vault is `data/brain.db` (SQLite)

## Quick start (local dev)

```bash
npm install
npm run dev        # http://localhost:3000 → run the one-time setup
```

## Deploy to your VPS (Docker Compose + nginx)

The repo ships a `Dockerfile`, `docker-compose.yml`, and an `nginx/nginx.conf`
reverse-proxy template (the VPS runs nginx, so there's no Caddy involved).

1. Copy the repo to your VPS (or build from here):

   ```bash
   git clone <your-repo> /opt/chibako && cd /opt/chibako
   docker compose up -d --build
   ```

   The app listens on port 3000 (internal only). Your vault persists in `./data`.

2. Put nginx in front of it. Edit `nginx/nginx.conf`, change the two
   `server_name` lines to your domain, then:

   ```bash
   sudo cp nginx/nginx.conf /etc/nginx/sites-available/chibako
   sudo ln -s /etc/nginx/sites-available/chibako /etc/nginx/sites-enabled/chibako
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d your-domain.com    # free TLS
   ```

3. Open `https://your-domain.com`, complete the one-time setup, and you're in.

## Connecting your AI agent

Two ways, both scoped by an API key you create in **Settings → API keys**.

### MCP (recommended for Hermes/Claude/Cursor)

Point your MCP client at the bundled server:

```json
{
  "mcpServers": {
    "chibako": {
      "command": "node",
      "args": ["/opt/chibako/dist/mcp/server.mjs"],
      "env": {
        "CHIBAKO_DATA_DIR": "/opt/chibako/data",
        "CHIBAKO_API_KEY": "ck_..."
      }
    }
  }
}
```

`CHIBAKO_API_KEY` is optional; when set, the server checks it against the
vault's API keys and enforces scopes. Without it, the server has full local
access (fine if only you can reach the machine).

### REST

```bash
curl https://your-domain.com/api/notes -H "Authorization: Bearer ck_..."
curl https://your-domain.com/api/search?q=meeting -H "Authorization: Bearer ck_..."
curl -X POST https://your-domain.com/api/notes \
  -H "Authorization: Bearer ck_..." -H "Content-Type: application/json" \
  -d '{"title":"Meeting note","content":"# Meeting\n- See [[v2 plan]]"}'
```

See `/app/agent` in the UI for the full tool list and examples.

## REST API reference

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/notes` | `notes:read` | List all notes (summary only) |
| POST | `/api/notes` | `notes:write` | Create a note |
| GET | `/api/notes/:id` | `notes:read` | Full note |
| PATCH | `/api/notes/:id` | `notes:write` | Update title/content/folder/kind |
| DELETE | `/api/notes/:id` | `notes:write` | Delete a note |
| GET | `/api/notes/:id/links` | `notes:read` | Outlinks + backlinks |
| GET | `/api/search?q=` | `notes:read` or `search:read` | Full-text search |
| GET | `/api/graph` | `notes:read` | Nodes + edges |
| GET | `/api/schema` | `schema:read` | Knowledge schema (AGENTS.md) |
| PUT | `/api/schema` | `schema:write` | Update knowledge schema |
| GET | `/api/keys` | `keys:read` | List API keys |
| POST | `/api/keys` | `keys:write` | Create API key |
| DELETE | `/api/keys/:id` | `keys:write` | Revoke API key |
| GET | `/api/health` | — | Liveness probe |

Auth: `Authorization: Bearer <key>`, or the web session cookie.

## Backup

Backing up is copying one file (and its WAL):

```bash
sqlite3 data/brain.db "VACUUM INTO 'brain-backup.db'"
```

Then copy `brain-backup.db` off the VPS. That's the entire vault — notes,
links, search index, keys, sessions.

## Data model

- `notes` — `id`, `title`, `folder`, `content` (markdown), `kind`, timestamps
- `links` — materialized wikilinks: `(source_id, target_title, target_id)`
- `notes_fts` — FTS5 index (titles + content), `id UNINDEXED`
- `sessions` — login tokens
- `api_keys` — SHA-256-hashed, scoped keys
- `settings` — key/value (password hash, knowledge schema)
- `ingest_log` — reserved for the raw → wiki ingest loop

## Project layout

```
src/app/          pages + API route handlers
src/lib/          db, auth, notes engine, markdown/wikilinks, api wrapper
src/components/   sidebar, editor, preview, graph, settings, agent guide
src/mcp/server.ts MCP stdio server (bundled to dist/mcp/server.mjs)
nginx/            reverse-proxy template for the VPS
```

See `AGENTS.md` for developer conventions.