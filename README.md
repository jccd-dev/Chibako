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

I wanted plain Markdown, `[[wikilinks]]`, backlinks and a graph of how ideas
connect. Desktop note apps such as Logseq are wonderful **on the desktop**, and
they're great as agent-controlled memory too. The problem is what happens when
the vault should live on a remote server instead. Logseq *does* have an
official web app and a Docker image, but they only serve the static app — your
notes stay on the local machine and are opened through the browser's File
System Access API, so the server never actually holds the vault.
"Self-hosted web notes" is not the default experience.

The usual workaround is a synced vault folder plus a mesh VPN like Tailscale so
a desktop app can reach the server. That works, but it's a poor experience:
install the desktop app on every device, keep sync healthy, and hope nothing
drifts.

**Chibako closes that gap.** It is a web app you self-host, so your notes are a
browser tab away from anywhere — *and* it speaks to AI agents natively through a
REST API and an MCP server. It's built remote-first and agent-first.

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
  mirrors every UI action; and an MCP stdio server with 21 tools.
- **Token-efficient by design.** Notes are raw Markdown (no JSON block trees),
  list/links calls return titles and ids only, `ingest_note` packs a note +
  links + schema into one round trip, and `recall` returns ranked titles +
  trimmed snippets approximately bounded by a caller-selected token budget —
  never full bodies during discovery. See the
  [design and evidence](docs/AGENT-MEMORY.md#why-retrieval-uses-fewer-context-tokens).
- **Markdown stays portable.** Your notes are plain text you can read, diff,
  and move. The database is an index, not a lock-in.

## ⚖️ How it compares

Chibako sits next to local-first note apps such as Logseq rather than replacing them outright.
The difference is *where it runs* and *who it serves first*.

| | Logseq | **Chibako** |
|---|---|---|
| Note model | Outliner / blocks, Markdown | Markdown + wikilinks |
| Primary app | Desktop + mobile; web app reads local files | **Self-hosted web UI (server-first)** |
| Official web app | Yes — but notes stay local via File System Access API | **Yes — notes live on your server** |
| Reach a remote server | Sync folder + desktop app, or self-host the static web app | **Open a URL on your VPS from any browser** |
| Agent access | Community MCP servers / plugins; no built-in agent API | **Built-in REST API + MCP server, scoped keys** |
| Token efficiency for LLMs | Block-tree serialization | **Raw Markdown; titles+ids lists; token-budgeted `recall`** |
| Storage | Files / graph DB | **One `brain.db` (SQLite)** |
| Self-hosting | Desktop-first (server serves static app only) | **Docker + nginx on one VPS** |
| License | Open source (AGPL-3.0) | **Open source (MIT)** |

> Comparison reflects each project's public documentation at the time of
> writing and may change. Chibako is an independent project, not affiliated
> with or endorsed by Logseq. Verify specifics before relying on
> them.

The honest summary: if you want a sprawling plugin ecosystem and a polished
native desktop app, local-first apps such as Logseq are excellent. If you want your notes
**reachable over the web from a server you control** and **directly usable as AI
agent memory**, that's the gap Chibako was built to fill.

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

   To use the published GHCR image instead of building locally:

   ```bash
   docker compose -f docker-compose.release.yml pull
   docker compose -f docker-compose.release.yml up -d
   ```

   The release image tracks `latest` by default. Pin `CHIBAKO_IMAGE` to a
   commit tag or digest when you need repeatable upgrades; the published image
   currently targets `linux/amd64`.

   For an existing release-image install, update it with:

   ```bash
   docker compose -f docker-compose.release.yml pull
   docker compose -f docker-compose.release.yml up -d
   ```

   The `./data` bind mount is unchanged, so the SQLite vault survives image
   replacement. Existing source-build installs remain on the source flow:
   `git pull --ff-only && docker compose up -d --build`.

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

Finance access requires explicit scopes, even on wildcard keys: `finance:read`
for balances and reports, `finance:write` for activity, and `finance:manage` for
definitions and settings. Moving goal money requires both write and manage;
Finance Note links also require `notes:read`. Start with `get_finance_overview`
or `get_finance_attention`, then use filtered, paginated lists and request
`include_details` only when needed. For mutations, reuse the same `request_id`
when retrying an unchanged request and supply the current resource version
where required. Local stdio does not run automatic schedules; those require
the running Next.js server.

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

### Install the memory skill

The [Chibako Memory skill](skills/chibako-memory/SKILL.md) teaches compatible
agents to read the "Now" index, recall relevant notes, and save a thread overview
when meaningful work happened. The Knowledge Schema is fetched only before a write. Configure Chibako MCP
first using the instructions above. With a scoped API key, use `schema:read`
and `notes:read`; add `notes:write` if you want the agent to save knowledge.

### Install as a Codex or ChatGPT plugin

This repository is also a portable [Agent Plugins](https://agent-plugins.org)
package. [`plugin.json`](plugin.json) bundles the `chibako-memory` skill and
[`mcp.json`](mcp.json) points at the hosted Chibako MCP endpoint, so Codex and
the ChatGPT desktop app can install both at once.

```bash
codex plugin marketplace add jccd-dev/Chibako
```

Then open **Plugins** (or run `/plugins` in Codex CLI) and install **Chibako**
from your marketplace. In Codex CLI you can also press <kbd>Space</kbd> on the
installed plugin to toggle it.

The plugin ships no credential. Add your own key once, in your user config —
never in this repository:

```toml
# ~/.codex/config.toml
[mcp_servers.chibako]
bearer_token_env_var = "CHIBAKO_API_KEY"
```

Self-hosters should edit `mcp.json` to point at their own `/mcp` URL before
publishing a fork. IDE extensions do not support plugins; use the desktop app
or Codex CLI.

### Automatic memory plugin packages

Automatic memory is opt-in. The standalone packages add a private terminal setup
wizard, hooks and controls for Codex, Claude Code and Hermes. They use only
`notes:read`, `schema:read` and `memory:write`; the server owner must first deploy
the memory capability and configure an approved non-root area.

The installable archives are built with `npm run build:memory-plugins` under
`dist/plugins/`. End users extract the archive for their runtime and install that
local plugin/marketplace through their client. Node.js 20+ is required; no Chibako
checkout or npm install is needed on the client. These artifacts are not published
by building them. Hook-bearing Codex packages currently use manual installation,
not the official public plugin directory.

Use the installed `chibako-memory-setup` skill to obtain the exact command for your
own terminal. It hides the API-key input and previews private configuration before
applying it. Never paste the key into agent chat. Installation, connection checks
and proven autonomous capture are separate states.

See the [automatic memory installation guide](integrations/agent-memory/INSTALL.md)
for installation, controls, private-state paths, recovery and compatibility limits.
The source-repository marketplace above continues to provide manual memory access;
use a built archive for the bundled automatic setup workflow.

### Security audits on `npx skills add`

The `skills` CLI prints a **Security Risk Assessments** table (Gen, Socket,
Snyk). Those verdicts come from third-party scanners that run on a schedule
against the GitHub repository — they are not a live scan of your local files,
and the table is cached server-side, so it can lag your latest commits.
[View the current verdicts for this repo](https://skills.sh/jccd-dev/Chibako).
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
and does not guarantee execution in every chat. For automatic, low-cost memory
in Codex, Claude Code and Hermes, install the hook plugins described in
[integrations/agent-memory](integrations/agent-memory/README.md): they load a
capped "Now" index at session start and request a checkpoint only after
meaningful activity (default 4 user turns or 10 tool calls). Without hooks, add
this to your agent's persistent instructions (for example, a project
`AGENTS.md`, or user-level instructions for all projects):

```markdown
Use the chibako-memory skill once at the start of each session. Retrieve relevant
context before working. Treat questions as read-only; save memory only when
I request it or have explicitly authorized ongoing memory updates.
```

If you want routine saving too, explicitly add:

```markdown
After implementation tasks, you may save confirmed, reusable project decisions
and lessons to Chibako. Skip secrets, raw transcripts, and temporary details.
```

**Settings → Knowledge schema** controls the vault's organization rules. The
skill fetches those rules before writing; changes apply on the next fetch. After
upgrading, apply the new "Agent memory" section with **Restore default → Save**
(this replaces your customized schema, so merge any edits back first). Memory survives a
new chat when its MCP connection accesses the same vault. `recall` searches
notes, while `list_observations` retrieves recent observations separately.

Contributors can check discovery before publishing without installing anything:

```bash
npx skills add ./skills --list
```

## Finance planning

Finance → Planning uses one **Plans** list for recurring schedules and one-time
plans. Filter by **All**, **Needs attention**, **Upcoming**, or **Paused**. Open a
schedule to review its payments, log or match actual activity, skip a payment, or
view recorded history. Use **Confirm** or **Confirm income** beside a pending payment
to confirm actual activity inline in the same overview drawer, including early
payments on automatic schedules. Recording or matching a recurring payment prepares
the next payment automatically, including when paid early. Recorded payments are
not posted again automatically. Due counts stay on the schedule instead
of a separate queue. Payment history is shown newest first.

Use **Edit plan** in the overview to change pending and future occurrences. **Delete plan**
stops recurrence and cancels its pending payments while retaining recorded cash activity
and audit history. Reverting recorded activity from a deleted schedule does not reopen
its payments.

Choose **Add plan**, then select income or expense. New plans default to recurring,
monthly, and manual handling. Use **Set as recurring** to switch to a one-time plan,
or choose a repeat preset or custom interval, handling, and ending controls.
**Every 2 months** means exactly that; bi-weekly means every two weeks. The schedule preview shows the first and next dates before saving.

Income and expense plans are expectations until posted or matched to actual activity.
Recurring schedules support daily, weekly, monthly, and yearly intervals, plus custom
interval counts. Month-end dates remain anchored: January 31 becomes February 28,
then March 31. Plans and schedules store `logged_time` (`HH:mm`, default `00:00`),
`timezone` (IANA, default `UTC`).

Schedules default to `handling: "manual"`, including existing and imported schedules.
Manual plans need confirmation before changing account balances. Opting into
`handling: "automatic"` requires both `finance:manage` and `finance:write`.
The running Next.js Node server checks automatic schedules at startup and every minute,
even while the browser is closed. After downtime it catches up missed due dates in
bounded batches. The server must stay running; static hosting, suspended/serverless
processes, and the standalone MCP stdio process do not run this scheduler.
Build and test phases do not start the runner. No external cron service is required.

Handling belongs to each occurrence: editing "this and future" preserves earlier
manual or automatic plans. The schedule handling sets the default for newly generated
occurrences; each plan returns its own `handling`. Global pause stops all automatic
occurrences of that schedule.

Automatic plans post the expected amount/account once, on the schedule's local date
and time. Paused schedules do not post. A skipped occurrence stays skipped; reverting
a posted occurrence reopens it for manual review without automatic reposting. Failed
posting leaves no partial financial effects, exposes `automatic_error` on its schedule,
and retries on the next check. Linked debt/receivable reminders always use manual
handling so principal and fees can be reviewed. Automatic posts use the trusted-local
audit identity, and SQLite write transactions serialize competing server processes.

Optional `max_occurrences` and `total_limit` (PHP decimal input, returned as
`total_limit_cents`) cap scheduled slots, including skipped slots. A total allows only
whole payments: PHP 25 at PHP 12 per slot creates two slots. It measures the planned
budget at the current schedule amount, rather than actual posted spending. Changing
the amount recalculates that slot budget; satisfied history stays unchanged. Cadence
edits retain earlier consumed slots. Shortening limits cancels affected future pending
slots; extending limits can restore boundary cancellations but never explicit skips.
The inclusive `end_date` remains an additional boundary.

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
