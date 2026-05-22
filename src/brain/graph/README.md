# brain.graph

## Owns

The LangGraph `StateGraph` build, the typed `BrainState` `TypedDict`, every orchestration node (`load_persona`, `load_short_term`, `recall_long_term`, `call_llm`, `persist_short_term`, `persist_long_term`), and the `thread_id(bot_id, session_id)` helper that guarantees session isolation across bots (FOUND-08 / D-17 / PITFALL 10.1).

## Public surface (as of Phase 1)

Empty stub. No exported symbols yet. Phase 1 (Plan 01-04) adds only `brain.graph.thread.thread_id(...)`.

## Filled by

- Phase 1 (Plan 01-04): `brain.graph.thread.thread_id(bot_id, session_id) -> str` returning `f"{bot_id}:{session_id}"`.
- Phase 3: `BrainState` `TypedDict`, `build_graph()` factory, `call_llm` node skeleton.
- Phase 6: `load_short_term`, `persist_short_term` nodes wired to Postgres repo.
- Phase 7: `recall_long_term`, `persist_long_term` nodes wired to Qdrant.

## Do NOT

- construct thread_id with bare f-string; use brain.graph.thread.thread_id() helper (FOUND-08 / D-17).
- Use the sync `PostgresSaver` — async-only `AsyncPostgresSaver` (PITFALL 1.2). Sync checkpointer is allowed under `scripts/` only.
- Import `langgraph` 0.2.x patterns from blog posts; this package targets `langgraph` 1.2.x exclusively (FOUND-02 / STACK.md §2).
