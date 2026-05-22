---
phase: 01-foundations-compose-skeleton
plan: 04
subsystem: foundations
tags: [logging, structlog, thread-id, request-id, middleware, contextvars, lint, pre-commit]
requires:
  - "01-01: pre-commit + ruff config (T201/G004 in pyproject.toml; ruff hook in .pre-commit-config.yaml)"
  - "01-02: package skeleton (src/brain/observability, src/brain/graph, src/brain/api stubs)"
provides:
  - "brain.observability.configure_logging(settings)"
  - "brain.observability.get_logger(name)"
  - "brain.graph.thread_id(bot_id, session_id) -> str"
  - "brain.api.RequestIDMiddleware (Starlette BaseHTTPMiddleware)"
  - "scripts/lint/ban-asyncpg.sh"
  - "scripts/lint/ban-sync-postgressaver.sh"
  - "scripts/lint/ban-raw-thread-id.sh"
  - "scripts/lint/ban-stdlib-logging.sh"
  - "4 local pre-commit hooks: ban-asyncpg, ban-sync-postgressaver, ban-raw-thread-id, ban-stdlib-logging"
affects:
  - "tests/test_logging.py, tests/test_request_id_middleware.py, tests/test_thread_id.py, tests/test_lint_bans.py"
tech-stack:
  added: []
  patterns:
    - "structlog ProcessorFormatter bridge (nymous-gist canonical 2026 pattern)"
    - "structlog.contextvars (request-scoped fields without manual bind/unbind)"
    - "Starlette BaseHTTPMiddleware (sync dispatch around async call_next)"
    - "pre-commit local hooks (language: system; pass_filenames: true)"
key-files:
  created:
    - src/brain/observability/logging.py
    - src/brain/api/middleware.py
    - src/brain/graph/thread.py
    - scripts/lint/ban-asyncpg.sh
    - scripts/lint/ban-sync-postgressaver.sh
    - scripts/lint/ban-raw-thread-id.sh
    - scripts/lint/ban-stdlib-logging.sh
    - tests/test_logging.py
    - tests/test_request_id_middleware.py
    - tests/test_thread_id.py
    - tests/test_lint_bans.py
  modified:
    - src/brain/observability/__init__.py
    - src/brain/api/__init__.py
    - src/brain/graph/__init__.py
    - .pre-commit-config.yaml
decisions:
  - "configure_logging accepts a duck-typed object (.log_format, .log_level) rather than importing brain.config.settings.Settings directly — keeps 01-04 independent of 01-03 (parallel Wave 2a/2b) and avoids a hard import cycle if log config needs to evolve."
  - "Bridge module src/brain/observability/logging.py is the only file under src/brain/ allowed to import stdlib logging; ban-stdlib-logging.sh allowlists this path explicitly alongside alembic/."
  - "Ban scripts use bash `case` path patterns rather than file-content extension checks so that allowlisting (e.g. scripts/, alembic/env.py, observability/logging.py) is deterministic and easy to audit."
metrics:
  duration: "1 session"
  completed: "2026-05-22"
---

# Phase 1 Plan 04: Structlog + Thread-ID Helper + Lint Bans Summary

JSON logging that survives uvicorn's access log, a single sanctioned `thread_id(bot_id, session_id)` constructor, the seven D-14 canonical structlog contextvars wired by `RequestIDMiddleware`, and four grep-level pre-commit bans (`asyncpg`, sync `PostgresSaver`, raw f-string thread_id, stdlib `logging`) that physically prevent the corresponding regressions from landing.

## Final shape of `configure_logging()`

The 6-step recipe (see `src/brain/observability/logging.py`):

1. Build shared processor chain: `[merge_contextvars, add_logger_name, add_log_level, PositionalArgumentsFormatter, StackInfoRenderer, TimeStamper(fmt="iso", utc=True)]`.
2. Pick renderer by `settings.log_format`: `JSONRenderer()` in json mode (also append `format_exc_info`), else `ConsoleRenderer(colors=True)`.
3. `structlog.configure(...)` with `shared_processors + [wrap_for_formatter]`, `LoggerFactory()`, `BoundLogger`, `cache_logger_on_first_use=True`.
4. Build `ProcessorFormatter(foreign_pre_chain=shared_processors, processors=[remove_processors_meta, renderer])`.
5. Install a single `StreamHandler(sys.stdout)` on the root logger with that formatter, via `logging.basicConfig(level=..., handlers=[h], force=True)`.
6. For each noisy logger (`uvicorn`, `uvicorn.access`, `uvicorn.error`, `httpx`, `httpcore`): clear its own handlers and set `propagate=True` so records bubble to the root + structlog-aware handler — single JSON line per record, no PITFALL 5 double-format.

`get_logger(name)` is a thin wrapper around `structlog.get_logger` so a future cross-cutting concern (log-level guard, sampling, ...) has one place to land.

## Canonical D-14 contextvars set (7 fields)

Bound by `RequestIDMiddleware.dispatch` at the start of every HTTP request, after `clear_contextvars()`:

| Field            | Phase 1 value             | Filled later by                                 |
|------------------|---------------------------|-------------------------------------------------|
| `request_id`     | `x-request-id` ⇒ UUID4    | (already correct)                               |
| `service`        | `"brain"`                  | (constant)                                       |
| `ingress`        | `"http"`                   | Phase 8 RabbitMQ consumer also binds `"amqp"`    |
| `bot_id`         | `"-"`                      | Phase 3 (after payload parsing)                  |
| `session_id`     | `"-"`                      | Phase 3 (after payload parsing)                  |
| `trace_id`       | `"-"`                      | Phase 4 (Langfuse callback)                      |
| `schema_version` | `"-"`                      | Phase 3 (after request validation)               |

Response headers always carry the same `x-request-id` value so clients can correlate.

## `thread_id` helper signature + validation rules

```python
def thread_id(bot_id: str, session_id: str) -> str: ...
```

Returns `f"{bot_id}:{session_id}"` (`_SEP = ":"`).

Raises `ValueError` if either argument is empty OR contains the separator. Bare `f"{bot}:{session}"` construction outside `src/brain/graph/thread.py` is rejected by `scripts/lint/ban-raw-thread-id.sh` (FOUND-08 / PITFALL 10.1). Phase 6 will import this helper when wiring `AsyncPostgresSaver`; Phase 6's lock registry will key on the same `thread_id` string.

## 4 grep ban hooks + allowlist semantics

All four scripts share the same shape: bash `case` statement gates on file path → `grep -nE` for the forbidden pattern → exit `1` with an `ERROR:` message on stderr. Each script is `chmod 755` and committed with mode 100755.

| Script                              | Forbidden                                                             | Allowlisted paths                                     | Owner REQ      |
|-------------------------------------|------------------------------------------------------------------------|--------------------------------------------------------|----------------|
| `ban-asyncpg.sh`                    | `^\s*(import asyncpg\|from asyncpg)` in `src/brain/**`                | (only inspects `src/brain/**.py`)                      | FOUND-06       |
| `ban-sync-postgressaver.sh`         | `from langgraph.checkpoint.postgres import ...PostgresSaver`           | `scripts/**`                                            | D-17           |
| `ban-raw-thread-id.sh`              | f-string `f"{...}:{...}"` in `src/brain/**`                            | `src/brain/graph/thread.py`                            | FOUND-08       |
| `ban-stdlib-logging.sh`             | `^\s*(import logging\|from logging)` in `src/brain/**`                | `alembic/env.py`, `alembic/versions/*.py`, `src/brain/observability/logging.py` | FOUND-10 / D-15 |

The `.pre-commit-config.yaml` `local` block uses `language: system`, `types: [python]`, `pass_filenames: true` so pre-commit hands each staged python file path as positional args. The `case` patterns in each script then filter to the relevant subset — keeps the diff/CI fast and the allowlists declarative.

## Confirmation

- `uv run pytest -x tests/test_logging.py tests/test_request_id_middleware.py tests/test_thread_id.py tests/test_lint_bans.py` → **38 passed**.
- Each ban script invoked manually against all six created/modified `src/brain/` files (`logging.py`, `middleware.py`, `thread.py`, three `__init__.py`s) returns exit code `0` (no violations).
- `uv run ruff check src/brain/observability/ src/brain/api/ src/brain/graph/ tests/test_logging.py tests/test_request_id_middleware.py tests/test_thread_id.py tests/test_lint_bans.py` → **All checks passed.**
- `uv run python -c "from brain.observability import configure_logging, get_logger; from brain.graph import thread_id; from brain.api import RequestIDMiddleware; print('ok')"` → prints `ok`.

`uvx pre-commit run --all-files` (required by the plan's `<verify>`) was **not run** because `uvx` is restricted in this executor sandbox. The ban-script behaviour is fully covered by `tests/test_lint_bans.py` (19 tests including positive, negative, and allowlist cases) and a direct subprocess run on the actual plan files. The orchestrator's verifier should re-run `uvx pre-commit run --all-files` after wave merge.

## Threat surface scan

All four threats in the plan's `<threat_model>` register with disposition `mitigate` are covered by tests:

| Threat ID | Mitigation                                                  | Test                                                                                |
|-----------|-------------------------------------------------------------|-------------------------------------------------------------------------------------|
| T-04-01   | `ban-sync-postgressaver.sh` rejects sync import             | `test_ban_sync_postgressaver_rejects` + `_allows_scripts` + `_accepts_async_variant` |
| T-04-02   | `ban-raw-thread-id.sh` + `thread_id` empty/separator checks | `test_ban_raw_thread_id_rejects` + `_allows_helper` + `_accepts_clean`; thread_id tests |
| T-04-03   | uvicorn loggers routed through `ProcessorFormatter`         | `test_uvicorn_access_routed_through_structlog`                                       |
| T-04-04   | `clear_contextvars()` at start of dispatch                  | `test_contextvars_cleared_between_requests`                                          |
| T-04-05   | `ban-asyncpg.sh`                                            | `test_ban_asyncpg_rejects` + `_accepts_clean` + `_ignores_files_outside_src_brain`  |
| T-04-06   | `ban-stdlib-logging.sh`                                     | `test_ban_stdlib_logging_rejects` (+ from-import variant + 3 allowlist tests)        |
| T-04-07   | accept; covered by test suite + code review                 | n/a                                                                                  |

No new attack surface introduced beyond what the threat register already covered.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `configure_logging` settings parameter typing**
- **Found during:** Task 1 implementation.
- **Issue:** Plan instructs `configure_logging(settings: Settings)` but `brain.config.settings.Settings` is provided by plan 01-03 in the parallel Wave 2 — at import time in this worktree it does not exist.
- **Fix:** Use `from __future__ import annotations` + `TYPE_CHECKING` import for `Settings`, accept `Settings | Any`, and read attributes via `getattr(settings, "log_format", "json")` / `getattr(settings, "log_level", "INFO")`. After Wave-merge, the duck-typed call still works against the concrete `Settings` class because plan 01-03 publishes `.log_format` and `.log_level` per its `<interfaces>` block.
- **Files modified:** `src/brain/observability/logging.py`.
- **Commit:** `885865c`.

**2. [Rule 3 — Blocking] ruff auto-fix moved `RequestResponseEndpoint` import into `TYPE_CHECKING`**
- **Found during:** Task 1 `uv run ruff check --fix`.
- **Issue:** Ruff flagged unused-import/import-block ordering. The auto-fix retained the `TYPE_CHECKING` guard, which works at runtime because `from __future__ import annotations` defers annotation evaluation.
- **Fix:** Accept the ruff fix as-is.
- **Files modified:** `src/brain/api/middleware.py`, `tests/test_request_id_middleware.py`.
- **Commit:** `885865c`.

**3. [Rule 3 — Blocking] ruff auto-fix removed unused `os` import from `tests/test_lint_bans.py`**
- **Found during:** Task 2 `uv run ruff check --fix`.
- **Fix:** Accept the ruff fix (the import wasn't used).
- **Commit:** `04c9a00`.

### Out-of-scope discoveries (deferred — see `deferred-items.md`)

- `src/brain/db/__init__.py:1` exceeds ruff `line-length=100` (102 chars). Pre-existing from plan 01-02. Not caused by 01-04. Logged in `.planning/phases/01-foundations-compose-skeleton/deferred-items.md` for plan 01-06 or a `chore` follow-up.

## Notes for later phases

- **Phase 5:** add `scripts/lint/ban-raw-openai.sh` and `scripts/lint/ban-raw-genai.sh` when provider adapters land (D-17 explicitly defers these to Phase 5).
- **Phase 7:** add `scripts/lint/ban-raw-qdrant-client.sh` when vectordb lands.
- **Plan 01-05 (Wave 2b):** when wiring the FastAPI app factory, register `RequestIDMiddleware` FIRST (it must run before any other middleware so all later log lines carry `request_id`), and call `configure_logging(get_settings())` inside the `lifespan` startup phase.
- **Phase 3:** when the webhook handler parses `BrainRequest`, call `structlog.contextvars.bind_contextvars(bot_id=req.botId, session_id=req.sessionId, schema_version=str(req.schema_version))` to overwrite the `"-"` placeholders.
- **Phase 4:** when the Langfuse trace is created, call `bind_contextvars(trace_id=trace.id)` similarly.
- **Phase 6:** import `from brain.graph import thread_id` when wiring `AsyncPostgresSaver`; thread_id collisions are now physically impossible at the construction boundary.

## Self-Check

Files exist:
- `src/brain/observability/logging.py` — FOUND
- `src/brain/api/middleware.py` — FOUND
- `src/brain/graph/thread.py` — FOUND
- `scripts/lint/ban-asyncpg.sh` (mode 100755) — FOUND
- `scripts/lint/ban-sync-postgressaver.sh` (mode 100755) — FOUND
- `scripts/lint/ban-raw-thread-id.sh` (mode 100755) — FOUND
- `scripts/lint/ban-stdlib-logging.sh` (mode 100755) — FOUND
- `tests/test_logging.py` — FOUND
- `tests/test_request_id_middleware.py` — FOUND
- `tests/test_thread_id.py` — FOUND
- `tests/test_lint_bans.py` — FOUND

Commits exist:
- `bb23a27` (RED logging+middleware) — FOUND
- `885865c` (GREEN logging+middleware) — FOUND
- `1695eec` (RED thread_id+bans) — FOUND
- `04c9a00` (GREEN thread_id+bans) — FOUND
- `344160e` (deferred items doc) — FOUND

## Self-Check: PASSED
