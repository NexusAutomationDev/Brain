# Brain

Centralized LangGraph-based AI orchestration service for conversational bots.

Brain receives `{ botId, sessionId, conteudo }` payloads from bot frontends
(WhatsApp, Telegram, etc.) and returns coherent, persona-correct, memory-aware
replies — regardless of which LLM provider answers behind the scenes.

See `.planning/PROJECT.md` for the full project description and
`.planning/ROADMAP.md` for the delivery plan.

This repository is the v1 implementation. Phase 1 (this checkpoint) ships the
walking skeleton: pinned deps, dual Postgres schemas, structlog JSON logs,
gitleaks hygiene, multi-stage Dockerfile, and the full + lite Docker Compose
stacks with healthchecks on every service.

## Quickstart

Requirements: Docker >= 24.x, Docker Compose v2 plugin >= 2.20.

```bash
git clone <repo-url> brain && cd brain
cp .env.example .env
# Fill these three placeholders in .env:
#   BRAIN_AUTH__TOKEN  — pick a long random string
#   OPENAI_API_KEY     — your OpenAI key (Phase 5+ uses it)
#   GEMINI_API_KEY     — your Google AI Studio key (Phase 5+ uses it)

# Inner-loop dev (fast — no Langfuse subsystem):
docker compose -f docker-compose.lite.yml up -d --build

# OR full stack with Langfuse observability:
docker compose up -d --build

# Wait for healthy
docker compose ps

# Liveness
curl -s http://localhost:8000/healthz
# {"status":"ok"}

# Readiness (all deps green)
curl -s http://localhost:8000/readyz
# {"status":"ready","checks":{"postgres":"ok","rabbitmq":"ok","qdrant":"ok"}}
```

Tear down: `docker compose down` (do NOT pass `-v` — it deletes volumes).

`<REPLACE_ME>` placeholders in `.env.example` are intentionally allowlisted by
the gitleaks ruleset; replace them with real secrets in your local `.env`
(never committed).

## What's in v1

| Phase | Status | Brings |
|-------|--------|--------|
| **1 — Foundations & Compose Skeleton** | this checkpoint | Dual-Postgres schemas, healthchecks, gitleaks, structlog, schema_version validator, multi-stage Dockerfile, full + lite compose |
| 2 — Bot Persona CRUD + Audit | planned | `brain.bots` + `brain.bot_audit_log` + CRUD API |
| 3 — Minimal Webhook + Single-Node Graph | planned | Bearer-auth `/v1/webhook`, one-node LangGraph |
| 4 — Langfuse Wiring | planned | Trace every request; fire-and-forget + circuit breaker |
| 5 — Multi-Provider + Fallback | planned | OpenAI + Gemini adapters; `Runnable.with_fallbacks` router |
| 6 — Short-Term Memory + Checkpointer | planned | Per-session asyncio.Lock + AsyncPostgresSaver |
| 7 — Vector Memory (Qdrant) | planned | Filterable HNSW; parallel short+long-term fetch |
| 8 — RabbitMQ Ingress + Idempotency | planned | brain.in / brain.out queues; idempotency cache |
| 9 — Hardening | planned | Retention, DLQ replay, token rotation, runbook |

See `.planning/ROADMAP.md` for full phase definitions.

## Repository Map

```
src/brain/
├── api/             # FastAPI app, /healthz, /readyz, /v1/webhook (Phase 3+)
├── workers/         # aio-pika consumer (Phase 8)
├── service/         # BrainService shared waist (Phase 3+)
├── graph/           # LangGraph nodes + thread_id helper
├── providers/       # OpenAI + Gemini adapters (Phase 5)
├── memory/          # Short-term + long-term repos (Phases 6, 7)
├── personas/        # Bot CRUD repo + TTL cache (Phase 2)
├── vectordb/        # Qdrant wrapper (Phase 7)
├── db/              # psycopg async pool, Alembic, AsyncPostgresSaver factory
├── config/          # Pydantic Settings, structlog wiring, schema_version
└── observability/   # Langfuse callback handler (Phase 4)

alembic/                 # Brain.* schema migrations only (langgraph.* is checkpointer-owned)
docker/Dockerfile        # base -> dev -> prod multi-stage
docker-compose.yml       # Full stack (10 services + Langfuse subsystem)
docker-compose.lite.yml  # Inner-loop subset (no Langfuse)
.planning/               # Roadmap, requirements, research, per-phase plans
```

## Architectural Invariants (Phase 1 locked these)

| Invariant | Source | Enforced by |
|-----------|--------|-------------|
| Two Postgres schemas: `brain.*` (Alembic) + `langgraph.*` (`AsyncPostgresSaver.setup()`) | FOUND-07 | `brain-migrate` init container asserts via `to_regclass` |
| psycopg v3 only (asyncpg forbidden) | FOUND-06 | `scripts/lint/ban-asyncpg.sh` pre-commit hook |
| LangGraph triple exact-pinned (no minor drift) | FOUND-02 | `pyproject.toml` `==` operators; CI grep |
| Single `thread_id(bot_id, session_id)` constructor | FOUND-08 | `scripts/lint/ban-raw-thread-id.sh` pre-commit hook |
| structlog JSON; no stdlib logging in `src/brain/` | FOUND-10 | ruff `T201` + `G004` + `scripts/lint/ban-stdlib-logging.sh` |
| Bearer token required at startup (no default) | AUTH-01 (Phase 3 enforces) | `Settings.auth.token` has no default — Pydantic ValidationError on missing |
| 32 KiB payload cap | AUTH-04 (Phase 3 wires middleware) | `MAX_REQUEST_BODY_BYTES = 32 * 1024` constant |
| Langfuse must never block the request path | OBS-04, PITFALL 8.1 | Brain `depends_on` excludes `langfuse-*`; Phase 4 adds fire-and-forget + circuit breaker |
| `.env` gitignored, gitleaks pre-commit + CI | FOUND-12, D-18 | `.gitignore`, `.gitleaks.toml`, pre-commit hook, GitHub Actions job |

## Operational Notes

- `docker compose down -v` is **destructive** — it deletes named volumes
  (`brain-pg-data`, `qdrant-data`, etc.). Use plain `down` to preserve data.
- The MinIO image is the **last community release**
  (`RELEASE.2025-09-07T16-13-09Z-cpuv1`); the upstream project archived its
  community Docker images in early 2026. Brain will migrate to a maintained
  S3-compatible store (Garage / SeaweedFS / RustFS) in a later milestone.
  See `.planning/research/PITFALLS.md` and Phase 1 RESEARCH.md Open Question #2.
- Langfuse observability requires the full stack (`docker-compose.yml`). The
  lite stack disables Langfuse explicitly (`BRAIN_LANGFUSE__ENABLED=false`).

## Development

```bash
# Install Python + uv + deps locally (alongside or instead of Docker)
uv python install 3.12
uv sync --frozen

# Lint + format
uv run ruff check .
uv run ruff format .

# Unit tests
uv run pytest -q -m "not integration"

# Integration tests (require Docker for testcontainers)
uv run pytest -q -m integration

# Pre-commit hooks
uvx pre-commit install --install-hooks
uvx pre-commit run --all-files
```

## Verification Scripts

| Script | Purpose |
|--------|---------|
| `bash scripts/smoke-up.sh lite` | Up the lite stack, poll for healthy, hit /healthz + /readyz, run drain assertion across SIGTERM, tear down. |
| `bash scripts/smoke-up.sh full` | Same against the full stack (longer timeout for Langfuse first boot). |
| `bash scripts/check-env-example.sh` | Diff Settings field set vs `.env.example` BRAIN_* keys. |
| `bash scripts/check-compose-parity.sh` | Diff shared services between `docker-compose.yml` and `docker-compose.lite.yml`. |
| `bash scripts/smoke-readme.sh` | Execute this README's Quickstart against the working tree. |

## Commits

This repo uses Conventional Commits with emojis (see `CLAUDE.md`). Examples:

```
✨ feat: add /v1/webhook with bearer auth
🐛 fix(db): respect search_path when calling AsyncPostgresSaver.setup()
🔧 chore: pin langgraph triple to exact versions
🔒️ security: enforce 32KB payload cap in middleware
```

Do NOT include automation-generated co-author trailers in commits
(see `CLAUDE.md` for the full list of forbidden lines).

## License

(TBD — placeholder for milestone v1 release.)
