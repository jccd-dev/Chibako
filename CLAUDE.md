# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The engineering contract lives in `AGENTS.md` and applies in full: ownership table, architecture boundaries, data invariants, security review, and verification matrix. It is imported here rather than duplicated.

@AGENTS.md

## Commands

```bash
npm install
npm run dev                      # http://localhost:3000; first run needs CHIBAKO_SETUP_TOKEN in .env.local (openssl rand -hex 32)
npm run lint                     # ESLint, --max-warnings 0
npm run typecheck                # next typegen + tsc --noEmit
npm test                         # all Node tests: node --import tsx --test "tests/**/*.test.ts"
node --import tsx --test tests/organization.test.ts          # single test file
node --import tsx --test --test-name-pattern "rename" tests/organization.test.ts  # single test by name
npm run test:e2e -- tests/e2e/auth.spec.ts                   # one Playwright spec (port 3100, temp vault)
npx playwright test -c playwright.finance.config.ts          # finance Playwright config (port 3221)
npm run test:mcp-stdio           # builds dist/mcp/server.mjs, runs stdio smoke tests
npm run mcp:dev                  # run the stdio MCP server from source
npm run build                    # next build + MCP bundle
```

- Both Playwright configs create a throwaway vault in the OS temp dir (override with `CHIBAKO_E2E_DATA_DIR` / `CHIBAKO_FIN_E2E_DATA_DIR`) and use a separate `CHIBAKO_BUILD_DIR`, so they don't touch `./data` or `.next`.
- Docker smoke tests: `bash scripts/smoke-docker.sh`, `bash scripts/smoke-updates-docker.sh` (disposable only).

## Big picture

- **One capability, two transports.** REST lives in `src/app/api/**/route.ts`; MCP tools are registered once in `src/mcp/create-server.ts` and served two ways: remote Streamable HTTP at `src/app/mcp/route.ts` (per-request principal, fresh server/transport) and local stdio at `src/mcp/server.ts`, bundled by esbuild to `dist/mcp/server.mjs`. Both call the same capability functions in `src/features/*` or `src/lib/*`. See ADR-0003 and ADR-0004.
- **The stdio bundle must stay Next-free.** `tests/architecture-boundaries.test.ts` enforces this; portable auth lives in `src/server/auth`.
- **SQLite is the only store.** `src/lib/db.ts` owns the connection, WAL, schema, migrations, and `SCHEMA_VERSION`. Notes, FTS (`notes_fts`), and the materialized `links` table are kept consistent by `src/lib/notes.ts` (single note) and `src/features/organization` (folders/batches).
- **Finance** (`src/features/finance`) is a large, self-contained domain: integer cents via `money.ts`, idempotent mutations with versions and audit records, scope-checked at the capability level (`finance:read|write|manage`). REST routes wrap it with `withFinanceAuth` in `src/app/api/finance`. Protocol-parity tests live in `tests/finance/*-protocol.test.ts`.
- **Embeddings/Recall** (`src/lib/embedding-*.ts`, `src/lib/recall.ts`) are optional, configured by `CHIBAKO_EMBEDDING_*` env vars, and refreshed outside Note writes (ADR-0001/0002).
- **Updates** run through a separate companion process (`updater/`, built by `npm run build:updater`, `Dockerfile.updater`) that owns Docker access, snapshots, and recovery; the app side is `src/features/updates`. Read `docs/UPDATES.md` before touching it.
- **Agent memory plugins**: sources are `scripts/agent-memory.ts`, `skills/`, and `integrations/agent-memory/`; the committed `plugins/` output and plugin version are rebuilt and released after merge by `.github/workflows/plugin-release.yml`. Don't edit `plugins/` or the plugin version in a PR. See `docs/AGENT-MEMORY.md`.
- Domain terms: `GLOSSARY.md`. Product/design intent: `PRODUCT.md`, `DESIGN.md`.
