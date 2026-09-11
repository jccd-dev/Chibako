# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individuals and small teams sharing one vault via web UI, currently behind a single admin login. Primary situation: day-to-day capture and retrieval of Markdown notes from anywhere, plus delegating read/write/search work to their own AI agent.

It also supports agent-first power users running the raw → wiki → outputs "second brain" loop via the knowledge schema, REST API, and MCP tools.

## Product Purpose

Chibako is a private, self-hosted second brain: plain-Markdown notes connected by `[[wikilinks]]`, with automatic backlinks, full-text search, and a force-directed graph view — reachable from anywhere via web UI and directly usable by the owner's AI agent without blowing token budgets.

Success means: fast capture, reliable linking/thinking, and token-efficient agent access, running on a single small VPS (1 vCPU / 4 GB) with one file to back up.

## Positioning

A self-hosted Obsidian-like vault that is private and agent-native by construction: raw Markdown (no JSON block trees), small list/links payloads, single-call `ingest_note`, and scoped REST + MCP access — plus one-SQLite-file simplicity that runs on a tiny VPS with easy backup and full control. A neighboring product could copy the editor or the graph, but not truthfully copy the combination of self-host control + built-in token-efficient agent layer + local-first speed.

## Operating Context

- Workflows: capture → link with `[[wikilink]]` → backlinks/graph navigation; live edit/preview/split editor with autosave, toolbar, `⌘S`; command palette (`⌘K`), global `⌘N`, `[[` autocomplete, Trash with 30-day purge + Undo; full-text search with snippets and keyboard nav; graph zoom/pan/orphans/folder filter + unlinked-mentions linking.
- Agent loop: knowledge schema (`AGENTS.md`-format, editable in Settings) drives the raw → wiki → outputs loop; agents connect via scoped API keys over REST or MCP stdio server.
- Environments: local development with `npm run dev`; self-hosted deployment with Docker Compose and the standalone Next server behind a TLS-terminating reverse proxy. The vault persists in `./data` as `data/brain.db` (WAL mode).
- Rituals/tools: light/dark toggle, keyboard-driven operation, view-mode memory, mobile drawer, sidebar recents/pins/folders/kinds; backup via `VACUUM INTO`.

## Capabilities and Constraints

Confirmed functionality: Markdown notes (`note` / `wiki` / `index` kinds, folders, title-as-identity); materialized `links` index with rename/stale-link re-pointing; FTS5/BM25 search with prefix `*` and `id UNINDEXED`; graph API + view; knowledge schema read/write; scoped revocable API keys (SHA-256 at rest); single-admin password + DB sessions; Trash (soft-delete/restore/purge); Settings (schema, keys, password); Agent guide page (`/app/agent`).

Technical constraints to preserve:
- Single SQLite file (`DATA_DIR/brain.db`), zero external services; no separate vector DB ever.
- Text-only Markdown for now — no file uploads.
- Recall combines FTS5 with optional whole-note remote embeddings; there is no separate vector database.
- MCP bundle must stay standalone (no `next/*`, `@/lib/api`, `@/lib/auth` imports).
- Preview HTML sanitized via `rehype-sanitize`; FTS snippets are `<mark>`-wrapped.
- Performance posture: local-first speed, keyboard-driven, minimal round trips.

## Brand Commitments

Name: Chibako. Commitment: Obsidian-like, private, self-hosted second brain. No established voice, logo, or palette commitments beyond the current implementation. No binding visual references volunteered during init.

## Evidence on Hand

- Real implementation in repo: `src/app/` (login, setup, `app/note/[id]`, `app/graph`, `app/settings`, `app/agent`, `api/**`), `src/lib/` (db, auth, notes, markdown, api), `src/components/`, `src/mcp/server.ts`; see `README.md`, `AGENTS.md`, `CONTEXT.md`, and `docs/adr/`.
- No testimonials, customers, benchmarks, pricing, licensing, or deployment claims to reuse — future work must not fabricate them.

## Product Principles

1. Private by default — self-hosted, single file, revocable scoped keys; no external service required.
2. Markdown is the API — raw text keeps humans fast and agents token-efficient.
3. Links are first-class — wikilinks, backlinks, and graph are the thinking model, not add-ons.
4. Local-first speed — keyboard-driven, minimal round trips, runs well on a tiny VPS.
5. Agent-native, human-owned — automation extends the vault but never obscures ownership or control.
