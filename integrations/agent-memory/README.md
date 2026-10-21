# Automatic agent memory

The Chibako plugin bundles a standalone Node.js runner, lifecycle hooks, and two
skills: `chibako-memory` and `chibako-memory-setup`. Install it through your
runtime's plugin manager, then configure the connection privately in your terminal.

Start with [INSTALL.md](INSTALL.md) for Claude Code, Codex, and Hermes installation,
setup, controls, and recovery. Installing a package does not prove that its hooks
run in your particular host; verify a fresh session and saved checkpoint.

This page documents the protocol and advanced manual integration. Packaged installs
do not need the environment variables or hook examples below. Do not enable both
manual and packaged hooks for the same runtime profile.

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
model/extraction service. At session start it injects the capped "Now" overview
(`memory_read`, about 450 tokens) and one short instruction, then recall on the first
known request. The schema is fetched only when a checkpoint is requested. The agent
retrieves again on meaningful topic changes. Retrieved content is marked as evidence,
never executable instructions.

PostToolUse and UserPromptSubmit hooks only count activity (no model cost, no
memory calls). A checkpoint is requested once, after at least 4 user turns or 10 tool
calls since the last verified save (`thresholds: { user_turns, tool_calls }` in
`profile.json` overrides). Trivial turns get no request, skip or Stop block. A
verified save, or an explicit skip, restarts the count. The active agent produces the
summary and stages it when requested:

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
    "role": "overview",
    "subject": "Thread name",
    "session_id": "actual-runtime-session-id",
    "title": "Thread name",
    "content": "Concise objective, changes, evidence, unresolved work, checkpoint and next action",
    "expected_revision": null
  },
  "now_line": "<=140 chars status, no brackets"
}
```

Use one overview per thread: `subject` and `title` equal the thread name. For an
existing thread, read it first and pass its revision as `expected_revision`. After the
thread save is verified, the runner upserts `- [[Thread]] — status` into the shared
"Now" overview (newest first, 15 lines, revision-checked; a stale revision is re-read
and merged, and replay adds no duplicate). A failed Now update stays pending and
retries at the next event.

When a checkpoint is due but nothing durable changed, replace `checkpoint` with
`skip: "Nothing durable changed"`. This creates no note. Do not label a turn
end as project completion: implementation, verification, commit and deployment each
retain their own evidence/status.

Staging fsyncs a private checkpoint before trying the write. It reports `saved`
only after validating a successful receipt. Outages leave the same checkpoint for
retry at the next lifecycle event. A pending checkpoint cannot be silently replaced.
After reading and merging a conflicting update, stage the replacement with
`replaces_request_id` equal to the pending identity, a new checkpoint request_id,
and the freshly read expected_revision. No transcript is parsed or stored.

Stop requests a due checkpoint once; its continuation guard prevents loops.
Hermes instead gets a "checkpoint due" note on its next `pre_llm_call` (it also counts
`post_tool_call`). Automatic saves no longer create session Notes. Compaction
and interrupt hooks can only flush data already staged; they cannot summarize lost
context. A crash can lose unstaged work. State locks prevent concurrent hooks on
one host; server transactions coordinate different hosts. A crash can leave a `.lock`
file: stop the associated runtime process, verify it is no longer running, then
remove only that stale lock before retrying. No background daemon is installed.

Metrics on stderr report MCP calls and elapsed milliseconds without checkpoint
content or credentials. Added model usage/context tokens and summary quality still
need real pilot measurement; no cost or reliability claim is made from fixtures.

## Runtime events and verification

| Runtime | Retrieval | Checkpoint request | Flush staged data |
| --- | --- | --- | --- |
| Codex | SessionStart, UserPromptSubmit | Stop, after activity threshold | Stage, Stop, PreCompact, Interrupt |
| Claude Code | SessionStart, UserPromptSubmit | Stop, after activity threshold | Stage, Stop, PreCompact |
| Hermes | pre_llm_call | pre_llm_call; pre_verify for edited-code turns | Stage, on_session_end, agent_loop_stopped, post_compaction |

Packaged plugins register these events. The `*-hooks.example.json` and
`hermes.example.yaml` files are for manual integration only. Preserve unrelated
hooks when editing native settings. Use actual runtime session IDs, never display
names. Ordinary Claude Desktop Chat does not inherit Claude Code hooks; T3 Code
and Hermes gateway routes require their own host verification.

After setup, test the selected runtime:

1. Start a fresh session and confirm the Now briefing loads without a memory prompt.
2. Complete meaningful work and confirm a checkpoint receives a verified save receipt.
3. Resume in another runtime and check the saved status and next action.
4. Check pause, outage/retry, interruption, and compaction behavior.

Compaction and interrupt events flush staged data only; they cannot recover
unstaged work. Repository fixtures verify protocol behavior, not live host hook
execution or model costs. Measure calls, tokens, and latency during your own pilot.
