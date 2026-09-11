# Chibako — Developer Guide (AGENTS.md)

Chibako is a self-hosted, Obsidian-like second brain: Markdown notes with
`[[wikilinks]]`, automatic backlinks, a graph view, and token-efficient AI
agent access via both a REST API and an MCP server.

Chibako is **open source (MIT)** and developed in public — this repository is
public. Never commit secrets or environment-specific values. Production deploy
and host configuration live in the private `chibako-infra` repo, not here.

## Stack
- Next.js (App Router) + React 19 + TypeScript, `output: "standalone"`
- SQLite via `better-sqlite3` — single file at `DATA_DIR/brain.db`, WAL mode
- Tailwind CSS v4, `react-markdown` + `rehype-raw` + `rehype-sanitize` for preview
- `d3-force` for the graph view
- MCP server: `@modelcontextprotocol/sdk`, bundled with esbuild to `dist/mcp/server.mjs`

## Layout
- `src/app/` — pages (`login`, `setup`, `app/note/[id]`, `app/graph`, `app/settings`, `app/agent`) and API route handlers under `app/api/**`
- `src/lib/` — DB (`db.ts`), auth (`auth.ts`), notes engine (`notes.ts`), markdown/wikilink parsing (`markdown.ts`), API auth wrapper (`api.ts`)
- `src/components/` — client components (sidebar, editor, preview, graph, settings, agent guide)
- `src/mcp/server.ts` — MCP stdio server (do NOT import `next/*` code here; it must run standalone)
- `data/` — runtime SQLite vault (gitignored)

## Core invariants
- Notes are plain Markdown. Title is the primary identity; wikilinks resolve by title.
- `links` table is a materialized index: rebuild via `reindexLinks(noteId, content)` on every note write. `updateNote` re-points backlinks on rename.
- `notes_fts` (FTS5) stores `id UNINDEXED` so search maps back to notes without rowid assumptions.
- Sessions and API keys are stored in SQLite; API keys are SHA-256 hashed, scoped (`notes:read`, `notes:write`, `search:read`, `schema:read`, `schema:write`, `keys:read`, `keys:write`).
- The knowledge schema (`AGENTS.md`-format instructions served to agents) lives in `settings.knowledge_schema` and is editable in the UI.

## Commands
- `npm run dev` — dev server on :3000
- `npm run build` — Next build + MCP bundle
- `npm run mcp` — run MCP server over stdio (`CHIBAKO_DATA_DIR` + optional `CHIBAKO_API_KEY` env)
- Deploy: self-hosters run `docker compose up -d` (nginx terminates TLS). Production uses the private `chibako-infra` repo, which deploys the GHCR image by digest — do not add host/deploy config here.

## Gotchas
- `better-sqlite3` is a native module; it is `serverExternalPackages` and copied wholesale into the Docker runtime image.
- The MCP server bundle must not import `next/headers` or `@/lib/api`/`@/lib/auth` (those pull in Next runtime). It uses `@/lib/db`, `@/lib/notes`, `@/lib/markdown` only.
- FTS query terms get a `*` prefix-match suffix appended automatically.