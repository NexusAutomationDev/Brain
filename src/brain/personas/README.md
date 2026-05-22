# brain.personas

## Owns

The bot/persona domain: the `Bot` SQLAlchemy model (id, slug, display name, system prompt, default model, fallback model, embedding provider, timestamps), the `BotRepo` CRUD layer, the in-process TTL cache keyed by `bot_id` that the `load_persona` graph node consults before round-tripping Postgres, and the admin CRUD HTTP routes mounted by `brain.api` (Phase 2).

## Public surface (as of Phase 1)

Empty stub. No exported symbols yet.

## Filled by

- Phase 2: `Bot` model + Alembic migration in `brain.*` schema, `BotRepo` async CRUD, TTL cache (`TTLCache` ~60s, invalidated on writes), admin routes (`POST /v1/bots`, `GET /v1/bots/{id}`, `PATCH`, `DELETE`).

## Do NOT

- Store secrets (API keys) on the `Bot` row — provider credentials are env-only (TS-20 / AUTH-04).
- Touch the `langgraph.*` schema — personas live exclusively in `brain.*` (FOUND-07 / PITFALL 6.1).
- Hot-mutate the cache from anywhere other than `BotRepo` writes (single owner of cache invalidation).
