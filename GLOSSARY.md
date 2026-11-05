# Chibako

Chibako is a self-hosted, Obsidian-like second brain: plain-Markdown notes
connected by `[[wikilinks]]`, readable and writable by the owner and their AI
agent.

## Language

### Access

**Vault**:
The owner's complete Chibako knowledge store: Notes, knowledge schema,
observations, links, and retrieval indexes.
_Avoid_: Workspace, brain, database

**Agent access**:
Scoped machine access to a Vault through Chibako's agent-facing protocols. It
is distinct from the owner's interactive browser session.
_Avoid_: Admin access, integration access

### Knowledge

**Note**:
A single unit of knowledge stored as Markdown with an optional YAML frontmatter
block. Its title is its primary identity.
_Avoid_: Document, file, page

**Wikilink**:
An inline `[[Title]]` reference from one note to another, resolved by title.
_Avoid_: Link, backlink

**Backlink**:
A note that links to the current note. Computed from the link index, never
authored by hand.
_Avoid_: Incoming link

**Kind**:
A note's role: `note`, `wiki` (AI-compiled), or `index` (a navigational map of
content).
_Avoid_: Type

**Note date**:
The optional calendar day assigned to a Note through its canonical `date`
property as a valid `YYYY-MM-DD` value. It carries no time, duration,
recurrence, or due-date meaning.
_Avoid_: Event date, scheduled time, due date

**Calendar**:
The view that groups and browses Notes by Note date. It is not an event or task
scheduler.
_Avoid_: Schedule, planner

### Retrieval

**Search**:
Deterministic keyword lookup over note titles and bodies, returning matching
notes with highlighted snippets.

**Recall**:
Token-budgeted retrieval that returns ranked titles and trimmed snippets so an
agent can load context without reading full note bodies. Always includes
Search; adds a semantic half when Embeddings are enabled.
_Avoid_: Semantic search, RAG

**Snippet**:
A trimmed fragment of a note's body shown in Search/Recall results — never the
full body.
_Avoid_: Excerpt, preview

### Agent memory

**Scoreboard**:
A developer tool (`npm run scoreboard`) that runs a question file through Recall
and reports hit rate at top 1 and top 5 by group (`saved`, `conversation-only`)
and split (`tune`, `hidden`), Recall tokens returned, p50/p95 latency, and whether
each hit landed in a checkpoint or a canonical Note. Each run has two passes: a normal
pass (cold query cache, real time limit) gives latency and keyword fallback, then a ranking
pass with every query Embedding available gives hit rates, hit sources and tokens. Hit rates
are the stable figure; tokens can shift slightly when a near-tie changes the result set. Scoring is by simple rules, with
no model judge. It runs only on a temporary Vault with lazy refresh off, scores
`hidden` questions only for a final result, and saves each run for comparison. Real
questions stay in git-ignored local files; the repository holds only a fake fixture.
_Avoid_: Benchmark, eval

**Thread key**:
An optional SHA-256 hash of a host thread identifier, sent as `thread_key` to
resolve one checkpoint across model/runtime switches under the same API-key
principal. The raw identifier stays local; T3 uses `sha256("t3:" + T3CODE_THREAD_ID)`.
_Avoid_: Session ID (a runtime session can change within a thread)

**Workstream**:
Work continued through one checkpoint across sessions. A first save can join a
same-project checkpoint by normalized title after reading, merging and retrying
with its revision. Matching ignores case, repeated whitespace and legacy
`(runtime-hex)` suffixes; open records precede finished records, then newest wins.
_Avoid_: Per-task session (one session can cover several tasks)

**Fact note**:
An ordinary Note holding one fact, decision or preference saved with `memory_save`.
It lives in the project's memory folder (the memory area root when cross-project),
uses the `wiki` memory role, links its related Note with a Wikilink, and is found by
Recall. Outdated facts are set to `status: archived` with a Wikilink to the
replacement. Without a memory folder, `memory_save` still writes a legacy
observation row.
_Avoid_: Observation (the older table of rows outside Notes)

**Activity note**:
The bounded metadata log in each project's memory folder, with at most 30 entries.
Hooks record runtime/date, available git metadata and work counts without prompts
or responses. Capture can link an existing checkpoint and refresh its Agent Now
date without changing the checkpoint revision.
_Avoid_: Transcript, checkpoint

**Stale checkpoint**:
An open checkpoint marked `status: stale` when its Agent Now entry ages out.
The server uses the later of checkpoint update time and the line date; the window
is seven days by default, set by `CHIBAKO_MEMORY_STALE_DAYS`. Saving restores
`active` and its Agent Now entry. This is distinct from Embedding Staleness and
a rejected stale revision.
_Avoid_: Finished checkpoint, deleted checkpoint

**Workstation project**:
The `workstation` project slug used when neither an override, profile path map nor
git resolves a project. Its records live under `<memory area>/workstation`, subject
to a configured alias, rather than at the area root.
_Avoid_: Root memory, unknown project

### Embeddings

**Embedding**:
A dense vector representing one note's Embedding input, used to add the semantic
half of Recall.
_Avoid_: Vector, feature

**Embedding input**:
The text derived from a note — its title and body — used both to produce the
note's Embedding and to detect Staleness.
_Avoid_: Chunk, document text

**Staleness**:
The state of a stored Embedding whose note's Embedding input changed after the
Embedding was produced. Detected by comparing a hash of the input, never by
guessing from timestamps.
_Avoid_: Dirty, out of date

**Backfill**:
The first pass that gives every eligible note an Embedding; it runs only when a
note has none.
_Avoid_: Index

**Reindex**:
A later pass that repairs missing or stale Embeddings. Reindex subsumes
Backfill.
_Avoid_: Sync, refresh

**Provider**:
The component that turns an Embedding input into an Embedding — a remote
service, or a deterministic in-process fake used in tests.
_Avoid_: Model (a Provider exposes a model id; the two are not the same)
