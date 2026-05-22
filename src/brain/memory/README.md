# brain.memory

## Owns

Both tiers of conversational memory: `ShortTermRepo` (last-N messages in Postgres, scoped strictly by `thread_id = f"{bot_id}:{session_id}"`) and `LongTermRepo` (semantic recall from Qdrant, scoped by `bot_id` + `session_id` payload filter). The repos are pure data-access layers — they do not call LLMs and they do not own the embedding model.

## Public surface (as of Phase 1)

Empty stub. No exported symbols yet.

## Filled by

- Phase 6: `ShortTermRepo` (psycopg async) with `fetch_recent`, `append_turn`; trim-to-N logic; integration with `brain.graph.load_short_term` / `persist_short_term`.
- Phase 7: `LongTermRepo` backed by `brain.vectordb.QdrantStore`; embedding via `brain.providers` adapter; `recall(bot_id, session_id, query, k)` / `persist(bot_id, session_id, content, metadata)`.

## Do NOT

- Mix scopes — every read/write MUST filter by `(bot_id, session_id)`; bare `sessionId` filtering is a session-leak bug (PITFALL 10.1).
- Embed text inside the repo — the embedder is injected from `brain.providers`.
- Bypass the repo from `brain.graph` nodes — nodes call repos, never `brain.db.pool` directly.
