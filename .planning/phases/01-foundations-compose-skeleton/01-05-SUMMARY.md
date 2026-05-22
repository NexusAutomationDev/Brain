---
phase: 01-foundations-compose-skeleton
plan: 05
subsystem: brain.api
tags: [fastapi, lifespan, healthz, readyz, uvicorn, graceful-shutdown, contextlib-suppress]
dependency_graph:
  requires:
    - "01-01 (pyproject pins for fastapi/uvicorn/psycopg/aio-pika/qdrant-client)"
    - "01-02 (brain.api package skeleton + README)"
    - "01-03 (brain.config.settings.get_settings + .shutdown.grace_seconds)"
    - "01-04 (brain.api.middleware.RequestIDMiddleware + brain.observability.configure_logging)"
  provides:
    - "brain.api.app.lifespan (asynccontextmanager opening pool/rabbit/qdrant + reverse-order close)"
    - "brain.api.app.create_app() (FastAPI factory: middleware + health router)"
    - "brain.api.app.app (module-level instance; uvicorn target = brain.api.app:app)"
    - "brain.api.health.router (/healthz + /readyz with TTL cache + per-probe timeout)"
    - "brain.api.health._reset_cache (test helper)"
    - "brain.api.health._CACHE_TTL_S = 5.0, _PROBE_TIMEOUT_S = 2.0 (overridable knobs)"
    - "brain.api.main.main() (`python -m brain.api.main` entrypoint with uvicorn.run + workers=1 + timeout_graceful_shutdown)"
  affects:
    - "Plan 01-07 (Dockerfile CMD = `python -m brain.api.main`)"
    - "Plan 01-08 (compose healthcheck hits /healthz; readiness gate via /readyz)"
    - "Plan 01-09 (smoke-up.sh asserts SIGTERM drain via `?sleep=` affordance + docker compose down)"
    - "Phase 3 (webhook handler binds bot_id/session_id contextvars after RequestIDMiddleware seeds the seven D-14 fields)"
    - "Phase 4 (Langfuse callback can attach to lifespan startup without lifecycle refactor)"
    - "Phase 6 (graph runtime reuses app.state.pool as the single source of truth for psycopg)"
    - "Phase 8 (aio-pika consumer attaches to the same lifespan; close happens between rabbit_conn.close() and pool.close() in shutdown chain)"
tech_stack:
  added: []  # all packages were already pinned by plan 01-01
  patterns:
    - "FastAPI `asynccontextmanager` lifespan with reverse-order shutdown (open: pool→rabbit→qdrant; close: qdrant→rabbit→pool)"
    - "`contextlib.suppress(Exception)` around each close so one broken dep does not prevent others from releasing"
    - "Module-level TTL cache for /readyz probes (D-06): `(timestamp_monotonic, checks_dict)` tuple; `_reset_cache()` test helper"
    - "`asyncio.wait_for(timeout=2.0)` per probe (D-05 / T-05-02 — hung dep cannot block readiness)"
    - "Per-dep status strings restricted to `'ok' | 'timeout' | 'error'` (T-05-03 — no exception text leaks to body)"
    - "FastAPI Query validation (`ge=0.0, le=5.0`) + defensive runtime clamp on `/healthz?sleep=` (test affordance for plan 01-09 drain assertion)"
    - "`uvicorn.run(..., workers=1, timeout_graceful_shutdown=settings.shutdown.grace_seconds, log_config=None)` — D-A4 + D-13 + structlog ownership"
    - "Lifespan-managed singletons exposed via `request.app.state.*` (NOT FastAPI Depends — Depends would re-resolve per request)"
key_files:
  created:
    - src/brain/api/app.py
    - src/brain/api/health.py
    - src/brain/api/main.py
    - tests/test_app.py
    - tests/test_health.py
    - tests/integration/test_shutdown.py
  modified:
    - src/brain/api/__init__.py
decisions:
  - "Subprocess-based SIGTERM drain test replaced with in-process `async with lifespan(app):` test, per plan 01-05's explicit escape-hatch. Reason: `aio_pika.connect_robust(...)` raises `AMQPConnectionError` on the FIRST connect to an unreachable broker (robust reconnect only engages after an initial successful handshake), so a stub URL doesn't work in subprocess mode. Container-level SIGTERM drain proof lands in plan 01-09's `scripts/smoke-up.sh` (docker compose down)."
  - "Each close in the lifespan finally-block is wrapped in `contextlib.suppress(Exception)` so a transient qdrant/rabbit close failure does not abort the chain and leave the pool open. Tested by `test_lifespan_shutdown_resilient_to_one_failing_close`."
  - "TTL cache + per-probe timeout knobs (`_CACHE_TTL_S`, `_PROBE_TIMEOUT_S`) live as module attributes so tests can `monkeypatch.setattr` them down to 0.1 s and finish quickly without compromising prod's 5 s / 2 s defaults."
  - "/healthz handler does NOT touch `request.app.state` so liveness is still 200 even if the lifespan has not finished opening external deps; /readyz raises 503 with `lifespan not initialized` when state attributes are absent."
  - "`brain.api/__init__.py` re-exports both plan 01-04's `RequestIDMiddleware` AND plan 01-05's `{app, create_app, lifespan}` under a single `__all__` so downstream phases can import either through the package surface."
metrics:
  duration_minutes: 10
  task_count: 2
  files_created: 6
  files_modified: 1
  tests_added: 25  # 12 health + 9 app + 4 lifespan integration (1 deferred-skip)
  commits: 4  # 2 RED + 2 GREEN
  completed_date: "2026-05-22"
---

# Phase 01 Plan 05: FastAPI App + Lifespan + /healthz + /readyz + Uvicorn Entrypoint — Summary

FastAPI app factory with a reverse-order lifespan that opens psycopg pool, aio-pika robust connection, and AsyncQdrantClient at startup and closes them in reverse at shutdown; `/healthz` is pure liveness with a bounded `?sleep=` test affordance; `/readyz` actively probes all three deps under a 2 s per-probe timeout with a 5 s TTL cache; uvicorn entrypoint passes `timeout_graceful_shutdown=settings.shutdown.grace_seconds` and `workers=1`.

## /healthz response shape

```json
GET /healthz                 → 200 {"status": "ok"}
GET /healthz?sleep=0.2       → 200 {"status": "ok"}      (delayed by ~200 ms)
GET /healthz?sleep=-1        → 422 (FastAPI Query ge=0.0)
GET /healthz?sleep=10        → 422 (FastAPI Query le=5.0)
```

The `?sleep=` parameter is a deliberate test affordance for plan 01-09's `scripts/smoke-up.sh` drain assertion across SIGTERM — bounded to `[0, 5]` so it can never DoS the liveness loop. The handler runs `await asyncio.sleep(min(sleep, 5.0))` before returning; this is a no-op in normal production traffic (no caller sends `?sleep=` outside the smoke test).

## /readyz response shape

Happy path (200):
```json
{"status": "ready", "checks": {"postgres": "ok", "rabbitmq": "ok", "qdrant": "ok"}}
```

1-dep error (503):
```json
{"status": "not_ready", "checks": {"postgres": "error", "rabbitmq": "ok", "qdrant": "ok"}}
```

Timeout (503, after `_PROBE_TIMEOUT_S = 2 s` wait):
```json
{"status": "not_ready", "checks": {"postgres": "ok", "rabbitmq": "ok", "qdrant": "timeout"}}
```

Partial failure (503, all three keys present):
```json
{"status": "not_ready", "checks": {"postgres": "ok", "rabbitmq": "error", "qdrant": "timeout"}}
```

Per-dep status is exactly one of `"ok" | "timeout" | "error"`. **No exception messages, no DSN fragments, no hostnames** leak into the body (T-05-03). The 5 s TTL cache prevents probe storms from compose healthchecks (T-05-01).

## Lifespan order

| Phase | Action |
| --- | --- |
| Startup 1 | `settings = get_settings()` |
| Startup 2 | `configure_logging(settings)` — BEFORE any other log line in this process |
| Startup 3 | `pool = AsyncConnectionPool(...)` then `await pool.open()` |
| Startup 4 | `rabbit_conn = await aio_pika.connect_robust(settings.rabbitmq.url)` |
| Startup 5 | `qdrant = AsyncQdrantClient(url=..., api_key=...)` |
| Startup 6 | Bind to `app.state.{settings, pool, rabbit, qdrant}` |
| Startup 7 | `log.info("startup_complete", service="brain", grace_seconds=...)` |
| yield  | request handlers serve traffic |
| Shutdown 1 | `log.info("shutdown_begin", ...)` |
| Shutdown 2 | `await qdrant.close()` (suppress exceptions) |
| Shutdown 3 | `await rabbit_conn.close()` (suppress exceptions) |
| Shutdown 4 | `await pool.close()` (suppress exceptions) |
| Shutdown 5 | `log.info("shutdown_complete", ...)` |

The `startup_complete` line carries **only** `service` + `grace_seconds` — never the auth token, never the DSN (T-05-07). `test_lifespan_does_not_leak_secrets_to_logs` asserts this against captured stdout/stderr.

## BRAIN_SHUTDOWN__GRACE_SECONDS env flow

```
process env: BRAIN_SHUTDOWN__GRACE_SECONDS=30
  └─ pydantic-settings (Settings.shutdown.grace_seconds: int = 30)
       └─ brain.api.main:main()
            └─ uvicorn.run(..., timeout_graceful_shutdown=settings.shutdown.grace_seconds)
                 └─ uvicorn:
                      - SIGTERM received
                      - close listening socket
                      - wait up to grace_seconds for in-flight requests to drain
                      - unwind FastAPI lifespan (shutdown chain above)
                      - exit rc=0 if drained, rc=-9 (SIGKILL) if grace exceeded
```

`workers=1` is non-negotiable (D-A4 — in-process `asyncio.Lock` registry assumes single worker; horizontal scale via more containers, not more workers per container).

## Tests added (25, all green)

`tests/test_health.py` (12):
- /healthz happy + sleep param (`0.2 s` delay, `-1` rejected, `10` clamped/rejected)
- /readyz happy → 200
- /readyz with postgres/rabbitmq error → 503 + per-dep `"error"`
- /readyz with qdrant slow probe → 503 + qdrant `"timeout"` (probe timeout monkey-patched to 0.1 s)
- /readyz cache window respected (2 calls within TTL = 1 probe invocation)
- /readyz cache expires after TTL (TTL monkey-patched to 0.05 s)
- /readyz partial failure lists all three deps
- /readyz response shape contract (`{status, checks{postgres, rabbitmq, qdrant}}`)

`tests/test_app.py` (9):
- `create_app()` returns FastAPI; includes `RequestIDMiddleware`; mounts /healthz + /readyz
- Module-level `brain.api.app:app` is a FastAPI instance (uvicorn target)
- `lifespan` is an async context manager
- `main()` calls `uvicorn.run` with `timeout_graceful_shutdown=settings.shutdown.grace_seconds`, `workers=1`, `host="0.0.0.0"`, `port=8000`, target `"brain.api.app:app"`
- `brain.api` package re-exports `{RequestIDMiddleware, app, create_app, lifespan}`

`tests/integration/test_shutdown.py` (4 + 1 deferred-skip):
- Lifespan startup + shutdown complete without exception
- Open: pool→rabbit→qdrant; close: qdrant→rabbit→pool (reverse order verified via call_order tracking)
- Shutdown resilient: one failing close does NOT prevent the others (T-05-04 hardening)
- startup_complete log line does NOT leak auth token / DSN (T-05-07)
- (skipped) Container-level SIGTERM rc=0 — deferred to plan 01-09 smoke-up.sh

Run:
```text
uv run pytest tests/test_app.py tests/test_health.py tests/integration/test_shutdown.py
# → 25 passed, 1 skipped
uv run ruff check src/brain/api/ tests/test_app.py tests/test_health.py tests/integration/test_shutdown.py
# → All checks passed!
```

## Smoke check

```text
$ uv run python -c "from brain.api.app import app, create_app, lifespan; \
                     from brain.api.main import main; \
                     from brain.api import RequestIDMiddleware; \
                     print(type(app).__name__)"
FastAPI
```

## Threat surface scan

All eight threats in the plan's `<threat_model>` register with disposition `mitigate` are covered:

| Threat ID | Mitigation | Evidence |
|-----------|------------|----------|
| T-05-01 | TTL cache prevents probe storms | `_CACHE_TTL_S = 5.0`; `test_readyz_cache_window_respected` |
| T-05-02 | Per-probe `asyncio.wait_for(timeout=2 s)` | `_PROBE_TIMEOUT_S = 2.0`; `test_readyz_qdrant_timeout` |
| T-05-03 | Probe handlers return only `"ok"/"timeout"/"error"` | `_run_probe` swallows exceptions; no string interpolation in body |
| T-05-04 | uvicorn `--timeout-graceful-shutdown` + reverse-order close + `contextlib.suppress` per step | `test_lifespan_shutdown_resilient_to_one_failing_close` |
| T-05-05 | `workers=1` hardcoded in `main.py` | `test_main_invokes_uvicorn_with_grace_flag` asserts `kwargs["workers"] == 1` |
| T-05-06 | Lifespan startup exception → uvicorn refuses to bind | RESEARCH.md Pattern 5 cited behavior; documented in app.py docstring |
| T-05-07 | startup_complete logs only `service` + `grace_seconds` | `test_lifespan_does_not_leak_secrets_to_logs` |
| T-05-08 | Langfuse NOT probed in /readyz | health.py docstring + absence of langfuse import |

No new attack surface introduced beyond the threat register.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Subprocess-based SIGTERM integration test infeasible without live RabbitMQ**
- **Found during:** Task 2 integration test run.
- **Issue:** The plan-of-record was to spawn `python -m brain.api.main` against a testcontainers Postgres + bogus rabbit/qdrant URLs, then send SIGTERM. `aio_pika.connect_robust("amqp://...:1/")` raises `AMQPConnectionError` on the FIRST connect attempt (robust reconnect only engages AFTER an initial successful handshake), so the lifespan body fails at startup and uvicorn never binds the socket. The 30 s health-poll times out before SIGTERM is even sent.
- **Fix:** Replaced the subprocess test with four in-process `async with lifespan(app):` tests that monkey-patch the three external dep constructors. This is the explicit escape-hatch authorized by plan 01-05's `<action>` block: *"If full subprocess test proves flaky, simplify to: in-process `async with lifespan(create_app())` then assert it cleanly exits without exception."* A 5th test stub remains in the file as `@pytest.mark.skip` with rationale pointing at plan 01-09's smoke-up.sh.
- **Files modified:** `tests/integration/test_shutdown.py`.
- **Commit:** `8d28dda`.

**2. [Rule 2 — Critical hardening] `contextlib.suppress(Exception)` per close step in lifespan finally-block**
- **Found during:** Task 2 GREEN write.
- **Issue:** The reference snippet in RESEARCH.md Pattern 5 chained `await qdrant.close(); await rabbit.close(); await pool.close()` without exception isolation. If qdrant's close raised (e.g., transient network blip), the rabbit + pool cleanups would be skipped — pool would leak its psycopg connections and the process exit would dangle. T-05-04 ("SIGTERM ignored, request stuck → SIGKILL drops in-flight HTTP responses") explicitly covers this failure mode.
- **Fix:** Wrap each `await dep.close()` in `with contextlib.suppress(Exception):`. Loss of one close-step's exception is acceptable because (a) the process is shutting down anyway, (b) shutdown logs already carry the error context, (c) leaking the other two cleanups is strictly worse. `test_lifespan_shutdown_resilient_to_one_failing_close` enforces this contract.
- **Files modified:** `src/brain/api/app.py`.
- **Commit:** `8d28dda`.

**3. [Rule 3 — Blocking] `import brain.api.app as app_mod` resolves to the FastAPI instance, not the module**
- **Found during:** Task 2 test write.
- **Issue:** `brain.api/__init__.py` re-exports `app = create_app()` from `brain.api.app`, so `import brain.api.app as app_mod` returns the FastAPI instance (the package attribute shadows the module reference). `importlib.reload(app_mod)` then raises `TypeError: reload() argument must be a module`.
- **Fix:** Use `importlib.import_module("brain.api.app")` + `sys.modules["brain.api.app"]` to force module-object lookup. Documented inline in `test_module_level_app_is_fastapi` and the `stubbed_lifespan_deps` fixture.
- **Files modified:** `tests/test_app.py`, `tests/integration/test_shutdown.py`.
- **Commit:** `8d28dda`.

### Deferred / Out-of-Scope (not patched by this plan)

- **Container-level SIGTERM drain proof** — owned by plan 01-09's `scripts/smoke-up.sh` (docker compose down). Deliberately deferred per the plan-of-record's `<action>` step 5.
- **In-flight long-request drain assertion** — the `/healthz?sleep=` affordance is wired here, but the drain assertion itself lands in plan 01-09 because no real long-running endpoint exists until Phase 3.
- **Pre-existing `tests/integration/test_migrate.py` failures** (`ModuleNotFoundError: psycopg2`) — already documented in plan 01-06's deferred items; NOT introduced by this plan.

## Notes for later phases

- **Plan 01-07 (Dockerfile):** `CMD ["python", "-m", "brain.api.main"]`. Healthcheck: `python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)"` (no curl/wget needed; uses stdlib).
- **Plan 01-08 (compose):** healthcheck hits `/healthz` (cheap; dep-free). `depends_on: brain: condition: service_healthy` is satisfied once the lifespan opens deps successfully.
- **Plan 01-09 (smoke):** call `GET /healthz?sleep=4` in a background curl, then `docker compose down` and assert the curl request still got a 200 — proves in-flight drain across SIGTERM at container level.
- **Phase 3 (webhook):** after `BrainRequest` validation, `structlog.contextvars.bind_contextvars(bot_id=..., session_id=..., schema_version=...)` overwrites the `"-"` placeholders that `RequestIDMiddleware` seeded.
- **Phase 4 (Langfuse):** Phase-4 plan inserts a `langfuse_client = Langfuse(...)` build between the qdrant client open and the `app.state` bind; close goes between `qdrant.close()` and `rabbit.close()` in the reverse-order chain.
- **Phase 6 (graph runtime):** reuse `app.state.pool` as the single source of truth for psycopg; do NOT open a second pool. The per-`(bot_id, session_id)` `asyncio.Lock` registry lives next to the pool reference.
- **Phase 8 (RabbitMQ consumer):** the consumer is started AFTER `rabbit_conn` is bound in startup; in shutdown, `await consumer.stop()` runs BEFORE `await rabbit_conn.close()` (between qdrant.close and rabbit.close) so messages drain into the broker before the AMQP channel closes.

## Requirements Closed by This Plan

| Req | How |
|-----|-----|
| FOUND-03 | `/healthz` + `/readyz` with documented shapes; 12 unit tests assert happy + failure + cache + shape |
| FOUND-09 | Lifespan reverse-order close + uvicorn `timeout_graceful_shutdown=settings.shutdown.grace_seconds` + in-process drain test; container-level proof deferred to plan 01-09 smoke |
| D-05 | 3-dep probe (postgres + rabbitmq + qdrant) in `/readyz`; per-dep result string |
| D-06 | 2 s per-probe timeout + 5 s TTL cache, both module-level knobs |
| D-11 | Langfuse intentionally NOT probed in `/readyz` (cited in health.py docstring + absence from probes) |
| D-13 | `BRAIN_SHUTDOWN__GRACE_SECONDS` → `Settings.shutdown.grace_seconds` → uvicorn flag |
| D-A4 | `workers=1` hardcoded in `brain.api.main` |

## Threat Flags

None. No new surface beyond what the plan's `<threat_model>` already enumerates.

## Self-Check

Files exist:
- `src/brain/api/app.py` — FOUND (commit 8d28dda)
- `src/brain/api/health.py` — FOUND (commit fc31f57)
- `src/brain/api/main.py` — FOUND (commit 8d28dda)
- `src/brain/api/__init__.py` — FOUND (modified in commit 8d28dda)
- `tests/test_app.py` — FOUND (commits 4f04571, 8d28dda)
- `tests/test_health.py` — FOUND (commit 7ceb69f, 8d28dda for fixes)
- `tests/integration/test_shutdown.py` — FOUND (commits 4f04571, 8d28dda)

Commits exist:
- `7ceb69f` (RED health) — FOUND
- `fc31f57` (GREEN health) — FOUND
- `4f04571` (RED app + shutdown) — FOUND
- `8d28dda` (GREEN app + shutdown + ruff fixes) — FOUND

Verification:
- `uv run pytest tests/test_app.py tests/test_health.py tests/integration/test_shutdown.py` → **25 passed, 1 skipped**
- `uv run ruff check src/brain/api/ tests/test_app.py tests/test_health.py tests/integration/test_shutdown.py` → **All checks passed!**
- `uv run python -c "from brain.api.app import app, create_app, lifespan; from brain.api.main import main; from brain.api import RequestIDMiddleware; print(type(app).__name__)"` → **FastAPI**

## Self-Check: PASSED
