# ADR-0004: Local and Remote MCP Transports

Status: accepted
Date: 2026-09-18

## Context

Chibako's MCP server currently runs only as a local stdio process with
process-wide authorization. That is simple for a same-host agent, but a normal
Docker/VPS deployment forces remote users to understand SSH, container paths,
and the server filesystem. Exposing a hosted MCP endpoint introduces concurrent
clients and makes process-global credentials unsafe.

## Decision

Chibako supports two adapters over one transport-neutral MCP tool factory:
local stdio for same-host use and stateless Streamable HTTP at `/mcp` for remote
use. The HTTP adapter creates a fresh server and transport per request, requires
a scoped bearer API key, and supplies the authenticated principal as
request-scoped context. It never changes process environment variables to
select a caller. The initial remote transport returns JSON responses and does
not maintain sessions, SSE streams, or resumability.

Remote MCP uses the existing Chibako origin, API-key store, capability modules,
and SQLite Vault. OAuth 2.1 remains a later authentication adapter behind the
same request-principal boundary; this decision does not make Chibako an OAuth
authorization server.

## Considered Options

- SSH-wrapped stdio was rejected as the primary remote experience because it
  exposes deployment details and requires shell access.
- A separate MCP container or public port was rejected because it duplicates
  deployment, TLS, authorization, and Vault coordination.
- Stateful Streamable HTTP was deferred because current tools need neither
  server notifications nor cross-request session state.

## Consequences

Remote clients configure one HTTPS URL and one scoped key. Local stdio remains
available and may retain full local access when no key is configured. Every
remote request is independently authenticated and isolated. OAuth, resumable
sessions, browser CORS, and public plugin distribution require separate future
decisions.
