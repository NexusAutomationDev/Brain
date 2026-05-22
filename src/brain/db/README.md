# brain.db

## Owns

The Postgres data-plane primitives: the `psycopg[binary,pool]` async connection pool (`AsyncConnectionPool`), the Alembic environment + revision tree for the `brain.*` schema, the `AsyncPostgresSaver` factory used by `brain.graph`, and the `brain-migrate` init-container entrypoint that runs `alembic upgrade head` followed by `AsyncPostgresSaver.setup()` for the `langgraph.*` schema (D-07).

## Public surface (as of Phase 1)

Empty stub. No exported symbols yet.

## Filled by

- Phase 1 (Plan 01-06): `get_pool()`, `close_pool()` lifespan hooks, Alembic `env.py` + initial revision wiring, `make_checkpointer()` factory, `python -m brain.db.migrate` entrypoint for the init container.
- Phase 2 / Phase 6: Bot table + short-term-history table Alembic revisions.

## Do NOT

- import asyncpg anywhere; LangGraph checkpointer requires psycopg v3 (FOUND-06 / PITFALL 1.2).
- Mix the `brain.*` schema (Alembic-owned) with the `langgraph.*` schema (checkpointer-owned) — never have Alembic touch `langgraph.*`, never have the checkpointer touch `brain.*` (FOUND-07 / PITFALL 6.1).
- Share a Postgres instance with Langfuse — `brain-postgres` and `langfuse-postgres` are separate containers (PITFALL 6.2).
