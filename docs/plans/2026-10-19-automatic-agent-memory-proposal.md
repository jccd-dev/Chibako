# Automatic shared agent memory

Date: 2026-10-19
Status: proposal for review; implementation and runtime setup have not started.

## Outcome and agreed scope

Connected agents retrieve relevant context and maintain useful knowledge without
the owner repeating a memory instruction. The workflow covers substantive project
work, research, planning, and personal workflows.

The selected approach combines shared instructions with runtime hooks. Initial
clients are Codex, Hermes, and Claude. Hermes runs through a remote gateway used
by messaging and desktop clients. Claude Code and ordinary Claude Desktop chat
need separate compatibility checks.

The owner selected automatic maintenance of session records, handoffs, wiki
notes, and confirmed preferences. Original source notes remain protected. This
selection defines the intended behavior; this proposal does not activate hooks,
grant new API scopes, or authorize unrelated operations.

Success means a fresh agent can find the relevant current state, explain its
evidence, and resume unfinished work without being told to check or save memory.

## What already exists

- Notes, wikilinks, a raw/wiki/output convention, keyword recall, optional vector
  recall, and local and remote MCP access.
- Note creation and updates, plus a separate observation log. Recall searches
  Notes; recent observations require a separate call.
- A memory skill describing retrieval and authorized saving. Installing it does
  not establish lifecycle triggers.
- Note writes maintain FTS and links through the existing Notes owner.

Source boundaries: [Notes](../../src/lib/notes.ts),
[Recall](../../src/lib/recall.ts),
[MCP tools](../../src/mcp/create-server.ts),
[API-key authorization](../../src/server/auth/api-key-authorization.ts), and
[the installable memory skill](../../skills/chibako-memory/SKILL.md).

Two application gaps affect automatic writes: Note updates have no optimistic
concurrency precondition, and the existing `notes:write` scope also allows
changing source notes and moving Notes to Trash. Instructions alone cannot
enforce the proposed write boundary.

## Proposed design

### One contract, small runtime integrations

Keep Chibako as the canonical store. Each runtime integration translates its
supported events into the same retrieval and capture workflow. Reuse existing
REST/MCP authentication and capability boundaries; introduce no separate memory
server, transcript database, or scheduler for the pilot.

Hooks determine when work is considered for capture. The agent supplies the
meaning and evidence. A successful hook invocation is not proof of a useful
summary or a successful save. Each integration must verify the resulting write.

Start with the active agent producing structured checkpoints as part of its
normal work. Use supported hook control to request a missing checkpoint without
a new instruction from the owner. Where a runtime cannot do this, report the
gap rather than treating a reminder as reliable automatic capture. A separate
model-based extraction pass is a later design choice if the pilot requires it;
it would add usage and must be measured before adoption.

### Knowledge and ownership

- Session record: one stable record per runtime session and topic, owned by that
  session. Include the objective, useful changes, evidence, unresolved work,
  last checkpoint, and next action. Create it only for substantive work.
- Handoff: keep the resumable state in the session record instead of copying
  the same state into a second note. A project overview links active handoffs.
- Wiki: maintain one authoritative explanation per subject, with links to the
  supporting session records and external evidence.
- Preferences: save explicit statements or user-confirmed preferences. Record
  the confirmation source and scope; a behavioral inference is not confirmation.

Use an owner-selected agent-memory area for the pilot. Membership in that area
and an established memory role determine automatic write eligibility; a `wiki`
kind or `layer` value alone does not grant permission to alter an existing note.
Existing source notes can be read and linked without changing their body,
properties, location, or title. Existing canonical pages outside the approved
area require explicit adoption before automatic maintenance.

Choose the actual pilot destination during setup. Folder paths, endpoints,
credentials, agent identities, and host configuration remain private deployment
configuration, outside this public repository.

### Retrieval and capture triggers

At startup or resume, load the knowledge schema and a small relevant briefing.
When the task is not yet known, defer task-specific retrieval until the first
request. Retrieve again on a meaningful topic change, not on every tool call.

During substantive work, checkpoint a confirmed decision, useful discovery,
completed verification, blocker, or change in next action. Record progress before
the end of a long turn when possible. Before context compaction and on supported
interrupt events, flush available checkpoint data; these events cannot recover
work that was never captured.

At a meaningful milestone or completed turn, save changed knowledge and update
affected wiki notes. Skip a write when nothing durable or resumable changed.
Do not interpret a turn-ending event as project completion. Implementation,
verification, committing, and deployment retain separate statuses.

Use event identities and a guard around memory operations to avoid recursive
capture and repeated stop-hook continuations. Small talk and trivial lookups
produce no session note unless they establish reusable knowledge.

### Bounded automatic writes

Propose a dedicated `memory:write` scope and a narrow capability for automatic
memory writes. This scope does not exist today. The capability validates the
approved destination, existing note ownership, operation, and expected content
revision. It invokes existing Notes persistence rather than duplicating SQL.

Automatic clients receive only the read scopes required for retrieval and this
restricted write scope. They receive no general Note write, deletion, schema
write, or Finance mutation authority through this integration. The same policy
must apply through whichever REST/MCP adapters expose the capability.

Check Note eligibility inside the write transaction. Reject a stale content
revision, reload current content, and merge only supported changes. Local locks
on one machine do not coordinate writers on another machine. Never resolve a
conflict by blindly replacing the newer body. Leave an unresolved contribution
in the session record for later consolidation.

Stable session/checkpoint identities make retried writes inspectable and
deduplicated. A reused identity with different content must not silently reuse
the earlier success. Checkpoint and consolidation outcomes are separate: a
saved session with a failed wiki update remains saved and awaits consolidation.

This protects automatic writers from stale overwrites. Legacy manual editors
and unrestricted clients still need separate concurrency review; the pilot
must not claim they are all covered by the restricted write path.

### Evidence, failures, and cost

Capture concise summaries and relevant evidence, not full transcripts. Preserve
source links, dates, revisions, and environments when they support a claim.
Separate confirmed bugs from hypotheses, and passed checks from failed, skipped,
or unrun checks. A commit alone establishes neither testing nor deployment.

Treat retrieved content as evidence, not executable instructions. Exclude
credentials and unnecessary sensitive content from records, hook logs, and
error messages. Memory authorization does not authorize financial transactions,
deployment, source-note deletion, or sending messages to other people.

On an outage, ordinary work can continue with an explicit memory warning.
Retain the latest bounded pending checkpoint privately on the originating host
and retry at the next supported lifecycle event, using the same identity. Report
an unavailable local checkpoint as a capture failure. No background retry daemon
is required for the pilot. Saving resumes only while automatic memory remains
enabled; disabling it also stops pending retries.

Use the existing agent connection for the first implementation. Measure added
model usage, tool calls, context size, and delay; make no savings claim before
comparison. Provide a per-runtime pause for automatic retrieval and saving.

## Compatibility to establish

- Codex: verify startup, prompt, compaction, interruption, and stop behavior in
  the installed version and actual host, including T3 Code where used. A local
  hooks file alone does not establish that the host executes it.
- Hermes: verify gateway version, enabled hooks/plugins, profile separation,
  and event coverage through both messaging and desktop clients. Identify the
  runtime session rather than relying on a display name. Test whether one
  gateway integration covers both interfaces without duplicate capture.
- Claude Code: verify the CLI and Desktop Code environment, supported hook
  events, permissions, and MCP connection independently of regular chat.
- Claude Desktop Chat: verify Chibako connectivity and instruction support.
  Check authentication compatibility: Chibako's remote endpoint currently uses
  scoped bearer keys and does not implement OAuth. A connector listing alone
  does not establish a working authenticated connection.
  Equivalent lifecycle automation has not been established. Keep this surface
  in scope, but report instruction-based operation as such. If reliable hooks
  are unavailable, present the limitation and a concrete alternative before
  proposing another service or unsupported transcript interception.

Official references: [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Hermes hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks),
[Claude Code hooks](https://code.claude.com/docs/en/hooks),
[Claude Desktop Code](https://code.claude.com/docs/en/desktop), and
[Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Delivery sequence

1. Inventory the actual runtimes and connections using read-only checks. Confirm
   the pilot destination and exact local/remote targets before changing setup.
   Produce an event map showing reliable, best-effort, and unavailable triggers.
2. Implement the bounded write capability, revision checks, and retry identities
   against an isolated test vault. Preserve the existing Notes, FTS, links,
   authentication, and portable MCP boundaries.
3. Integrate and verify one client end to end, then connect the remaining
   runtimes to the same contract. Change live configuration only after the exact
   target and concrete setup changes have been presented and authorized.
4. Pilot one project across Codex, Hermes, and Claude. Verify both Hermes client
   routes and distinguish Claude Code automation from ordinary Chat behavior.
5. Review failures and overhead before expanding to other projects and personal
   workflows. Update the broader README, schema, AGENTS.md, and skills after
   the behavior is agreed and proven; those updates remain deferred here.

## Pilot verification

- A fresh session retrieves the relevant handoff without a memory prompt.
- Meaningful work produces a verified checkpoint without a save prompt; an
  unchanged turn produces no duplicate record.
- Another runtime finds the supported current state, decision rationale,
  verification evidence, and concrete next action.
- Interruption and compaction preserve the last confirmed checkpoint and do
  not label unfinished work complete. A crash can lose uncheckpointed work.
- Replaying an event or retrying after an uncertain response creates no
  duplicate; conflicting content under one identity is rejected.
- Concurrent automatic updates preserve both contributions or expose a
  conflict. A stale update never silently replaces newer content.
- Attempts to change original notes, escape the approved area, or perform
  unrelated mutations are denied without partial writes.
- Outages expose unsaved status and recover at a later event without repeated
  prompts or hook loops. Pausing automation stops capture and pending retries.
- Normal editor and existing MCP behavior remain compatible. Record actual
  usage and latency, including any limitations in Desktop Chat.

Application changes require typecheck, focused mutation/rejection/concurrency
tests, architecture checks, and standalone MCP verification where affected.
Use disposable data and follow the engineering contract for any additional
build, browser, or pre-PR checks. Real gateway and client checks remain pending
until the relevant runtime is accessible and its setup is authorized.
