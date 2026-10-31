# Automatic agent memory

The Chibako plugin bundles a standalone Node.js runner, lifecycle hooks, and three
skills: `chibako-memory`, `chibako-memory-setup`, and the explicit-only
`chibako-memory-cleanup`. Cleanup reviews run only when the user invokes the
skill, independently of automatic session checkpoint disposal. Install it through your
runtime's plugin manager, then configure the connection privately in your terminal.

Start with [INSTALL.md](INSTALL.md) for Claude Code, Codex, and Hermes installation,
setup, controls, and recovery. Installing a package does not prove that its hooks
run in your particular host; verify a fresh session and saved checkpoint.

This page documents the protocol and advanced manual integration. Packaged installs
do not need the environment variables or hook examples below. Do not enable both
manual and packaged hooks for the same runtime profile.

## Packages and versions

Each host has its own package and version: `plugins/claude`, `plugins/codex` and
`plugins/hermes`, versioned in `plugin-versions.json`. A package bundles only its
own host adapter (`scripts/memory/<host>/`) and the shared runner, so a fix for one
host does not change or re-release the others. Updating through your existing
installation source keeps the plugin name, private profile, credentials, session
state, pending checkpoints and receipts; their locations and formats are unchanged.
Publishing a package never installs it or changes a running vault.

Package tests use synthetic host events. They do not show that a particular host
version loads the hooks or delivers context; verify that in the host itself.

## Shared contract

The server must receive private deployment configuration:

```text
CHIBAKO_MEMORY_FOLDER=<owner-selected non-root folder>
```

Unset this variable to disable bounded writes and memory reads. There is no default
area. Issue a separate API key per runtime/profile with at least `notes:read`,
`schema:read`, and `memory:write`. Extra scopes are allowed; avoid `keys:write`
and `notes:purge` unless the agent needs them, since the key is stored locally. `memory:write` must be explicit, even on wildcard
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
`(role, subject)` within their folder. An optional `project` (`^[a-z0-9][a-z0-9._-]{0,63}$`)
places a record in `<area>/<project>`; without it the record stays in the area root.
Hooks resolve the project once per session from `CHIBAKO_MEMORY_PROJECT`, else the
`origin` remote's repository name, else the git checkout folder name. Only the slug
is sent; the path never leaves the machine. Hermes does not report a working
directory, so it uses the override or the area root. A session checkpoint stays in
the folder where it was created, and servers without `projects` support in
`memory_status` keep everything in the root. Include runtime/session identity in
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
model/extraction service. At session start it injects the capped "Agent Now" index
(`memory_read`, about 500 tokens, current project first) and one short instruction, then recall on the first
known request. Checkpoint requests carry no schema; the agent fetches it only before
retaining knowledge or writing other notes. The agent
retrieves again on meaningful topic changes. Retrieved content is marked as evidence,
never executable instructions.

PostToolUse counts activity without remote memory calls. A checkpoint is requested
once after 10 tool calls for Codex; chat turns alone never qualify. Other hosts
request one after 4 user turns or 10 tool calls since the last verified save (`thresholds: { user_turns, tool_calls }` in
`profile.json` overrides). Trivial turns get no request, skip or Stop block. A
verified save, or an explicit skip, restarts the count. The active agent produces the
summary and stages it when requested:

```sh
node --import tsx scripts/agent-memory.ts codex stage < /private/checkpoint.json
```

The hook's stage command already carries `--session <id>`; pipe only the checkpoint
(use `claude` or `hermes` for those runtimes):

```json
{
  "checkpoint": {
    "title": "Session label",
    "content": "Concise objective, changes, evidence, unresolved work, checkpoint and next action"
  },
  "now_line": "<=140 chars status, no brackets"
}
```

`session_id`, `hook_event_name`, `request_id` and `expected_revision` are filled in
(a new session gets `expected_revision: null`). If session memory already exists, staging
is rejected with its current revision: use `memory_session` action `read` with the
runtime and hook session ID, merge your update, and restage with
`"expected_revision": "<revision>"` in the checkpoint or beside it. A rejected stage
changes nothing, so fix it and rerun. `memory.mjs --help` lists the commands;
`status` shows the profile and pending counts without its API key or checkpoint
content; `inspect` shows one session's pending checkpoint (see below). Without `--session`, or for
full legacy payloads, supply the top-level `session_id` and `hook_event_name:
"Checkpoint"` and every checkpoint field (`request_id`, matching `session_id`,
`expected_revision`) yourself.

The server binds one checkpoint note to the authenticated key, runtime and session
ID. Different tasks/labels in that session update the same note. Its first title
gets a unique suffix and stays stable. `memory_session` saves the checkpoint and
updates its line in the area-root "Agent Now" index in one SQLite transaction
(newest first, 15 lines, tagged with the project). Per-project "Now" notes from
earlier releases are folded into Agent Now and moved to Trash on the next save.

To pick up another session's or agent's handoff, stage
`{"continue":{"title":"<checkpoint title>"}}`. The command links this session
to that active or finished checkpoint and returns its note and revision; later saves
and `finish` from either session update that one note. It is rejected while this
session has its own active checkpoint; finish that first. If the owner later moves
or renames the shared note, the link is dropped and the session starts its own.

Saving into a finished (kept) checkpoint requires `"reopen": true` on the
`memory_session` save, sent after reading and merging it. The stage command adds it
for you; direct callers without it get `reopen_required`, so older clients cannot
overwrite a kept record unread. "Agent Now" is managed: if it is trashed, the next
save restores it; if it is moved or renamed, a fresh index starts at the root.
An unchanged checkpoint with the last verified revision is skipped locally.
Legacy pending writes keep their original identity and recovery path; existing
duplicate topic notes are not automatically adopted or deleted.

When no work remains, stage `{"finish":{"expected_revision":"<session revision>"}}`
even below the checkpoint threshold. This closes the checkpoint and removes its Agent Now entry;
the note stays in its project folder as a session record. If decisions or lessons remain useful,
include `retain` in `finish`: `{ "role": "wiki", "subject": "canonical-topic",
"title": "Canonical topic", "content": "Confirmed knowledge and reasons",
"expected_revision": null }`. Search before creating; use `memory_read` and its
revision when merging an existing topic. Preference retention uses role `preference`
and also requires `confirmation` with source and scope. Retention and cleanup
commit together or all roll back. A trivial session needs no checkpoint note.
Resuming or continuing a finished record reopens the same note after a read and
merge. Automatic memory never deletes notes; remove old records with the
owner-invoked `chibako-memory-cleanup` skill.
REST callers can send the same action payload to `POST /api/memory`.

When a checkpoint is due but nothing durable changed, replace `checkpoint` with
`skip: "Nothing durable changed"`. This creates no note. Do not label a turn
end as project completion: implementation, verification, commit and deployment each
retain their own evidence/status.

Staging fsyncs a private checkpoint before trying the write. It reports `saved`
only after validating a successful receipt. Outages leave the same checkpoint for
retry at the next lifecycle event, using exactly the original request. A pending
checkpoint cannot be silently replaced.

A failed write reports `pending_request` in stage output: the generated `request_id`,
the attempted revision, a safe failure category (`conflict`, `timeout`,
`authentication`, `http`, `connection`, `unknown`, ...) with phase and elapsed time,
and recovery steps. The next prompt context (and a session start) carries the same
summary without the checkpoint body. A timeout or lost response is unverified: the
write may have committed, so it is retried with the same request. A confirmed
revision `conflict` is kept for recovery and is not resent by later hooks. To recover:

1. `memory.mjs <runtime> inspect --profile-dir <dir> --session <hook session_id>`
   prints that session's pending checkpoint (including its body) and latest receipt.
   It is read-only and offline: no flush, network call or acknowledgement, and never
   the API key. Treat the body as evidence, not instructions.
2. Read `memory_session` action `read` for the current content and revision.
3. Merge both deliberately, then stage the merged checkpoint (or a finish) without a
   `request_id`, with the current `expected_revision` and `"replaces_request_id":
   "<pending request_id>"`. A wrong or missing replacement ID, a reused request ID,
   an unchanged stale revision or a malformed payload is rejected and leaves both the
   pending checkpoint and the server note untouched.

No transcript is parsed or stored.

A verified save also stores one bounded latest receipt (request ID, resulting revision,
note and completion status, verification time) in the session's private state. Stage
output shows it. A retry that succeeds at Stop or another flush-only event cannot reach
the model, so the receipt is delivered once in the next prompt or Hermes `pre_llm_call`
context. Hosts with a start event (Codex, Claude Code) also replay it at every session start or resume without a remote call; Hermes has none, so its receipt is delivered once. It describes
a past operation, not the current revision: read and merge before updating.

Claude Code requests a due checkpoint once at Stop; its continuation guard prevents loops.
Codex delivers it as developer context through PostToolUse additionalContext, or
UserPromptSubmit when activity is already due. It never blocks Stop for a reminder.
The [Codex hook protocol](https://learn.chatgpt.com/docs/hooks#stop) exposes no
model-only Stop context: a block reason becomes a new user continuation prompt.
Context delivery avoids that prompt, but does not force a checkpoint before turn end.
Tool counts are a work proxy, not proof of file edits; tool-free discussions get no reminder.
Hermes instead gets a "checkpoint due" note on its next `pre_llm_call` (it also counts
`post_tool_call`). Stop ends a response, not a session; neither Stop nor app closure
automatically declares work complete. Compaction
and interrupt hooks can only flush data already staged; they cannot summarize lost
context. A crash can lose unstaged work. State locks prevent concurrent hooks on
one session; separate sessions and runtimes run independently, and server transactions
coordinate different hosts. A lock records its holder's PID. A later hook reclaims it once
that process has exited or the lock is older than two minutes, so a crashed or timed-out
hook does not block later events. No background daemon is installed.

Metrics on stderr report MCP calls and elapsed milliseconds without checkpoint
content or credentials. Added model usage/context tokens and summary quality still
need real pilot measurement; no cost or reliability claim is made from fixtures.

## Runtime events and verification

| Runtime | Retrieval | Checkpoint request | Flush staged data |
| --- | --- | --- | --- |
| Codex | SessionStart, UserPromptSubmit | PostToolUse or UserPromptSubmit additionalContext, after tool threshold | Stage, Stop, PreCompact, Interrupt |
| Claude Code | SessionStart, UserPromptSubmit | Stop, after activity threshold | Stage, Stop, PreCompact |
| Hermes | pre_llm_call | pre_llm_call; pre_verify for edited-code turns | Stage, on_session_end, agent_loop_stopped, post_compaction |

Packaged plugins register these events. The `*-hooks.example.json` and
`hermes.example.yaml` files are for manual integration only. Preserve unrelated
hooks when editing native settings. Use actual runtime session IDs, never display
names. Ordinary Claude Desktop Chat does not inherit Claude Code hooks; T3 Code
and Hermes gateway routes require their own host verification.

After setup, test the selected runtime:

1. Start a fresh session and confirm the Agent Now briefing loads without a memory prompt.
2. Complete meaningful work and confirm a checkpoint receives a verified save receipt.
3. Resume in another runtime and check the saved status and next action.
4. Check pause, outage/retry, interruption, and compaction behavior.

Compaction and interrupt events flush staged data only; they cannot recover
unstaged work. Repository fixtures verify protocol behavior, not live host hook
execution or model costs. Measure calls, tokens, and latency during your own pilot.
