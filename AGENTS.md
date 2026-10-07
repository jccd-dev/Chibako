# Chibako — Developer Guide (AGENTS.md)

Chibako is a self-hosted, Obsidian-like second brain: Markdown notes with
`[[wikilinks]]`, automatic backlinks, a graph view, and token-efficient AI
agent access via both a REST API and an MCP server.

Chibako is **open source (MIT)** and developed in public — this repository is
public. Never commit secrets or environment-specific values. Production deploy
and host configuration live in the private `chibako-infra` repo, not here.

## Stack
- Next.js (App Router) + React 19 + TypeScript, `output: "standalone"`
- SQLite via `better-sqlite3` — `brain.db` in `CHIBAKO_DATA_DIR` (fallback: `DATA_DIR`, then `./data`), WAL mode
- Tailwind CSS v4, shadcn components built on Base UI, Tiptap rich editor, and `react-markdown` + `rehype-raw` + `rehype-sanitize` for preview
- `d3-force` for the graph view; MCP via `@modelcontextprotocol/sdk`

## Layout
- `src/app/` — pages and thin API route adapters under `app/api/**`
- `src/features/{finance,notes,calendar,graph,agent,settings}/` — feature capabilities and UI; feature components live in each `components/` directory, with rich editor components in `notes/components/editor/`
- `src/features/organization/` owns folder and batch-note operations; `src/features/schema/` owns the knowledge schema.
- `src/server/` — portable authorization, password authentication, and vault setup. `src/lib/` contains the remaining Notes, Markdown, embedding/recall, and shared infrastructure modules.
- `src/components/layout/` — `WorkspaceShell`, `Sidebar`, `TopBar`, `CommandPalette`, and `ShortcutsDialog`
- `src/components/providers/` — `AppearanceProvider`, `ThemeProvider`, and `ChibakoToaster`
- Root `src/components/` — shared `NoteLink`, `ConfirmDialog`, `IconTip`, and icons; `src/components/ui/` contains shadcn/Base UI primitives
- `NoteTabs` belongs to Notes. `DatedNotesCalendar` belongs to Calendar and is also consumed by `NoteClient`.
- `src/lib/db.ts` owns SQLite setup and migrations. Capability modules own their SQL, transactions, and policy; route and MCP modules are thin adapters. See [ADR-0003](docs/adr/0003-capability-owned-data-access-and-thin-server-adapters.md).
- `src/mcp/create-server.ts` creates transport-neutral MCP tools. `src/mcp/server.ts` runs local stdio; the Next adapter exposes stateless Streamable HTTP at `/mcp`. Keep the standalone bundle free of `next/*` imports. See [ADR-0004](docs/adr/0004-dual-mcp-transports.md).
- `data/` — runtime SQLite vault (gitignored)

## Core invariants
- Notes have stable IDs. Titles and folders are editable; the `(folder, title)` pair identifies a note path, and note writes enforce its uniqueness. Wikilinks resolve by title (case-insensitive fallback) or explicit folder/title path. See `src/lib/notes.ts` and `src/lib/markdown.ts`.
- `links` table is a materialized index: rebuild via `reindexLinks(noteId, content)` on every note write. `updateNote` re-points backlinks on rename.
- `notes_fts` (FTS5) stores `id UNINDEXED` so search maps back to notes without rowid assumptions.
- Sessions and API keys are stored in SQLite; API keys are SHA-256 hashed and scoped. Notes, search, schema, and key scopes are defined at `src/app/api/keys/route.ts`; finance scopes are `finance:read`, `finance:write`, and `finance:manage` (`src/features/finance/types.ts`).
- Finance access is capability-owned: use `src/features/finance/` for data access and policy, and keep REST/MCP adapters thin. Finance Note links require finance authorization plus Notes read access; they do not mutate Notes. See [ADR-0003](docs/adr/0003-capability-owned-data-access-and-thin-server-adapters.md).
- The knowledge schema (`AGENTS.md`-format instructions served to agents) lives in `settings.knowledge_schema` and is editable in the UI.

## Commands
- `npm run dev` — dev server on :3000
- `npm run build` — Next build + MCP bundle
- `npm test` — Node test suite (`tests/*.test.ts`)
- `npm run test:mcp-stdio` — builds and smoke-tests local MCP stdio, including finance tools
- `npm run test:e2e` — Playwright browser tests
- `npm run typecheck` — TypeScript check
- `npm run mcp` — run the built local MCP server over stdio (`CHIBAKO_DATA_DIR` + optional `CHIBAKO_API_KEY` env); remote clients use the app's `/mcp` endpoint with a scoped bearer key
- Deploy: source-based self-hosters run `docker compose up -d --build`; release-image self-hosters use `docker-compose.release.yml` with the public GHCR image (nginx terminates TLS). Production uses the private `chibako-infra` repo, which deploys the GHCR image by digest — do not add host/deploy config here.

## Gotchas
- `better-sqlite3` is a native module; it is `serverExternalPackages` and copied wholesale into the Docker runtime image.
- Keep `src/mcp/create-server.ts` transport-neutral and the local MCP bundle free of Next runtime imports; authorization and data access belong in portable capability modules.
- FTS query terms get a `*` prefix-match suffix appended automatically.

## Agent skills

### Issue tracker

Issues and specs are tracked as local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
