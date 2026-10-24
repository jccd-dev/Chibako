<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.png">
  <img src="https://i.imgur.com/eGegh2T.png" alt="Chibako — the Knowledge Box" width="480">
</picture>

### A self-hosted second brain

Plain Markdown notes connected by `[[wikilinks]]` — with automatic backlinks, a
force-directed graph view, and a first-class **REST + MCP** layer so your own AI
agent can read and write your vault without blowing token budgets.

**Open source (MIT)** · self-hosted · runs on a single small VPS · one SQLite file to back up

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-black?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://sqlite.org)
[![MCP](https://img.shields.io/badge/MCP-native-7C3AED)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

**[How agent memory works](docs/AGENT-MEMORY.md)** · architecture, retrieval flow, token-efficiency evidence, and tradeoffs

</div>

---

## Contents

- [The story](#-the-story)
- [The name](#-the-name)
- [Why Chibako?](#-why-chibako)
- [Features](#-features)
- [Quick start (local dev)](#-quick-start-local-dev)
- [Deploy to your VPS](#-deploy-to-your-vps-docker-compose--nginx)
- [Connect your AI agent](#-connect-your-ai-agent)
- [How agent memory works](docs/AGENT-MEMORY.md)
- [REST API reference](#-rest-api-reference)
- [Backup](#-backup)
- [Data model](#-data-model)
- [Project layout](#-project-layout)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

---

## 📖 The story

Chibako started as a personal project: a place for my own notes that could live
on my VPS, and that I could also use as long-term memory — a "second brain" —
for the AI agents I build (Hermes and anything else that speaks MCP).

I wanted Markdown notes, `[[wikilinks]]`, backlinks, and a graph of how ideas
connect, accessible from any browser. Chibako keeps that vault on a server I
control and gives my agents scoped REST and MCP access to the same knowledge.

## 🇯🇵 The name

**Chibako** comes from the Japanese parts:

- **Chi (知)** — the root for wisdom, intellect, and knowledge (as in *chishiki*,
  知識, "knowledge").
- **Bako (箱 / ばこ)** — "box" or "container." This is *hako* (箱), which shifts
  to *bako* under a phonetic change when combined.

Read together, **Chibako ≈ "Knowledge Box" / "Wisdom Box"** — a container for
what you know, that both you and your agents can reach.

## ⚡ Why Chibako?

Chibako keeps your notes and agent memory together on your own server.

- **A real web UI on your own server.** Log in from any browser, on any device.
  No desktop installation or folder sync required.
- **One file to back up.** The entire vault — notes, links, search index, keys,
  sessions — is `data/brain.db` (SQLite, WAL mode). Back it up with a single
  `VACUUM INTO` command.
- **Runs on a tiny VPS.** 1 vCPU / 4 GB is plenty. No external services, no
  separate database, no vector DB required.
- **Agent-native by construction.** Scoped, revocable API keys; a REST API that
  mirrors every UI action; and remote or local MCP access.
- **Token-efficient by design.** Notes are raw Markdown (no JSON block trees),
  list/links calls return titles and ids only, `ingest_note` packs a note +
  links + schema into one round trip, and `recall` returns ranked titles +
  trimmed snippets approximately bounded by a caller-selected token budget —
  never full bodies during discovery. See the
  [design and evidence](docs/AGENT-MEMORY.md#why-retrieval-uses-fewer-context-tokens).
- **Markdown stays portable.** Your notes are plain text you can read, diff,
  and move. The database is an index, not a lock-in.

## ✨ Features

- **Linked Markdown notes** — plain Markdown, `[[wikilink]]` syntax, backlinks
  computed automatically, folders, note kinds (`note` / `wiki` / `index`)
- **Live editor** — edit / split / preview / **write (WYSIWYG)** modes,
  autosave, toolbar, `⌘S`
- **Command palette** (`⌘K`) — search, jump, create notes; global `⌘N`
- **`[[` autocomplete** with duplicate-title warnings and a missing-link
  "create note" modal
- **Backlinks, outlinks, and unlinked mentions** — one click converts a mention
  into a link
- **Typed properties** — YAML frontmatter with a vault-wide, editable dictionary
- **Bookmarks** — label, group, and drag-reorder
- **Trash** — soft delete, restore, 30-day auto-purge, Undo toast
- **Graph view** — force-directed map of your vault; zoom/pan, click to open,
  folder filter, orphan highlighting
- **Full-text search** with `<mark>`-highlighted snippets
- **Knowledge schema** — an `AGENTS.md`-format file (editable in Settings) that
  tells your agent how to run the raw → wiki → outputs "second brain" loop
- **Finance** — accounts, income and expenses, transfers, budgets, goals, debts,
  receivables, and one-time or recurring plans
- **Automatic agent memory** — opt-in plugins for Claude Code, Codex, and Hermes;
  bundled hooks and skills recall context and save thread checkpoints
- **Agent access**
  - **REST API** — scoped, revocable API keys; every operation is an HTTP endpoint
  - **MCP server** — one stdio server with `list_notes`, `search_notes`,
    `recall` (token-budgeted retrieval), `read_note`, `get_links`, `create_note`,
    `update_note`, `ingest_note` (token-efficient bundle), `delete_note` (trash),
    `restore_note`, `purge_note`, `get_graph`, `get_knowledge_schema`,
    `get_stats`, plus `memory_save` / `list_observations` / `delete_observation`
    (observation log) and `index_embeddings` / `embedding_status`
- **Token efficiency by design** — raw Markdown bodies, id-only list/links
  payloads, single-call `ingest_note`, and `recall` snippets targeted to an
  approximate token budget
- **Optional semantic recall** — set `CHIBAKO_EMBEDDING_PROVIDER` +
  `CHIBAKO_EMBEDDING_API_KEY` (any OpenAI-compatible `/v1/embeddings` endpoint)
  to fuse vector search with BM25 via RRF. Embeddings refresh on note changes
  and can be repaired from **Settings → Recall**. Disabled by default, zero
  network calls when off.
- **Single admin auth** — password login + DB-backed sessions; one-time setup
- **Light / dark theme**, keyboard-driven UI, responsive mobile drawer
- **One file to back up** — the whole vault is `data/brain.db`

## 🚀 Quick start (local dev)

```bash
npm install
cp .env.example .env.local
# Set CHIBAKO_SETUP_TOKEN in .env.local to the output of: openssl rand -hex 32
npm run dev        # http://localhost:3000 → run the one-time setup
```

Enter the configured setup token and a unique password of at least 15 characters.
After setup, remove the token from your environment file and restart the app.
Existing vaults do not need a setup token; their passwords remain valid.

Run `npm run lint` for ESLint (errors and warnings fail the check),
`npm run typecheck` for route generation and TypeScript, and `npm test` for
the Node test suite. Next.js generates `next-env.d.ts`; it is not tracked in Git.

## 🚢 Deploy to your VPS (Docker Compose + nginx)

The repo ships a `Dockerfile`, source-build `docker-compose.yml`, prebuilt-image
`docker-compose.release.yml`, and an `nginx/nginx.conf` reverse-proxy template.
Both Compose files bind the app to IPv4 loopback (`127.0.0.1:3000` by default);
host nginx is the public entrypoint.

1. Point DNS at the VPS and allow TCP ports 80 and 443 through its firewall.
   Do not open port 3000 publicly.

2. Clone the repo on your VPS:

   ```bash
   git clone https://github.com/jccd-dev/Chibako.git /opt/chibako
   cd /opt/chibako
   cp .env.example .env
   # Set CHIBAKO_SETUP_TOKEN in .env to: openssl rand -hex 32
   docker compose up -d --build
   ```

   The app listens on `127.0.0.1:3000`. Your vault persists in `./data`.
   The container entrypoint fixes the bind-mount ownership and runs the app as
   the unprivileged `node` user.

   Prefer the prebuilt image with in-app updates? Run the installer (or the
   Docker-only commands) from [docs/UPDATES.md](docs/UPDATES.md):

   ```bash
   curl -fsSL https://github.com/jccd-dev/chibako/releases/latest/download/install.sh | bash
   ```

   Chibako then shows **Update available vX.Y.Z** and the owner clicks
   **Update**. The updater takes a backup first and attempts to restore it if
   the new version fails its health check. If recovery fails, writes stay
   paused until an operator resolves it. After success, save pending edits and
   confirm **Reload Chibako**. Existing release-image installs can be
   adopted without moving their data; see the same guide. The published image
   currently targets `linux/amd64`.

   Existing source-build installs can stay on the source flow
   (`git pull --ff-only && docker compose up -d --build`) or move to the managed
   image with `install.sh migrate`, which keeps the checkout and vault in place
   ([guide](docs/UPDATES.md#move-from-a-source-build)).

   Before using a real vault with the source-build path, run
   `./scripts/smoke-docker.sh` on a machine with Docker and a running daemon.
   It builds the packaged image, uses a temporary project/port/vault, checks
   setup/login and restart persistence, validates the Compose loopback binding
   and nginx syntax, then cleans up its resources.
   Exit status `2` means the check is unverified because Docker or a required
   local tool is unavailable.

3. Install the bootstrap nginx site. Edit `nginx/nginx.conf`, replace
   `chibako.example.com` with your domain, then:

   ```bash
   sudo mkdir -p /var/www/html
   sudo cp nginx/nginx.conf /etc/nginx/sites-available/chibako
   sudo ln -s /etc/nginx/sites-available/chibako /etc/nginx/sites-enabled/chibako
   sudo nginx -t && sudo systemctl reload nginx
   ```

   The bootstrap site proxies ordinary HTTP requests (including the health
   endpoint) but returns 404 for `/setup` and `/api/setup`, so nobody can claim
   the vault before TLS is ready. Check that DNS and the proxy are reachable:

   ```bash
   curl -i http://your-domain.com/api/health
   curl -i http://your-domain.com/setup       # must be 404 during bootstrap
   ```

4. Issue and install the certificate with Certbot. The nginx plugin adds the
   HTTPS server using the already-valid HTTP site:

   ```bash
   sudo certbot --nginx -d your-domain.com --redirect
   ```

   Edit the installed site and remove the two temporary `location ^~` setup
   guards from the configuration Certbot produced. Keep the HTTP-to-HTTPS
   redirect, the HTTPS proxy, and its `X-Chibako-Client-IP` directive, then
   verify and reload:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   curl -fsS https://your-domain.com/api/health
   ```

5. Once nginx overwrites `X-Chibako-Client-IP` and direct public access to the
   app is blocked, set `CHIBAKO_TRUST_PROXY=true` in `.env` and recreate the
   container. Leave it false for direct/local access.

   Open `https://your-domain.com/setup`, enter the configured setup token,
   and choose a unique admin password of at least 15 characters. Setup fails
   closed unless `CHIBAKO_SETUP_TOKEN` contains at least 32 characters. After
   setup, remove the token from `.env` and recreate the container. Setup
   cannot be repeated after the password is stored.

Login, setup, and current-password verification share a five-attempt-per-minute
client limit and a 50-attempt-per-minute vault-wide limit. Counters live in SQLite
and survive app restarts; workers using the same vault share them. Attempts over
the limit receive HTTP 429 with `Retry-After`; blocked requests do not extend the
window. During an attack these limits can temporarily delay legitimate login.
Only accepted attempts are counted, including successful authentication and
malformed credentials, before password hashing or setup writes.

By default, all clients share the five-attempt bucket and client-IP headers are
ignored. Enable `CHIBAKO_TRUST_PROXY=true` only behind the trusted nginx proxy;
it overwrites `X-Chibako-Client-IP` from `$remote_addr`. `X-Forwarded-For` is never
used. The app must remain loopback-only. Client identifiers are hashed in the
limiter table and expired rows are removed on the next authentication attempt.
The trusted-proxy setting also controls client identity for remote MCP throttling.

New passwords must contain 15–1024 characters and pass a small local common-password
blocklist; this is not a comprehensive breached-password check. Existing passwords
continue to work until changed. Upgrading an initialized vault needs no setup token.
Before upgrading production, review its proxy settings separately; no production
configuration is changed by these repository templates.

## 🤖 Connect your AI agent

Two ways, both scoped by an API key you create in **Settings → API keys**.

### Remote MCP (recommended)

Create a read-only key with `notes:read`, `search:read`, and `schema:read`, then
connect to the HTTPS endpoint already served by Chibako:

```toml
# ~/.codex/config.toml
[mcp_servers.chibako]
url = "https://your-domain.com/mcp"
bearer_token_env_var = "CHIBAKO_API_KEY"
```

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  chibako:
    url: "https://your-domain.com/mcp"
    headers:
      Authorization: "Bearer ${CHIBAKO_API_KEY}"
```

Export `CHIBAKO_API_KEY` before starting Codex. Hermes also resolves it from
`~/.hermes/.env`. Inline bearer values are supported by many clients but are
easier to leak through checked-in configuration or shell history. Chibako keys
are static bearer credentials, not MCP OAuth; revoke and replace a key if it is
exposed.

Remote MCP exposes only tools allowed by the key. `notes:purge` is separate
from ordinary writes, and embedding indexing is intentionally local-only.

Finance tools require explicit `finance:read`, `finance:write`, or
`finance:manage` scopes. See `/app/agent` for operation-specific requirements.

### Advanced: local stdio MCP

When the client runs on the Chibako host and can read the Vault directory, it
can launch `dist/mcp/server.mjs` with `CHIBAKO_DATA_DIR`. An optional
`CHIBAKO_API_KEY` restricts its tools. Only an unset variable grants full local
stdio access; an empty or invalid configured key grants no access.
Do not copy a VPS or Docker filesystem path into a client running on your
laptop—the path is local to the machine that starts Node.

### REST

```bash
curl https://your-domain.com/api/notes -H "Authorization: Bearer ck_..."
curl https://your-domain.com/api/search?q=meeting -H "Authorization: Bearer ck_..."
curl -X POST https://your-domain.com/api/notes \
  -H "Authorization: Bearer ck_..." -H "Content-Type: application/json" \
  -d '{"title":"Meeting note","content":"# Meeting\n- See [[v2 plan]]"}'
```

See `/app/agent` in the UI for the full tool list and examples.

### Install the automatic memory plugin

Automatic memory is opt-in. The plugin adds hooks, a private terminal setup
wizard and controls for Claude Code, Codex and Hermes. It uses only
`notes:read`, `schema:read` and `memory:write`; the server owner must first deploy
the memory capability and configure an approved non-root area.

Install from this repository through your assistant's own plugin manager. No
build, checkout or npm install is needed; Node.js 20+ is required.

| Runtime | Install |
| --- | --- |
| Claude Code | `/plugin marketplace add jccd-dev/Chibako`, then `/plugin install chibako@chibako-plugins` |
| Codex | `codex plugin marketplace add jccd-dev/Chibako`, then `codex plugin add chibako@chibako-plugins` (or install from `/plugins`) and trust its hooks in `/hooks` |
| Hermes | `hermes plugins install jccd-dev/Chibako/plugins/hermes`, then enable it |

To update, refresh the marketplace and update the plugin: in Claude Code
`claude plugin marketplace update chibako-plugins` then
`claude plugin update chibako@chibako-plugins`; in Codex
`codex plugin marketplace upgrade` then `codex plugin add chibako@chibako-plugins`.
See the install guide for Hermes. Your setup is kept.

The plugin ships no credential and stays disabled until setup. Ask the installed
`chibako-memory-setup` skill for the exact command to run in your own terminal. It
asks for your Chibako URL and API key without echo and previews private
configuration before applying it. Never paste the key into agent chat.
Installation, connection checks and proven autonomous capture are separate states.

The installed files are the committed [`plugins/`](plugins) directories, generated
from source by `npm run publish:memory-plugins`; a test fails if they drift from a
fresh build. See the [automatic memory installation guide](integrations/agent-memory/INSTALL.md)
for controls, private-state paths, recovery and compatibility limits.

### Use the skill without automatic hooks

For an instruction-based workflow with an existing MCP connection:

```bash
npx skills add jccd-dev/Chibako --skill chibako-memory
```

Reload your agent's skills, then ask it to use `chibako-memory`. This standalone
skill does not install hooks or configure MCP. Use `notes:read` and `schema:read`;
add `notes:write` only if you authorize ordinary note saves. The automatic plugin
already includes memory, setup, and cleanup skills, so a separate skill install is
unnecessary. Remove duplicate manual memory hooks before enabling the plugin.

### Review old memory on demand

Invoke `$chibako-memory-cleanup` with a project, topic, or folder, for example:
`$chibako-memory-cleanup review Chibako session leftovers and duplicate decisions`.
It proposes what to keep, merge, or trash; approve concrete changes before they
are applied. Observation deletion is permanent and needs explicit approval.
The skill is explicit-only and is not called by lifecycle hooks. Routine session
completion continues to clean up only its own checkpoint. For a standalone install:

```bash
npx skills add jccd-dev/Chibako --skill chibako-memory-cleanup
```

Review uses the existing read connection. Applying broader cleanup requires the
appropriate Note-write permissions; restricted `memory:write` does not grant them.

See [how agent memory works](docs/AGENT-MEMORY.md) for retrieval, saving, and limits.

## 🔌 REST API reference

| Method | Path | Scope | Description |
|---|---|---|
| GET | `/api/notes` | `notes:read` | List all notes (summary only) |
| POST | `/api/notes` | `notes:write` | Create a note |
| GET | `/api/notes/:id` | `notes:read` | Full note |
| PATCH | `/api/notes/:id` | `notes:write` | Update title/content/folder/kind |
| DELETE | `/api/notes/:id` | `notes:write` | Delete a note |
| GET | `/api/notes/:id/links` | `notes:read` | Outlinks + backlinks |
| GET | `/api/search?q=` | `notes:read` or `search:read` | Full-text search |
| GET | `/api/embeddings` | `notes:read` | Semantic recall status (indexed/stale/error) |
| POST | `/api/embeddings/reindex` | `notes:write` | Reindex embeddings (no-op when disabled) |
| GET | `/api/graph` | `notes:read` | Nodes + edges |
| GET | `/api/schema` | `schema:read` | Knowledge schema (AGENTS.md) |
| PUT | `/api/schema` | `schema:write` | Update knowledge schema |
| GET | `/api/keys` | `keys:read` | List API keys |
| POST | `/api/keys` | session only | Create API key |
| DELETE | `/api/keys/:id` | session only | Revoke API key |
| GET | `/api/health` | — | Liveness probe |

Auth: `Authorization: Bearer <key>`, or the web session cookie.

## 💾 Backup

Create a SQLite-consistent snapshot with `VACUUM INTO`; this does not require
copying the live database or WAL files:

```bash
backup_dir=/var/backups/chibako
sudo install -d -m 700 "$backup_dir"
sudo sqlite3 data/brain.db \
  "VACUUM INTO '$backup_dir/brain-$(date +%Y%m%d-%H%M%S).db'"
```

Copy the resulting snapshot off the VPS (for example with `scp` or your
existing encrypted backup job), and retain more than one dated copy. The
snapshot contains the vault, links, search index, API keys, and sessions.

## 🗄️ Data model

- `notes` — `id`, `title`, `folder`, `content` (markdown), `kind`, cached
  `properties`, timestamps
- `folders` — folder paths
- `links` — materialized wikilinks: `(source_id, target_title, target_id)`
- `notes_fts` — FTS5 index (titles + content), `id UNINDEXED`
- `sessions` — login tokens
- `api_keys` — SHA-256-hashed, scoped keys
- `bookmarks` — labeled, grouped, ordered note shortcuts
- `note_embeddings` — optional per-note vectors (freshness by input hash)
- `observations` — agent observation log (`memory_save`)
- `settings` — key/value (password hash, knowledge schema, property dictionary)
- `ingest_log` — reserved for the raw → wiki ingest loop

## 🗂️ Project layout

```
src/app/                  pages + thin API route handlers; remote MCP at /mcp
src/features/             feature capabilities, client controllers, and components/
src/components/           shared controls and UI primitives
src/components/layout/    sidebar, top bar, workspace shell, command palette
src/components/providers/ theme, appearance, and notifications
src/server/               portable authorization and vault setup
src/lib/                  db, notes engine, markdown/wikilinks, embeddings, shared utilities
src/mcp/                  shared tool factory + local stdio adapter
nginx/                    reverse-proxy template for self-hosting
docs/adr/                 architecture decision records
```

See `AGENTS.md` for developer conventions and `CONTEXT.md` for the domain
glossary.

## 🗺️ Roadmap

Chibako is under active development. These are the current directions.

**Near-term**

- **Vault export / import** — JSON or zip-of-Markdown, so migration isn't just
  "copy `brain.db`."
- **Attachments and inline images** — file uploads plus reconciling how
  embedded images survive preview sanitization (text-only Markdown today).
- **Deeper hardening** — closing the `keys:write` self-escalation path,
  stronger password hashing, and broader automated auth/scope/trash/search
  coverage.
- **Verified deploy path** — run the isolated Docker smoke check in
  `scripts/smoke-docker.sh`, then complete the VPS-specific TLS, backup, and
  production checks.

**Later / exploring**

- **Fully local semantic search** — move the optional recall vectors into
  `sqlite-vec` inside the existing `brain.db`, so semantic retrieval needs no
  remote embedding service and still stays one file to back up.
- **Mobile and graph polish** — a responsiveness pass and richer graph
  filtering by folder/kind.
- **Multi-user workspaces** — per-user accounts, invites, and permissions
  (single-admin auth today). Deferred until the personal brain is rock solid.

**Explicitly out of scope**

- Real-time multiplayer editing, a whiteboard, and native mobile apps.
- A separate vector database service (Pinecone/Qdrant/pgvector) — retrieval
  stays inside `brain.db`.

## 🤝 Contributing

Chibako is open source and this repository is public. Contributions,
bug reports, and ideas are welcome.

1. Fork the repo and create a branch.
2. `npm install`, then `npm run dev` (and `npm test` for the suite).
3. Keep changes focused, match existing conventions (`AGENTS.md`), and open a
   pull request.

Please don't commit secrets or environment-specific values — production deploy
and host configuration live in a separate private repo.

## 📄 License

Chibako is open source software licensed under the [MIT License](LICENSE).
