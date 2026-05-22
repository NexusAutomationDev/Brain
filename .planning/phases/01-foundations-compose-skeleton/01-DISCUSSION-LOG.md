# Phase 1: Foundations & Compose Skeleton — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 01-foundations-compose-skeleton
**Areas discussed:** Source layout + Settings/.env conventions; Healthz/Readyz + migration init-container ordering; Langfuse subsystem composition + Compose topology; Cross-cutting conventions (shutdown, logging, schema_version, lint enforcement)

---

## Gray-Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Source layout + Settings/.env conventions | src/brain layout, day-1 modules, Pydantic Settings shape, BRAIN_* env prefix, .env.example completeness | ✓ |
| Healthz/Readyz + migration init-container ordering | What /readyz probes, brain-migrate ordering for dual schema bootstrap | ✓ |
| Langfuse subsystem composition + Compose topology | Hand-roll vs include, lite override, depends_on/healthcheck chains, port exposure | ✓ |
| Cross-cutting conventions: shutdown, logging, schema_version, lint enforcement | Graceful shutdown, structlog fields, schema_version policy, lint rule scope | ✓ |

User selected all four areas.

---

## Source Layout & Settings/.env Conventions

### Q1 — Root code layout
| Option | Description | Selected |
|--------|-------------|----------|
| src/brain/ (src-layout) | Modern Python packaging; avoids CWD imports; aligns with uv + pytest | ✓ |
| brain/ at root (flat) | Simpler for ad-hoc scripts | |
| app/ (FastAPI-style) | Conventional in tutorials, less descriptive | |

### Q2 — Module skeleton on day 1
| Option | Description | Selected |
|--------|-------------|----------|
| All 11 packages from ARCHITECTURE.md with stubs | Locks architectural seams day 1 | ✓ |
| Only what Phase 1 touches (api/config/db/observability + service stub) | Leaner | |
| Minimal (brain/main.py + brain/config.py only) | Refactor later | |

### Q3 — Settings shape
| Option | Description | Selected |
|--------|-------------|----------|
| Single flat Settings with BRAIN_ prefix | Easy to mock | |
| Nested sub-models (PostgresSettings, RabbitMQSettings, ...) | Clearer separation | |
| You decide (Claude's discretion; recommended nested) | Defer detail to planner | ✓ |

### Q4 — .env.example policy
| Option | Description | Selected |
|--------|-------------|----------|
| Dev defaults for internal infra + <REPLACE_ME> for external secrets | Compose up + curl works out-of-the-box | ✓ |
| Everything as <REPLACE_ME> | Maximum safety, slower onboarding | |
| Real defaults for everything including secrets | Risk if copied to prod | |

**Notes:** No follow-up questions requested; user moved to next area immediately.

---

## Healthz/Readyz + Migration Init-Container Ordering

### Q1 — /readyz scope on Phase 1
| Option | Description | Selected |
|--------|-------------|----------|
| Postgres + RabbitMQ + Qdrant (all three) | Satisfies success criterion #2 | ✓ |
| Postgres only; expand later | Simpler now, defers connectivity test | |
| Postgres + Qdrant; RabbitMQ in Phase 8 | Middle ground | |

### Q2 — Probe implementation style
| Option | Description | Selected |
|--------|-------------|----------|
| Active probes with ≤2s timeout + 5s cache | SELECT 1 / AMQP heartbeat / GET /healthz | |
| Passive (trust pool/connection) | Faster but can lie | |
| You decide | Defer detail to planner | ✓ |

### Q3 — Migration init-container shape
| Option | Description | Selected |
|--------|-------------|----------|
| Single brain-migrate (Alembic then AsyncPostgresSaver.setup() in one container) | Atomic ordering, one log stream | ✓ |
| Two init containers chained via depends_on | More granular | |
| No init container (Brain runs migrations at startup) | Race in multi-replica, mixes responsibilities | |

### Q4 — Legacy checkpoint replay fixture
| Option | Description | Selected |
|--------|-------------|----------|
| Implement now (snapshot fixture + CI test) | PITFALL 1.1 belt-and-suspenders | |
| Defer to Phase 6 (when state is actually written) | Phase 1 only calls .setup() | ✓ |
| Skip entirely (rely on exact-pin only) | Pin alone prevents accidental upgrades | |

**Notes:** No follow-up questions requested; user moved to next area immediately.

---

## Langfuse Subsystem & Compose Topology

### Q1 — How the 5 Langfuse services enter compose
| Option | Description | Selected |
|--------|-------------|----------|
| Hand-roll all 5 with pinned images | Full control, explicit upgrades | ✓ |
| Use `include:` pointing at official Langfuse compose | Less maintenance, opaque pins | |
| Separate docker-compose.langfuse.yml combined via -f | Good separation, extra command | |

### Q2 — Lite override mechanism
| Option | Description | Selected |
|--------|-------------|----------|
| Standalone docker-compose.lite.yml redeclaring lite subset | Shorter, drift risk | |
| `profiles:` on Langfuse services | Single source of truth | |
| You decide | Defer to planner (recommended: profiles, but reconcile with DEPLOY-02 wording) | ✓ |

### Q3 — depends_on strategy (first pass)
| Option | Description | Selected |
|--------|-------------|----------|
| All deps service_healthy; Langfuse outside Brain's depends_on | Deterministic boot, observability decoupled | |
| All deps including Langfuse service_healthy | Strictly ordered, couples Brain to Langfuse boot | |
| service_started only (no health gating) | Faster boot, violates criterion #1 | ✓ |

### Q3-revisit — depends_on strategy after tradeoff push-back
| Option | Description | Selected |
|--------|-------------|----------|
| service_healthy for brain-migrate + postgres + rabbitmq + qdrant; Langfuse OUT | Deterministic + decoupled (recommended) | ✓ |
| Keep service_started for everything | Faster boot, accepts flakiness | |
| service_healthy for everything including Langfuse | Couples Brain to observability boot | |

**Notes:** Initial `service_started` answer conflicted with success criterion #1 ("`service_healthy` deterministically"); Claude flagged the tradeoff and re-asked. User accepted the recommended split.

### Q4 — Host port exposure (asked alongside initial Q3)
First reply was a clarifying question ("quem vai ficar responsável de receber os dados no webhook ou do rabbitmq?") rather than an option pick. Claude answered the question (api/ in Phase 3, workers/ in Phase 8, both via BrainService) and re-asked.

| Option | Description | Selected |
|--------|-------------|----------|
| Brain :8000 + Langfuse-web :3000 + RabbitMQ mgmt :15672 + Qdrant :6333 (rest internal) | Balanced ergonomics + least privilege (STACK.md §9) | ✓ |
| Everything exposed | Maximum dev convenience | |
| Only Brain :8000 | Maximum isolation | |

---

## Cross-Cutting Conventions

### Q1 — Graceful shutdown contract
| Option | Description | Selected |
|--------|-------------|----------|
| uvicorn lifespan + FastAPI shutdown + BRAIN_SHUTDOWN_GRACE_SECONDS (default 30s) | Modern standard | |
| Custom signal handler with fixed 30s grace | Duplicates uvicorn behavior | |
| You decide | Defer mechanism detail to planner | ✓ |

### Q2 — structlog canonical fields
| Option | Description | Selected |
|--------|-------------|----------|
| ts, level, event, service, request_id, bot_id, session_id, trace_id, schema_version, ingress | Consistent from day 1 | |
| Minimum (ts, level, event, service) + bind() ad-hoc | Risk of drift | |
| You decide | Defer field set to planner | ✓ |

### Q3 — print / stdlib logging ban
| Option | Description | Selected |
|--------|-------------|----------|
| ruff T201 + G004 + pre-commit grep banning `import logging` (alembic/env.py allowed) | Defense in depth, simple | ✓ |
| ruff only + code review | Lighter, less guarantee | |
| ruff + custom plugin + import-linter | Maximum but complex | |

### Q4 — schema_version policy
| Option | Description | Selected |
|--------|-------------|----------|
| Integer '1'; env list BRAIN_SUPPORTED_SCHEMA_VERSIONS; Pydantic validator; 422 + UNSUPPORTED_SCHEMA_VERSION | Simple, monotonic, env-tunable | ✓ |
| Semver string '1.0'; middleware validation | More expressive, overkill | |
| Defer format detail to Phase 3 | Adjacent to BrainRequest | |

### Q5 — Lint enforcement scope on day 1
| Option | Description | Selected |
|--------|-------------|----------|
| thread_id helper + asyncpg ban + sync PostgresSaver ban (Qdrant/provider bans land in their phases) | Pragmatic, no orphan rules | |
| ALL bans on day 1 even for empty modules | Maximum guarantee, more to explain | |
| You decide | Defer scope to planner | ✓ |

### Q6 — Gitleaks integration
| Option | Description | Selected |
|--------|-------------|----------|
| Pre-commit hook + CI job, shared .gitleaks.toml | Defense in depth | ✓ |
| Pre-commit only | Trusts every dev to install hook | |
| CI only | Local history unprotected | |

---

## Claude's Discretion

| Decision | Recommendation captured |
|----------|-------------------------|
| D-03 Settings shape | Nested sub-models with `__` delimiter |
| D-06 readyz probe pattern | Active probes ≤2s + 5s cache |
| D-10 lite override mechanism | `profiles:` (reconcile with DEPLOY-02 wording in the plan) |
| D-13 graceful shutdown mechanism | uvicorn lifespan + FastAPI shutdown + BRAIN_SHUTDOWN_GRACE_SECONDS env var |
| D-14 structlog field set | ts/level/event/service/request_id/bot_id/session_id/trace_id/schema_version/ingress with "-" placeholders |
| D-17 lint rule scope | Only bans whose target modules have code in Phase 1 |

## Deferred Ideas

None. The discussion stayed strictly inside Phase 1's roadmap-defined scope.
