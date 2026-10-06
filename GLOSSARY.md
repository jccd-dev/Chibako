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
