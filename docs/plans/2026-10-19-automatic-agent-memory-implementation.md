# Automatic agent memory implementation status

Date: 2026-10-19
Status: repository implementation verified; runtime setup drafted, not activated.

Companion to [the proposal](2026-10-19-automatic-agent-memory-proposal.md).
The owner requested implementation without E2E or Playwright, then selected setup
drafts for all three runtimes before activation. Live host/profile targets remain
unconfirmed; private setup details are intentionally outside this public document.

## Delivered

- A `memory:write` capability, restricted to registered records inside an explicitly
  configured non-root area. Existing Notes cannot be adopted by automatic clients.
- Immediate transactional eligibility and content-revision checks, Notes-owned
  persistence, stable retry identities and historical receipts. Session ownership
  derives from authenticated API key and runtime session; canonical wiki,
  preference and overview records are shared. Preference writes require recorded
  confirmation source and scope.
- Bearer-only REST and request-scoped remote/local keyed MCP adapters. Automatic
  clients require an explicit memory scope; existing broad clients retain their
  previous behavior. The owner key-creation API accepts the new scope.
- A private local checkpoint runner: retrieval, agent-authored staging, verified
  saving, later-event retries, conflict-replacement guards, pause and one-shot
  continuation. Resume reloads schema and the saved handoff topic. No transcript
  interception, extraction model or background scheduler was added.
- Separate Codex and Claude hook templates and a Hermes shell-hook adapter with
  an event map and concrete setup procedure in the
  [integration guide](../../integrations/agent-memory/README.md).

## Observed verification

- Full Node suite: 279 passed, 0 failed.
- Focused automatic-memory and architecture checks passed, including capability,
  REST/MCP, runtime-state and child-process hook-envelope coverage. Resume-specific
  assertions were added to the existing runtime test after the full run and passed
  in the focused rerun.
- Typecheck, project lint, explicit lint of new script/adapter files, and standalone
  MCP smoke checks passed.
- Production build passed in an isolated build directory with a disposable vault.
  The sandbox denied localhost binding on the first suite run; the permitted retry
  passed. A sandboxed build stalled; the isolated retry outside that restriction
  passed. The build emitted the existing warning about an external pnpm lockfile.
- Test vaults and runtime state were temporary and cleaned up. Isolated build
  artifacts remain ignored. No live vault, runtime hooks, keys or deployment
  configuration were changed. E2E and Playwright were not run.

## Remaining pilot work

Review exact live configuration diffs before activation. Identify the actual
Codex host, Hermes gateway/profiles and both Hermes client routes, and Claude
Code/Desktop environments. Verify installed-version support and hook execution,
then test fresh retrieval, autonomous capture, cross-runtime handoff, interruption,
compaction, outage/recovery and pause on those targets.

Hermes's documented `pre_verify` gate applies to edited-code turns. Reliable
missing-checkpoint continuation for research, planning and personal workflows is
not established. Compaction hooks can only flush already-staged data. Claude
Desktop Chat remains instruction-based with bearer connectivity unverified; it
does not inherit Code hooks. Legacy unrestricted Note writers do not gain revision
preconditions from this change.

Real summary quality, model usage, context overhead and latency are still unmeasured.
Broader README, vault schema, AGENTS.md and installable-memory-skill updates remain
deferred until the pilot is proven.
