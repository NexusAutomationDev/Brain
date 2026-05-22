---
phase: 01-foundations-compose-skeleton
plan: 08
subsystem: compose
tags: [docker-compose, langfuse, healthchecks, init-container, dual-postgres, networking]
requires:
  - .env.example with Langfuse subsystem keys (plan 01-03)
  - docker/Dockerfile target=prod (plan 01-07)
  - src/brain/db/migrate.py entrypoint (plan 01-06)
provides:
  - docker-compose.yml (full 10-service stack + 2 init containers)
  - docker-compose.lite.yml (6-service inner-loop subset)
  - compose/brain-topology-init/README.md (DEPLOY-06 placeholder contract)
affects:
  - plan 01-09 (scripts/check-compose-parity.sh + smoke-up.sh consume these files)
  - Phase 8 (will swap brain-topology-init image+command for aio-pika declarer)
  - Phase 9 (MinIO migration tracked in Open Question #2)
tech_stack:
  added: []
  patterns:
    - "Strict-subset lite compose (D-10) — same image pins/env/healthchecks/depends_on as full for shared services"
    - "Init container slot reservation — placeholder service in Phase 1, real workload swapped in later phase"
    - "Dual Postgres (PITFALL 6.2) — brain-postgres + langfuse-postgres on separate volumes"
    - "Brain depends_on protected from observability (PITFALL 8.1 / OBS-04) — Langfuse NEVER in core dep chain"
key_files:
  created:
    - docker-compose.yml
    - docker-compose.lite.yml
    - compose/brain-topology-init/README.md
  modified: []
decisions:
  - "Shared volume names (brain-pg-data, rmq-data, qdrant-data) across full + lite so check-compose-parity.sh has no volume-name allow-list"
  - "Added pgrep-based healthcheck to langfuse-worker (deviation from RESEARCH.md / plan body) — verify rule + threat register both treat every long-running service as needing one"
  - "Added /health healthcheck to brain service — matches FOUND-09 health endpoint that ships in plan 01-05"
requirements_completed: [DEPLOY-01, DEPLOY-02, DEPLOY-04, DEPLOY-05, DEPLOY-06]
metrics:
  duration: ~18m
  tasks_completed: 2
  files_created: 3
  total_lines_added: 487
  commits: 2
completed: "2026-05-22"
---

# Phase 01 Plan 08: Docker Compose Skeleton Summary

Authored both Docker Compose files — full (`docker-compose.yml`, 10 long-running services + 2 init containers) and lite inner-loop subset (`docker-compose.lite.yml`, 6 services) — plus the `brain-topology-init` placeholder README documenting the DEPLOY-06 slot and Phase 8 replacement plan. Brain depends only on the four hard-runtime deps (brain-migrate completion + brain-postgres + rabbitmq + qdrant healthy); Langfuse subsystem starts in parallel and never blocks Brain boot (PITFALL 8.1). Two separate Postgres instances per PITFALL 6.2. MinIO pinned to the last pre-archive community release with migration plan tracked in Open Question #2.

## Files

| Path | Lines | Purpose |
|------|-------|---------|
| `docker-compose.yml` | 301 | Full stack: brain + brain-migrate + brain-topology-init + brain-postgres + rabbitmq + qdrant + Langfuse subsystem (langfuse-postgres, clickhouse, redis, minio, langfuse-web, langfuse-worker) |
| `docker-compose.lite.yml` | 117 | Inner-loop subset: brain + brain-migrate + brain-topology-init + brain-postgres + rabbitmq + qdrant (no Langfuse) |
| `compose/brain-topology-init/README.md` | 69 | DEPLOY-06 placeholder contract; Phase 8 replacement plan |

## Image Pins

### Full stack (`docker-compose.yml`)

| Service | Image | Healthcheck | Host port |
|---------|-------|-------------|-----------|
| brain-postgres | `postgres:17-trixie` | `pg_isready -U brain -d brain` | none (internal) |
| rabbitmq | `rabbitmq:4.1-management-alpine` | `rabbitmq-diagnostics -q ping` | `127.0.0.1:15672:15672` |
| qdrant | `qdrant/qdrant:v1.18.0` | `wget -qO- localhost:6333/healthz` | `127.0.0.1:6333:6333` |
| brain-migrate | built locally (target `prod`) | — (init container) | none |
| brain-topology-init | `alpine:3.20` | — (init container, placeholder) | none |
| brain | built locally (target `prod`) | `wget -qO- http://localhost:8000/health` | `8000:8000` |
| langfuse-postgres | `postgres:17-trixie` | `pg_isready -U langfuse` | none (internal) |
| clickhouse | `clickhouse/clickhouse-server:24.8-alpine` | `wget -qO- localhost:8123/ping` (60s start_period) | none (internal) |
| redis | `redis:7-alpine` | `redis-cli -a $$… ping` | none (internal) |
| minio | `minio/minio:RELEASE.2025-09-07T16-13-09Z-cpuv1` | `mc ready local` | none (internal) |
| langfuse-web | `langfuse/langfuse:3.175.0` | `wget -qO- /api/public/health` (60s start_period) | `3000:3000` |
| langfuse-worker | `langfuse/langfuse-worker:3.175.0` | `pgrep -x node` (process liveness; see deviation #1) | none (internal) |

### Lite stack (`docker-compose.lite.yml`)

Identical image pins / env / healthchecks / depends_on for the 6 shared services (`brain-postgres`, `rabbitmq`, `qdrant`, `brain-migrate`, `brain-topology-init`, `brain`). The only delta vs full is brain's `environment: BRAIN_LANGFUSE__ENABLED=false` override (belt-and-suspenders per A7 / D-10).

## Assumption Confirmations

| Assumption | Status | Notes |
|-----------|--------|-------|
| **A2** — Langfuse images ship no baked healthcheck | confirmed in plan body; healthchecks added explicitly for both langfuse-web and langfuse-worker |
| **A3** — MinIO `RELEASE.2025-09-07T16-13-09Z-cpuv1` is a valid pre-archive tag | pinned literally as documented in RESEARCH.md / plan body. Runtime pull verification deferred to plan 01-09 smoke-up.sh — if Docker Hub no longer serves this tag at smoke time, fall back to nearest pre-archive release and update the pin |
| **A5** — ClickHouse `24.8-alpine` is on Docker Hub | pinned as `clickhouse/clickhouse-server:24.8-alpine`. Fallback `24.3-alpine` documented inline (Langfuse v3 minimum is 24.3) |
| **A7** — Brain config respects `BRAIN_LANGFUSE__ENABLED=false` even when other Langfuse env is set | enforced in lite via explicit `environment:` override on the brain service |

`docker compose -f <file> config` runtime validation **deferred to plan 01-09 smoke-up.sh** — Docker daemon is not available in this execution sandbox. Files are structurally validated by text-based checks (service-head grep, image-pin grep, `:latest` absence, healthcheck count, `version:` field absence). The verifier agent and 01-09's smoke-up will exercise the YAML against a real Docker daemon.

## Confirmation: Brain depends_on has no `langfuse-*`

Brain service `depends_on` (in both files) is exactly:

```
brain-migrate:    service_completed_successfully
brain-postgres:   service_healthy
rabbitmq:         service_healthy
qdrant:           service_healthy
```

No `langfuse-postgres`, no `langfuse-web`, no `langfuse-worker`. PITFALL 8.1 / D-11 / OBS-04 / T-08-01 satisfied.

## Volume Naming Decision

**Shared names** (`brain-pg-data`, `rmq-data`, `qdrant-data`) instead of separate `-lite` suffixes. Two reasons:

1. Plan 01-09's `scripts/check-compose-parity.sh` can diff the shared service blocks byte-for-byte without needing a volume-name allow-list.
2. Developers who flip between lite and full on the same machine see the same Postgres / RabbitMQ / Qdrant data — fewer surprises, smaller disk footprint.

Trade-off: full-stack's Langfuse-specific volumes (`lf-pg-data`, `ch-data`, `redis-data`, `minio-data`) only exist in `docker-compose.yml` — that's fine because they're not shared.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan] Added healthcheck to `langfuse-worker`**

- **Found during:** Task 1 verification
- **Issue:** The plan body said `langfuse-worker` has "no healthcheck (per A2 — worker has no liveness endpoint; depends_on chain ensures coherent boot)". But the `<verify>` automated block requires `grep -c 'healthcheck:' >= 10`, and the threat register / "Every long-running service declares a `healthcheck:` block" must_have treats all 10 long-running services as needing one. Without a worker healthcheck the count was 9 (failing strict acceptance) and the threat surface T-08-06 (env-shape drift) had no liveness signal for the worker.
- **Fix:** Added `pgrep -x node` healthcheck (`start_period: 30s`, `interval: 10s`, `retries: 6`). `pgrep` ships in the Alpine base of the langfuse-worker image and `node` is the worker process. This is liveness-only (does the worker process exist?) rather than readiness — matching the plan's intent of A2 (no HTTP readiness endpoint).
- **Files modified:** `docker-compose.yml`
- **Commit:** `048d8e3`

**2. [Rule 2 - Missing critical functionality] Added `/health` healthcheck to brain service**

- **Found during:** Task 1
- **Issue:** Plan body did not specify a Brain healthcheck, but D-11 / DEPLOY-04 invariants and the threat register require every long-running service to declare one. Brain's `/health` endpoint is being shipped in plan 01-05.
- **Fix:** Added `wget -qO- http://localhost:8000/health || exit 1` healthcheck on brain (both full and lite). `start_period: 30s` matches the slow first boot path through brain-migrate.
- **Files modified:** `docker-compose.yml`, `docker-compose.lite.yml`
- **Commits:** `048d8e3`, `3536bc8`

**3. [Rule 1 - Spec consistency] Removed literal `:latest` from a comment in docker-compose.yml**

- **Found during:** Task 1 verification
- **Issue:** A comment on the alpine placeholder said "(NOT :latest)" — but the plan's verify command `! grep -F ':latest' docker-compose.yml` would match the literal string inside the comment and fail.
- **Fix:** Reworded to "(never a floating tag)" — same meaning, no literal `:latest` substring.
- **Files modified:** `docker-compose.yml`
- **Commit:** `048d8e3`

### Out of scope (logged)

None this plan.

## Threat Register Coverage

| Threat | Disposition | How addressed in compose |
|--------|-------------|--------------------------|
| T-08-01 (Langfuse outage stalls Brain) | mitigate | Brain `depends_on` has no `langfuse-*` (verified by structural grep) |
| T-08-02 (Brain+Langfuse data bleed) | mitigate | Two `postgres:17-trixie` instances on separate volumes (count==2) |
| T-08-03 (Brain-Postgres/AMQP exposed on host) | mitigate | No host port for postgres-5432 / amqp-5672 / clickhouse / redis / minio; mgmt UIs bound to 127.0.0.1 |
| T-08-04 (`:latest` drift) | mitigate | Every image pinned to a specific tag; alpine placeholder at `3.20` |
| T-08-05 (MinIO archived → CVE accumulation) | accept | Pin to last community release; migration tracked in Open Question #2 + this SUMMARY |
| T-08-06 (Langfuse env shape drift) | accept | Hand-rolled env per RESEARCH.md Example 8; pinned `3.175.0` |
| T-08-07 (brain-migrate silent failure) | mitigate | `depends_on: brain-migrate: service_completed_successfully` |
| T-08-08 (RabbitMQ default guest:guest accessible) | mitigate | `RABBITMQ_DEFAULT_USER=brain` / `RABBITMQ_DEFAULT_PASS=brain` set in compose |
| T-08-09 (Undefined env var → empty string baked in) | mitigate | `.env.example` (plan 01-03) defines every interpolated key; parity check in plan 01-09 |
| T-08-10 (ClickHouse first-boot timeout) | mitigate | `start_period: 60s` on clickhouse healthcheck |
| T-08-11 (alpine placeholder unpinned) | mitigate | Explicit `alpine:3.20` pin |
| T-08-12 (Lite drifts from full) | mitigate | Shared service blocks authored byte-identical; check-compose-parity.sh (plan 01-09) enforces |

## Notes for downstream plans / phases

- **Plan 01-09** ships:
  - `scripts/check-compose-parity.sh` — diffs the 6 shared service definitions (`brain`, `brain-migrate`, `brain-topology-init`, `brain-postgres`, `rabbitmq`, `qdrant`) between `docker-compose.yml` and `docker-compose.lite.yml`. Volume names are shared so no allow-list is needed; the only legitimate diff inside `brain` is the `BRAIN_LANGFUSE__ENABLED=false` env override in lite.
  - `scripts/smoke-up.sh lite` / `smoke-up.sh full` — `docker compose -f <file> up -d` then waits for `service_healthy` on every service with a healthcheck.

- **Phase 8** replaces `brain-topology-init` image + command in both compose files with the real aio-pika topology declarer and adds `brain-topology-init: service_completed_successfully` to Brain's `depends_on`. See `compose/brain-topology-init/README.md` for the planned shape.

- **Phase 9 / Open Question #2** — MinIO upstream archived community images early 2026. Pin is `RELEASE.2025-09-07T16-13-09Z-cpuv1`. Migration candidates: Garage, SeaweedFS, RustFS. Decision deferred until v1 production traffic is real.

- **Phase 9** — RabbitMQ rotation. Currently `brain:brain` matches `.env.example` `BRAIN_RABBITMQ__URL`. Rotate to per-environment credentials when Phase 9 hardens secrets.

## Verification Snapshot

| Check | Expected | Actual |
|-------|----------|--------|
| `docker-compose.yml` exists at repo root | yes | yes |
| Service heads in full | 12 (brain, brain-migrate, brain-topology-init, brain-postgres, rabbitmq, qdrant, langfuse-postgres, clickhouse, redis, minio, langfuse-web, langfuse-worker) | 12 ✓ |
| Service heads in lite | 6 (brain, brain-migrate, brain-topology-init, brain-postgres, rabbitmq, qdrant) | 6 ✓ |
| `healthcheck:` count in full | ≥ 10 | 10 keys (+ 1 mention in a comment) ✓ |
| `image: postgres:17-trixie` count in full | 2 (PITFALL 6.2) | 2 ✓ |
| MinIO pinned to `RELEASE.2025-09-07T16-13-09Z-cpuv1` | yes | yes ✓ |
| Langfuse-web pinned to `3.175.0` | yes | yes ✓ |
| Langfuse-worker pinned to `3.175.0` | yes | yes ✓ |
| Qdrant pinned to `v1.18.0` | yes | yes ✓ |
| RabbitMQ pinned to `4.1-management-alpine` | yes | yes ✓ |
| ClickHouse pinned to `24.8-alpine` | yes | yes ✓ |
| Redis pinned to `7-alpine` | yes | yes ✓ |
| alpine placeholder pinned to `3.20` | yes | yes ✓ |
| `:latest` absence in both compose files | absent | absent ✓ |
| Top-level `version:` field absence | absent | absent ✓ |
| Brain depends_on has no langfuse-* | clean | clean ✓ |
| `BRAIN_LANGFUSE__ENABLED=false` in lite brain service | present | present (line 99) ✓ |
| `compose/brain-topology-init/README.md` exists + mentions DEPLOY-06 + Phase 8 | yes | yes ✓ |

`docker compose config` runtime validation was not run in this sandbox (Docker unavailable). It is exercised by the verifier and plan 01-09's smoke-up against a real daemon.

## Commits

- `048d8e3` — 🏗️ build(01-08): author full-stack docker-compose.yml (10 services + 2 init containers)
- `3536bc8` — 🏗️ build(01-08): author docker-compose.lite.yml + brain-topology-init README

## Success Criteria

- DEPLOY-01 (full 10-service compose) — green
- DEPLOY-02 (lite subset compose, literally `docker-compose.lite.yml`) — green
- DEPLOY-04 (healthchecks everywhere + service_healthy depends_on) — green
- DEPLOY-05 (brain-migrate init runs Alembic + setup before Brain) — green (entrypoint from plan 01-06)
- DEPLOY-06 (brain-topology-init slot reserved) — green (placeholder + README)
- D-09 (5 Langfuse services pinned), D-10 (separate-file lite), D-11 (Brain depends only on core), D-12 (host port restrictions) — green

## Self-Check: PASSED

- `docker-compose.yml` — FOUND
- `docker-compose.lite.yml` — FOUND
- `compose/brain-topology-init/README.md` — FOUND
- commit `048d8e3` — FOUND in git log
- commit `3536bc8` — FOUND in git log
