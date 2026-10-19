# Automatic agent memory pilot

Status: repository implementation and standalone plugin packages. Live hooks are **not activated**.

For the packaged setup wizard and controls, follow [INSTALL.md](INSTALL.md). The
environment-only commands below document the earlier manual pilot workflow.
The owner selected a new top-level private memory area and preparation of all three
runtimes before activation. No personal endpoints, credentials or host paths belong
in this public directory.

## Shared contract

The server must receive private deployment configuration:

```text
CHIBAKO_MEMORY_FOLDER=<owner-selected non-root folder>
```

Unset this variable to disable bounded writes and memory reads. There is no default
area. Issue a separate API key per runtime/profile with exactly `notes:read`,
`schema:read`, and `memory:write`. Do not add `notes:write`, purge, schema-write,
key-management or Finance scopes. `memory:write` must be explicit, even on wildcard
keys. Existing keys are not upgraded. The existing owner-only key creation API
accepts the new scope; no settings UI changes are required for this pilot.

Use the existing Chibako MCP URL and the restricted key in each runtime's private
environment:

```text
CHIBAKO_MEMORY_ENABLED=1
CHIBAKO_MEMORY_MCP_URL=https://your-chibako.example/mcp
CHIBAKO_MEMORY_API_KEY=<restricted key from private secret storage>
CHIBAKO_MEMORY_STATE_DIR=/private/runtime-owned/memory-state
```

Each runtime/profile gets a different state directory, owned by its runtime user
with mode `0700`. Files are `0600`. Do not place pending checkpoints in the public
repository or a shared temporary directory. Set `CHIBAKO_MEMORY_ENABLED=0` to pause
both retrieval and saving, including pending retries. Re-enabling retries retained
checkpoints at the next hook. Disabling the server alone prevents writes but does
not stop clients from attempting retrieval; pause each runtime too.

`memory_write` / `POST /api/memory` accepts:

```json
{
  "request_id": "stable-checkpoint-id",
  "role": "session",
  "subject": "project/topic",
  "session_id": "actual-runtime-session-id",
  "title": "Runtime session topic (unique title)",
  "content": "# Objective\n...\n## Changes\n...\n## Evidence\n...\n## Unresolved work\n...\n## Last checkpoint\n...\n## Next action\n...",
  "expected_revision": null
}
```

Roles are `session`, `wiki`, `preference`, `overview`. Preferences additionally
require `confirmation: {source, scope}` from an explicit user statement. Confirmation
is recorded alongside the write receipt. The service validates provenance fields;
it cannot determine whether the author's claim is truthful.

Session identity is `(API key, runtime session, subject)`; shared records use
`(role, subject)` within the configured area. Include runtime/session identity in
session titles to avoid collisions. Use a stable topic name for a shared canonical
wiki. Overview content links the current session handoffs; do not duplicate their
state into separate handoff notes. Search before choosing canonical subjects.

`memory_read` / `GET /api/memory?role=wiki&subject=project&session_id=runtime-session`
returns a registered note plus revision, or null. Both `memory:write` and
`notes:read` are required. Normal recall/read finds other sessions' handoffs.
Expected revision is mandatory: null for creation, the current memory_read revision
for updates. Session titles and locations cannot change automatically. Existing
source notes, including notes already inside the area, cannot be adopted by these
APIs. Registration is separate from editable frontmatter and Note kind.

The eligibility check, content comparison, Notes write and retry receipt share an
immediate SQLite transaction. Existing Notes persistence maintains FTS, links and
embedding freshness. Hash revisions cover the current Note content and relevant
metadata rather than second-resolution timestamps. This does not add concurrency
control to legacy manual or unrestricted Note writes.

Same request + same payload returns the historical receipt, even after later edits;
this proves that checkpoint was saved, not that it is still current. Reusing an ID
with different content is rejected. A stale revision returns `revision_conflict`;
read current memory, merge supported contributions, and use a new request identity.
Never resend an old body with a newly copied revision. Save an unresolved wiki
contribution in its session record; a wiki failure does not undo a saved session.

## Hook runner and staging

Run from this checkout with its existing Node dependencies installed. Use an
absolute script path and an approved working directory in installed hook commands.
The runner reuses the configured Chibako endpoint over the MCP SDK; it adds no
model/extraction service. It loads schema at startup and recall on the first known
request, not on every tool call. The agent retrieves again on meaningful topic
changes. Retrieved content is marked as evidence, never executable instructions.

The active agent produces the summary. It stages during work and before finishing:

```sh
node --import tsx scripts/agent-memory.ts codex stage < /private/checkpoint.json
```

The private input is this envelope (use `claude` or `hermes` for those runtimes):

```json
{
  "session_id": "actual-runtime-session-id",
  "hook_event_name": "Checkpoint",
  "checkpoint": {
    "request_id": "stable-checkpoint-id",
    "role": "session",
    "subject": "project/topic",
    "session_id": "actual-runtime-session-id",
    "title": "Runtime session topic (unique title)",
    "content": "Concise objective, changes, evidence, unresolved work, checkpoint and next action",
    "expected_revision": null
  }
}
```

For a turn with no durable change, replace `checkpoint` with `skip: "Nothing durable
changed"`. This acknowledges the turn without creating a note. Do not label a turn
end as project completion: implementation, verification, commit and deployment each
retain their own evidence/status.

Staging fsyncs a private checkpoint before trying the write. It reports `saved`
only after validating a successful receipt. Outages leave the same checkpoint for
retry at the next lifecycle event. A pending checkpoint cannot be silently replaced.
After reading and merging a conflicting update, stage the replacement with
`replaces_request_id` equal to the pending identity, a new checkpoint request_id,
and the freshly read expected_revision. No transcript is parsed or stored.

Stop requests a missing checkpoint once per turn; its continuation guard prevents
loops. A skip is explicit, so trivial work does not produce session Notes. Compaction
and interrupt hooks can only flush data already staged; they cannot summarize lost
context. A crash can lose unstaged work. State locks prevent concurrent hooks on
one host; server transactions coordinate different hosts. A crash can leave a `.lock`
file: stop the associated runtime process, verify it is no longer running, then
remove only that stale lock before retrying. No background daemon is installed.

Metrics on stderr report MCP calls and elapsed milliseconds without checkpoint
content or credentials. Added model usage/context tokens and summary quality still
need real pilot measurement; no cost or reliability claim is made from fixtures.

## Setup drafts and event map

Sources checked 2026-10-19: [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Hermes hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks),
[Claude Code hooks](https://code.claude.com/docs/en/hooks).
Local read-only inventory found Codex CLI 0.163.0 and Claude Code 2.1.226.
The Hermes wrapper could not report a version because its install lock is not
writable. Local source exposes plugin hooks, but this does not identify the remote
gateway version or prove either gateway client uses that installation.

| Surface | Retrieval | Capture request | Flush | Actual-host status |
| --- | --- | --- | --- | --- |
| Codex CLI / desktop host | SessionStart, UserPromptSubmit | Stop continuation once | Stage, Stop, PreCompact, Interrupt | Draft; host execution unverified |
| Claude Code CLI / Desktop Code | SessionStart, UserPromptSubmit | Stop continuation once | Stage, Stop, PreCompact | Draft; both environments unverified |
| Hermes messaging + desktop | pre_llm_call shell hook | pre_verify continuation once | Stage, on_session_end, agent_loop_stopped, post_compaction | Requires gateway/profile/version and both routes |
| Claude Desktop Chat | Connected MCP + explicit instructions | No equivalent lifecycle established | Agent tool call only | Instruction-based; bearer connectivity unverified |

Merge `codex-hooks.example.json` into the selected private Codex hook configuration,
preserving existing hooks. It currently contains unrelated Impeccable hooks; do not
replace the whole file. For Claude Code merge `claude-hooks.example.json` into private Claude Code settings.
It uses the Claude runtime identity and omits Interrupt (no equivalent established). Confirm each exact host's supported
hook output and permissions before activation. T3 Code is a separate host check.

For Hermes, merge `hermes.example.yaml` into the selected private profile and use
`hermes-hook.ts` as its envelope adapter. Official documentation supports shell-hook
context injection and pre_verify continuation. This remains a draft until the actual
gateway version, consent, profile separation and both client routes are verified.
The installed local source describes `pre_verify` as a coding gate. Its coverage
for research, planning and personal workflows is unproven: those turns depend on
normal agent staging, with no reliable missing-checkpoint continuation established.
Compaction is post-event best effort; it cannot recover unstaged pre-compaction work.
Use actual runtime session IDs, never display names. Do not install both shell hooks
and gateway directory hooks for the same capture events. If a target lacks this
shell-hook API, report unsupported automatic capture; use instruction-based MCP
capture temporarily rather than intercepting transcripts or adding another service.

Claude Desktop Chat uses scoped bearer connectivity, while Chibako currently does
not implement OAuth. Verify the client's available authentication path before
calling it connected. Ordinary chat does not inherit Code hooks.

## Activation review and verification

Before editing live configuration, present the exact server deployment, Codex host,
Hermes gateway/profile, Claude environments, runtime state paths and config diffs.
The owner selected preparation of all three, not activation. Endpoint secrets and
production deployment configuration stay in the private infrastructure repository.

Repository tests use disposable vaults and mocked runtime calls. Verify capability
and transport rejection, replay identities, revision conflicts, private pending
retention, pause and continuation guards. Then, once live setup is authorized:

1. Start a fresh session and prove schema/briefing injection without a memory prompt.
2. Complete substantive work and prove a verified checkpoint without a save prompt.
3. Resume it in another runtime; verify evidence, unfinished status and next action.
4. Test interruption, compaction, repeated events, outage/recovery and pause.
5. Confirm both Hermes client routes share gateway policy without duplicate capture.
6. Record actual calls, tokens, latency, skipped/failed checks and Chat limitations.

No E2E or Playwright runs were authorized for the implementation session. Runtime
pilot checks and activation remain pending. Broad README, vault-schema, AGENTS.md
and installable-skill changes remain deferred until the pilot proves the behavior.
