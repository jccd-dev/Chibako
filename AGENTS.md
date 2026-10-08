# Chibako — Engineering Contract

Chibako is a self-hosted Markdown knowledge vault with wikilinks, backlinks, graph navigation, finance, REST, and MCP access. This MIT repository is public. Keep secrets, private vault data, personal paths, and production host configuration out of committed files. Production deployment belongs in the private `chibako-infra` repository.

## Before changing code

- Inspect the working tree, relevant callers, owning capability, and existing tests. Identify the requested behavior and affected boundaries before editing.
- For architectural changes, read [ADR-0003](docs/adr/0003-capability-owned-data-access-and-thin-server-adapters.md). For MCP/auth transport changes, also read [ADR-0004](docs/adr/0004-dual-mcp-transports.md). For embeddings/Recall changes, read [ADR-0001](docs/adr/0001-embedding-freshness-strategy.md) and [ADR-0002](docs/adr/0002-whole-note-remote-embeddings-mvp.md).
- For domain terminology, follow [domain guidance](docs/agents/domain.md) and `CONTEXT.md` when present. For requested tickets/specs, follow [the local issue tracker](docs/agents/issue-tracker.md) and [triage labels](docs/agents/triage-labels.md).
- Apply these rules to new code and the responsibility being changed. Existing violations are not permission to spread them. Keep broader cleanup separate unless required for the requested behavior.

## Stack and file ownership

Use the existing Next.js App Router, React 19, TypeScript strict mode, SQLite/`better-sqlite3`, Tailwind v4, Base UI/shadcn, Tiptap, and MCP SDK stack. Use npm and the existing lockfile. `package.json` and configuration files are the source of truth for versions and scripts.

| Location                                      | Responsibility                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/app/`                                    | Routes, pages, Next-specific request adapters, and composition                      |
| `src/features/<feature>/`                     | Feature operations, SQL, policy, validation/types, and client workflows             |
| `src/features/<feature>/components/`          | Feature UI; Notes editor UI lives under `notes/components/editor/`                  |
| `src/server/`                                 | Portable authorization, password authentication, and vault setup                    |
| `src/lib/`                                    | Existing Notes/Markdown/embedding/Recall owners and genuinely shared infrastructure |
| `src/lib/db.ts`                               | SQLite connection, pragmas, schema setup, and migrations                            |
| `src/mcp/`                                    | Transport-neutral tool registration and the local stdio entry                       |
| `src/components/layout/`, `providers/`, `ui/` | Shared shell, providers, and UI primitives                                          |
| `tests/`, `tests/e2e/`                        | Node tests and Playwright user flows                                                |

- Put new feature code with its owner. Shared UI belongs in `src/components/` when multiple features actually consume it. Feature-specific helpers stay with that feature.
- Notes persistence remains in `src/lib/notes.ts`; folder and batch operations belong in `features/organization`; knowledge-schema operations belong in `features/schema`. Preserve existing owners rather than relocating `src/lib` wholesale.
- Use another feature's exported capability when needed, without coupling to its component internals or private workflow state. Avoid circular dependencies. A separate interface file or barrel export is not required.
- Use PascalCase component filenames and kebab-case new non-component modules. Follow established naming in an existing module group; keep naming-only migrations outside feature work.

## Architecture boundaries

- HTTP and MCP adapters authenticate, validate transport input, invoke an owning capability, and format results. SQL, table knowledge, transactions, and domain policy belong in capabilities.
- Keep portable capabilities independent of Next request/cookie/navigation APIs. Client imports must not pull database access or secrets into the browser.
- Shared operations called by REST and MCP must use the same business rules and authorization policy. Preserve capability-level finance authorization even when an HTTP adapter checks a scope.
- Remote `/mcp` authenticates every request and supplies a request-scoped principal to a fresh server/transport. Never change process environment variables to select a remote caller. Preserve the explicitly trusted local stdio mode.
- The stdio import graph must remain free of `next/*` and Next-only auth/request adapters. Preserve `tests/architecture-boundaries.test.ts` and the independently runnable MCP bundle.
- Keep meaningful client workflow policy in the owning hook/controller. Components consume that interface and handle presentation. Reuse the existing Notes editor-session controller for save policy.
- Use direct capability functions and SQLite transactions. Add repository interfaces, factories, or additional infrastructure only when a real requirement needs them.

## Code quality and growth

- Use 2-space indentation, double quotes, and semicolons in TypeScript, matching existing code. Use camelCase values/functions and PascalCase React components/types. Prefer `import type` for type-only imports.
- Infer local types; define contracts at exported capability and transport boundaries. Validate untrusted values with existing Zod schemas or focused guards. Restrict casts to justified integration boundaries; a cast is not validation.
- Keep functions focused on one operation. Separate parsing, policy, persistence, and presentation when a change would mix independently changing responsibilities. Extract cohesive behavior, not arbitrary chunks of lines.
- Review touched handwritten files above 300 lines and functions above 60 lines for mixed responsibilities. These are review triggers, not hard limits. If a large unit remains cohesive, explain that briefly; migrations, registration tables, and generated code are not split for size alone.
- When extending a large mixed component such as `NoteClient` or `Sidebar`, prefer the existing controller/hook seam or extract the touched workflow. Avoid adding another unrelated workflow to the component.
- Keep React state minimal, respect hook dependencies, clean up subscriptions/timers, and handle stale async responses. Preserve unsaved edits and editor-session behavior across navigation and refreshes.
- Use existing errors and client response handling; surface actionable failures instead of silently swallowing them. Keep comments concise and remove obsolete compatibility code after callers migrate unless compatibility is intentional.

## Data invariants

- SQLite uses WAL. The vault path is `CHIBAKO_DATA_DIR`, then `DATA_DIR`, then `./data`. Treat existing vaults as user data; test against a confirmed local/disposable target.
- Notes retain stable IDs and unique `(folder, title)` paths. Preserve title/path wikilink resolution, rename backlink rewrites, and materialized `links` rebuilding on content writes.
- Keep Notes, FTS, links, and related metadata consistent during single-note, folder, and batch operations. `notes_fts.id` is the Note identity; do not infer it from an FTS rowid. Preserve safe FTS query construction and prefix matching.
- Embeddings remain optional and best-effort, outside successful Note writes. Preserve content-hash freshness and the existing whole-note remote-provider decision.
- Finance uses exact integer cents and existing money helpers. Preserve mutation idempotency, version/conflict checks, audit records, and atomic multi-record operations. Do not silently round or overwrite a concurrent edit.
- Finance Note links need both applicable finance authorization and Notes read access; they do not mutate Notes. Creating a linked obligation while posting cash needs both `finance:manage` and `finance:write`.
- Keep migrations compatible with existing vaults. For a requested destructive migration, explain its impact and recovery plan before applying it to user data. Keep remote calls outside SQLite transactions.

## Security review

For changed authentication, authorization, API/MCP, upload, Markdown, provider, or finance code, inspect the relevant trust boundaries:

- Authenticate at the transport and authorize each operation/resource using existing policy. Preserve scoped keys, session expiry/revocation, password hashing, and login rate limits. Derive actor identity from authenticated context.
- Validate IDs, amounts, dates, paths, payload sizes, and enums before side effects. Use parameterized SQL values; allowlist any dynamic SQL identifiers.
- Preserve cookie protections and existing origin/CSRF controls for browser mutations. Keep credentials and private content out of client bundles, logs, error payloads, and committed fixtures.
- Keep Markdown sanitization after raw HTML processing; validate link/image protocols. For file or provider changes, check path containment, upload limits, and untrusted URL handling.
- Verify denied and malformed requests cause no partial writes or unintended disclosure. Test cross-transport policy parity when shared security rules change. Dependency/image scans supplement this review.

## Verification and completion

Use `test-scope-triage` for code changes before deciding whether to add/change tests. Use existing focused coverage first; add a regression test when it covers a behavior gap.

| Change                                              | Relevant verification                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TypeScript code                                     | `npm run typecheck` plus focused Node tests for affected behavior                                |
| Capability ownership/import boundaries              | `node --import tsx --test tests/architecture-boundaries.test.ts`                                 |
| Data/auth/finance mutations                         | Isolated tests for success, rejection, atomicity, and relevant replay/conflict behavior          |
| MCP factory or its dependency graph                 | Relevant protocol tests and `npm run test:mcp-stdio`                                             |
| User-visible behavior                               | Relevant Playwright flow via `npm run test:e2e -- <spec>`; interactive checks for uncovered gaps |
| Framework, packaging, or cross-boundary integration | `npm run build` in a test build directory with an isolated vault when data access is possible    |
| Documentation only                                  | Check links, command accuracy, consistency, and the final diff; no runtime/browser suite         |

- Before a code PR or merge, run the full `npm test` suite and typecheck, plus change-specific checks above. Inspect test environment/configuration before executing data-writing checks.
- Confirm browser targets are local/disposable and respect their data/build directories. The existing finance Playwright config is available when applicable. Report persistent fixtures and exact blockers; do not substitute production.
- `npm run lint` currently invokes removed `next lint`, and no working lint configuration is present. Report this tooling gap until a separately authorized tooling change establishes a passing lint gate; never report lint as passed or silently disable checks.
- Review the final diff for scope, architecture, security, data integrity, and consistency with relevant ADRs. Fix material findings caused by the change. Report changes, checks/results, and remaining risks or pending verification.

## Code Review Rules

- Flag SQL or business policy added to transport adapters, Next imports introduced into portable MCP dependencies, and client imports of server data/secrets. Route the behavior through its owning capability.
- Flag bypassed capability authorization, changed scope semantics, partial mutations, stale-version overwrites, and broken Notes/FTS/link consistency. Preserve the existing policy and transaction boundary.
- Flag unrelated responsibilities added to already mixed components and duplicated workflow policy. Prefer a cohesive extraction at the touched seam.
- Reserve mechanical formatting/lint enforcement for tooling once configured. Report concrete correctness and security risks with locations; file length alone is not a defect.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
