<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.png">
  <img src="https://i.imgur.com/eGegh2T.png" alt="Chibako — the Knowledge Box" width="480">
</picture>

### A self-hosted, Obsidian-like second brain

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
- [How it compares](#-how-it-compares)
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

I wanted the *feel* of Obsidian: plain Markdown, `[[wikilinks]]`, backlinks, a
graph of how ideas connect. Obsidian and Logseq are wonderful **on the desktop**,
and they're great as agent-controlled memory too. The problem is what happens
when the vault should live on a remote server instead. Obsidian ships no
official web app at all. Logseq *does* have an official web app and a Docker
image, but they only serve the static app — your notes stay on the local machine
and are opened through the browser's File System Access API, so the server never
actually holds the vault. In both cases, "self-hosted web notes" is not the
default experience.

The usual workaround is a synced vault folder plus a mesh VPN like Tailscale so
a desktop app can reach the server. That works, but it's a poor experience:
install the desktop app on every device, keep sync healthy, and hope nothing
drifts.

**Chibako closes that gap.** It is a web app you self-host, so your notes are a
browser tab away from anywhere — *and* it speaks to AI agents natively through a
REST API and an MCP server. It's inspired by Obsidian and Logseq, but built
remote-first and agent-first.

## 🇯🇵 The name

**Chibako** comes from the Japanese parts:

- **Chi (知)** — the root for wisdom, intellect, and knowledge (as in *chishiki*,
  知識, "knowledge").
- **Bako (箱 / ばこ)** — "box" or "container." This is *hako* (箱), which shifts
  to *bako* under a phonetic change when combined.

Read together, **Chibako ≈ "Knowledge Box" / "Wisdom Box"** — a container for
what you know, that both you and your agents can reach.

## ⚡ Why Chibako?

Most note apps are **local-first** and treat the server as an afterthought.
Chibako is **server-first** and treats your agent as a first-class user.

- **A real web UI on your own server.** Log in from any browser, on any device.
  No desktop app, no sync folder, no Tailscale dance.
- **One file to back up.** The entire vault — notes, links, search index, keys,
  sessions — is `data/brain.db` (SQLite, WAL mode). Back it up with a single
  `VACUUM INTO` command.
- **Runs on a tiny VPS.** 1 vCPU / 4 GB is plenty. No external services, no
  separate database, no vector DB required.
- **Agent-native by construction.** Scoped, revocable API keys; a REST API that
  mirrors every UI action; and an MCP stdio server with 20+ tools.
- **Token-efficient by design.** Notes are raw Markdown (no JSON block trees),
  list/links calls return titles and ids only, `ingest_note` packs a note +
  links + schema into one round trip, and `recall` returns ranked titles +
  trimmed snippets approximately bounded by a caller-selected token budget —
  never full bodies during discovery. See the
  [design and evidence](docs/AGENT-MEMORY.md#why-retrieval-uses-fewer-context-tokens).
- **Markdown stays portable.** Your notes are plain text you can read, diff,
  and move. The database is an index, not a lock-in.

## ⚖️ How it compares

Chibako sits next to Obsidian and Logseq rather than replacing them outright.
The difference is *where it runs* and *who it serves first*.

| | Obsidian | Logseq | **Chibako** |
|---|---|---|---|
| Note model | Markdown + wikilinks | Outliner / blocks, Markdown | Markdown + wikilinks |
| Primary app | Desktop + mobile (local-first) | Desktop + mobile; web app reads local files | **Self-hosted web UI (server-first)** |
| Official web app | None (Obsidian Publish is a read-only site) | Yes — but notes stay local via File System Access API | **Yes — notes live on your server** |
| Reach a remote server | Sync folder + desktop app (Obsidian Sync or VPN/Tailscale) | Sync folder + desktop app, or self-host the static web app | **Open a URL on your VPS from any browser** |
| Agent access | Community MCP servers / plugins; no built-in agent API | Community MCP servers / plugins; no built-in agent API | **Built-in REST API + MCP server, scoped keys** |
| Token efficiency for LLMs | Whole note files | Block-tree serialization | **Raw Markdown; titles+ids lists; token-budgeted `recall`** |
| Storage | Vault folder of files | Files / graph DB | **One `brain.db` (SQLite)** |
| Self-hosting | Desktop-first | Desktop-first (server serves static app only) | **Docker + nginx on one VPS** |
| License | Proprietary, free to use (closed source) | Open source (AGPL-3.0) | **Open source (MIT)** |

> Comparison reflects each project's public documentation at the time of
> writing and may change. Chibako is an independent project, not affiliated
> with or endorsed by Obsidian or Logseq. Verify specifics before relying on
> them.

The honest summary: if you want a sprawling plugin ecosystem and a polished
native desktop app, Obsidian and Logseq are excellent. If you want your notes
**reachable over the web from a server you control** and **directly usable as AI
agent memory**, that's the gap Chibako was built to fill.

## ✨ Features

- **Obsidian-style notes** — plain Markdown, `[[wikilink]]` syntax, backlinks
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
npm run dev        # http://localhost:3000 → run the one-time setup
```

## 🚢 Deploy to your VPS (Docker Compose + nginx)

The repo ships a `Dockerfile`, `docker-compose.yml`, and an `nginx/nginx.conf`
reverse-proxy template (the VPS runs nginx, so there's no Caddy involved).

1. Clone the repo on your VPS:

   ```bash
   git clone https://github.com/jccd-dev/Chibako.git /opt/chibako
   cd /opt/chibako
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

## 🤖 Connect your AI agent

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

### Install the memory skill

The [Chibako Memory skill](skills/chibako-memory/SKILL.md) teaches compatible
agents to fetch your Knowledge Schema, recall relevant notes, inspect recent
observations, and save durable knowledge when authorized. Configure Chibako MCP
first using the instructions above. With a scoped API key, use `schema:read`
and `notes:read`; add `notes:write` if you want the agent to save knowledge.
The skill does not install Chibako, configure MCP, or copy your vault.

Install from this public repository using the [skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add jccd-dev/Chibako --skill chibako-memory
```

For Codex across all projects:

```bash
npx skills add jccd-dev/Chibako --skill chibako-memory --agent codex --global
```

Restart or reload your agent's skills after installation. In Codex, invoke it
with `$chibako-memory`, for example: "Use $chibako-memory to recall our
authentication decisions before reviewing this change."

Installation makes the skill available for selection; it is not a startup hook
and does not guarantee execution in every chat. To require retrieval on each
task, add this to your agent's persistent instructions (for example, a project
`AGENTS.md`, or user-level instructions for all projects):

```markdown
Use the chibako-memory skill at the start of every task. Retrieve relevant
context before working. Treat questions as read-only; save memory only when
I request it or have explicitly authorized ongoing memory updates.
```

If you want routine saving too, explicitly add:

```markdown
After implementation tasks, you may save confirmed, reusable project decisions
and lessons to Chibako. Skip secrets, raw transcripts, and temporary details.
```

**Settings → Knowledge schema** controls the vault's organization rules. The
skill fetches those rules; changes apply on the next fetch. Memory survives a
new chat when its MCP connection accesses the same vault. `recall` searches
notes, while `list_observations` retrieves recent observations separately.

Contributors can check discovery before publishing without installing anything:

```bash
npx skills add ./skills --list
```

## 🔌 REST API reference

| Method | Path | Scope | Description |
|---|---|---|---|
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

Backing up is copying one file (and its WAL):

```bash
sqlite3 data/brain.db "VACUUM INTO 'brain-backup.db'"
```

Then copy `brain-backup.db` off the VPS. That's the entire vault — notes,
links, search index, keys, sessions.

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
src/app/          pages + API route handlers
src/lib/          db, auth, notes engine, markdown/wikilinks, api wrapper
src/components/   sidebar, editor, preview, graph, settings, agent guide
src/mcp/server.ts MCP stdio server (bundled to dist/mcp/server.mjs)
nginx/            reverse-proxy template for the VPS
docs/adr/         architecture decision records
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
- **Deeper hardening** — login/setup rate limiting, closing the `keys:write`
  self-escalation path, stronger password hashing, and automated tests for
  auth, scope enforcement, trash, and search.
- **Verified deploy path** — a real `docker compose up` smoke test on
  `node:22-slim` and a documented nginx + TLS runbook.

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
