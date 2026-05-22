# brain.api

## Owns

The HTTP ingress surface: the FastAPI application factory, dependency wiring for the bearer-token authenticator, the liveness probe (`/healthz`), the readiness probe (`/readyz`) that fans out to Postgres / RabbitMQ / Qdrant, and the future `/v1/webhook` route. Owns request/response envelope shapes for the HTTP side. Does **not** own LLM orchestration, persona lookup, or memory access — those live behind `brain.service.BrainService`.

## Public surface (as of Phase 1)

Empty stub. No exported symbols yet.

## Filled by

- Phase 1 (Plan 01-05): `app_factory()`, `/healthz`, `/readyz`, structlog request-id middleware, `Authorization` header stripping middleware.
- Phase 3: `POST /v1/webhook`, `BrainRequest` / `BrainResponse` Pydantic models, `Depends(verify_bearer)` wiring, error envelope handlers.

## Do NOT

- Couple route handlers to `brain.graph.*` directly — route handlers call `brain.service.BrainService` and nothing else (single waist).
- Put schema-version validation logic inline in the route — use the `brain.config` validator helper (FOUND-11 / D-16).
- Read `os.environ` inside route handlers; flow env through `brain.config.settings.get_settings()`.
