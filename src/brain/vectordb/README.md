# brain.vectordb

## Owns

The Qdrant client wrapper, the `VectorStore` protocol that `brain.memory.LongTermRepo` consumes, the single collection `brain_memory` with named vectors + filterable HNSW on `bot_id` / `session_id`, the embedding-dimension lock (chosen at install time per EMB-03/04), and the collection-bootstrap logic invoked by the migrate init container.

## Public surface (as of Phase 1)

Empty stub. No exported symbols yet.

## Filled by

- Phase 7: `QdrantStore` (async), `VectorStore` protocol, `bootstrap_collection()` (called by the migrate entrypoint), payload-filter helpers for `(bot_id, session_id)`, hybrid (dense + sparse BM25) query support.

## Do NOT

- import qdrant_client outside this package (VEC-04 — lint enforced in Phase 7).
- Hardcode embedding dimension — locked once at collection creation and stamped in env / settings; changing it requires a collection recreate (EMB-03).
- Switch to collection-per-bot without an ADR — the locked decision is single collection + payload filter (STACK.md §4).
