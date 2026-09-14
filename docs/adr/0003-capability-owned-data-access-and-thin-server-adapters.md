# ADR-0003: Capability-Owned Data Access and Thin Server Adapters

Status: accepted
Date: 2026-09-14

## Context

Chibako has two server adapters: Next.js route handlers and a standalone MCP
stdio server. Some adapters currently know SQLite table names and duplicate
security policy. The broad Notes module also contains folder organization
behavior, while the Note editor contains save-session policy mixed with
presentation.

The repository has one SQLite persistence implementation. Embeddings are
optional and are governed by ADR-0001 and ADR-0002.

## Decision

1. SQLite connection setup, pragmas, and migrations remain in `src/lib/db.ts`.
2. SQL statements and transaction policy live in the deep capability module
   that owns the affected capability and invariants.
3. Next route/page modules and MCP tool modules are transport adapters. They
   authenticate, validate, invoke a capability interface, and format results;
   they do not contain SQL or table knowledge.
4. Portable authorization lives in a Next-free module. Next cookies/navigation
   and MCP environment/stdio behavior remain separate adapters at that seam.
5. Client workflow state with meaningful policy lives in controller modules;
   presentation modules consume their interface.
6. No generic repository interface is introduced unless a second real
   persistence adapter exists.
7. Existing Embedding freshness and whole-note decisions remain governed by
   ADR-0001 and ADR-0002. Embedding refresh remains outside Note writes.

## Consequences

Capability modules become the locality point for SQL, transactions, and
policy. REST and MCP gain parity by calling the same implementation, and the
MCP bundle remains independently runnable without importing Next runtime code.
The first migrations deepen schema and authorization, then organization, then
the Note editor save session. Existing URLs, tool contracts, storage schemas,
Note identities, and user-visible behavior remain stable.

There is no speculative `Repository<T>` layer and no whole-tree `src/lib`
relocation. Sidebar extraction is deferred until the editor controller seam is
proven. Any temporary compatibility re-export is removed after callers migrate
unless it is intentionally retained as a public compatibility decision.
