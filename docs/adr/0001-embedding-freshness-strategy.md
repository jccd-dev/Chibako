# Embedding freshness is hash-detected and best-effort

Status: accepted

Embeddings are optional, but whenever they are enabled they must stay correct.
A stored Embedding is treated as stale when the note's current Embedding input
no longer hashes to the stored hash, or when the model, dimensions, or input
formula changed. Refresh never sits in the write path: a note write succeeds
regardless of the Provider, and missing or stale Embeddings are repaired by an
opportunistic debounced flush after a write, a lazy refresh triggered by Recall,
and an explicit batched Reindex. Provider failures are recorded and retried
(with a short circuit breaker), never surfaced as write failures.

We chose this over embedding inline and synchronously on write (which would
make every save depend on a third-party network call and block autosave) and
over a persistent queue or background worker (rejected as unnecessary machinery
for a single-vault workload). The hash is the source of truth specifically so
the two writer processes — the web server and the MCP server, which share the
database but not memory — each converge without coordinating.
