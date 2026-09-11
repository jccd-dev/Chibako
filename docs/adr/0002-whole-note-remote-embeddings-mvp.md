# Whole-note embeddings from a remote Provider only (MVP)

Status: accepted

The vault is embedded one whole note at a time through a remote
OpenAI-compatible Provider. There is no chunking, no local model, and no
`sqlite-vec` in the MVP. The goal of this work is correctness and freshness of
an optional feature, not a retrieval-quality upgrade; chunking, local inference,
and an in-database vector index remain out of scope.

The embedding row is shaped so a chunk layer can be added later without
changing the freshness model: Staleness is keyed by a content hash per note, and
changing the model or dimensions wipes and Backfills rather than mixing vectors
from different Providers. We accept whole-note granularity (a long note yields
one vector) because it keeps the storage, staleness, and token-budget logic
simple while the feature is optional, and because retrieval quality is not the
constraint the MVP is trying to remove.
