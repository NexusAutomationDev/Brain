---
phase: 01-foundations-compose-skeleton
reviewed: 2026-05-22T00:00:00Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - .env.example
  - .github/workflows/ci.yml
  - .gitignore
  - .gitleaks.toml
  - .gitleaksignore
  - .pre-commit-config.yaml
  - .python-version
  - alembic.ini
  - alembic/env.py
  - alembic/script.py.mako
  - alembic/versions/0001_create_brain_schema.py
  - docker-compose.lite.yml
  - docker-compose.yml
  - docker/Dockerfile
  - .dockerignore
  - pyproject.toml
  - scripts/check-compose-parity.sh
  - scripts/check-env-example.sh
  - scripts/lint/ban-asyncpg.sh
  - scripts/lint/ban-raw-thread-id.sh
  - scripts/lint/ban-stdlib-logging.sh
  - scripts/lint/ban-sync-postgressaver.sh
  - scripts/smoke-readme.sh
  - scripts/smoke-up.sh
  - src/brain/__init__.py
  - src/brain/api/__init__.py
  - src/brain/api/app.py
  - src/brain/api/health.py
  - src/brain/api/main.py
  - src/brain/api/middleware.py
  - src/brain/config/__init__.py
  - src/brain/config/constants.py
  - src/brain/config/schema_version.py
  - src/brain/config/settings.py
  - src/brain/db/__init__.py
  - src/brain/db/checkpointer.py
  - src/brain/db/migrate.py
  - src/brain/db/pool.py
  - src/brain/graph/__init__.py
  - src/brain/graph/thread.py
  - src/brain/observability/__init__.py
  - src/brain/observability/logging.py
findings:
  critical: 1
  warning: 6
  info: 9
  total: 16
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

## Summary

Phase 01 lays a clean foundation: nested Pydantic Settings with strict `BRAIN_*` env-key validation, an async-only Postgres data plane (psycopg v3), structlog-bridged stdlib logging, a non-root prod Docker image, and four custom pre-commit lint hooks enforcing the architectural bans called out in CLAUDE.md (asyncpg, sync `PostgresSaver`, raw `f"{bot}:{session}"` thread_ids, stdlib `logging` inside `src/brain/`). The lint hooks and architectural guardrails are well-targeted and correctly scoped.

The dominant concern is a **single Critical bug** in the prod `Dockerfile`: the `CMD` wraps `uvicorn` in `sh -c` without `exec`, so PID 1 becomes `sh` and SIGTERM is not forwarded to the uvicorn process — silently defeating the FOUND-09 / D-13 graceful-shutdown contract that the rest of Phase 01 was carefully built to honor. Several Warnings cover lifespan resource leaks on partial startup, a script env-var name typo that disables grace-period overrides in smoke tests, log-injection risk via the `X-Request-ID` header, and an Alembic options-rewriting branch that silently drops user-set Postgres `-c` directives. Info-level items are mostly style and forward-looking robustness suggestions.

No secrets, no command-injection patterns, no SQL-injection patterns, and no `eval`/`exec` usage detected. Architectural bans (asyncpg, sync PostgresSaver) are not violated anywhere in the reviewed sources.

## Critical Issues

### CR-01: Prod Dockerfile CMD does not exec uvicorn — defeats FOUND-09 graceful shutdown

**File:** `docker/Dockerfile:95`

**Issue:** The prod CMD wraps `uvicorn` in `sh -c` to expand `${BRAIN_SHUTDOWN__GRACE_SECONDS:-30}`, but does NOT use `exec`. The container's PID 1 is therefore `/bin/sh`, and `uvicorn` runs as a child process. POSIX `sh` does not forward signals to its children by default, so when Docker / Kubernetes / `docker compose stop` sends SIGTERM to PID 1, the signal goes to `sh`, not to `uvicorn`. `uvicorn`'s graceful shutdown handler (which honors `--timeout-graceful-shutdown`) is never invoked; the kernel kills the entire process group after the docker stop grace period (default 10 s). This silently breaks the FOUND-09 / D-13 contract that the smoke-up.sh drain assertion is supposed to prove, and may mask the bug since BusyBox / dash on Alpine sometimes do forward signals — behavior is shell-dependent.

This is the single change most likely to invalidate Phase 01's graceful-shutdown promise in production.

**Fix:**
```dockerfile
CMD ["sh", "-c", "exec uvicorn brain.api.app:app --host 0.0.0.0 --port 8000 --workers 1 --timeout-graceful-shutdown ${BRAIN_SHUTDOWN__GRACE_SECONDS:-30}"]
```
The `exec` keyword replaces the shell process with uvicorn, making uvicorn PID 1 and ensuring SIGTERM goes straight to it. Add an integration test (or extend `scripts/smoke-up.sh`) that asserts `pid 1` inside the running container is `python` / `uvicorn`, not `sh`, e.g. `docker exec brain ps -o pid,comm 1 | grep -F uvicorn`.

## Warnings

### WR-01: Lifespan leaks Postgres pool / rabbit conn if a later startup step fails

**File:** `src/brain/api/app.py:58-76`

**Issue:** Startup opens resources sequentially: `pool.open()`, then `aio_pika.connect_robust(...)`, then constructs `AsyncQdrantClient`. If `connect_robust` raises (RabbitMQ unreachable), the already-opened `pool` is leaked — it never reaches the `try/finally` block (which only wraps `yield`). uvicorn will refuse to bind the port (correct), but the Postgres connections opened by `pool.open()` remain held until process exit (acceptable since the process is about to die) and, more importantly, the pattern is fragile: any future addition between `pool.open()` and the `try:` (e.g., a Langfuse handler in Phase 4) inherits the same leak. Same risk applies to `rabbit_conn` if Qdrant construction were to raise (today it's lazy, but Phase 7 may add a probe here).

**Fix:** Either restructure each resource into a nested `async with` chain, or use a single `AsyncExitStack` that the `finally` clause unwinds — both guarantee cleanup on partial failure:
```python
import contextlib

async with contextlib.AsyncExitStack() as stack:
    pool = AsyncConnectionPool(conninfo=settings.postgres.dsn, ..., open=False)
    await stack.enter_async_context(pool)  # pool.__aexit__ closes it
    rabbit_conn = await aio_pika.connect_robust(settings.rabbitmq.url)
    stack.push_async_callback(rabbit_conn.close)
    qdrant = AsyncQdrantClient(url=settings.qdrant.url, api_key=settings.qdrant.api_key)
    stack.push_async_callback(qdrant.close)

    app.state.settings = settings
    app.state.pool = pool
    app.state.rabbit = rabbit_conn
    app.state.qdrant = qdrant
    log.info("startup_complete", service="brain", grace_seconds=settings.shutdown.grace_seconds)
    try:
        yield
    finally:
        log.info("shutdown_begin", service="brain")
        # stack unwinds in reverse order on exit
    log.info("shutdown_complete", service="brain")
```

### WR-02: smoke-up.sh reads wrong env-var name for shutdown grace — uses single underscore

**File:** `scripts/smoke-up.sh:140`

**Issue:** The script reads `BRAIN_SHUTDOWN_GRACE_SECONDS` (single underscore), but the canonical env name used everywhere else (`.env.example:11`, `src/brain/config/settings.py` nested-delimiter `__`, `docker/Dockerfile:95`) is `BRAIN_SHUTDOWN__GRACE_SECONDS` (double underscore — pydantic-settings' nested delimiter). As written, the script always falls back to `30` and never honors a developer-set grace window. This makes the drain assertion silently insensitive to BRAIN_SHUTDOWN__GRACE_SECONDS tuning — a low-impact bug today (30 s is plenty for the synthetic 2 s in-flight request) but exactly the kind of "name drifted apart" defect the env-parity hook in CI is meant to prevent.

**Fix:**
```bash
DRAIN_GRACE="${BRAIN_SHUTDOWN__GRACE_SECONDS:-30}"
```
Optionally, add a one-line assertion at script start that the canonical env name resolves: `: "${BRAIN_SHUTDOWN__GRACE_SECONDS:=30}"` and reuse that variable.

### WR-03: RequestIDMiddleware accepts unsanitized X-Request-ID — log injection risk

**File:** `src/brain/api/middleware.py:48-63`

**Issue:** `req_id = request.headers.get("x-request-id") or str(uuid.uuid4())` accepts any client-supplied string verbatim, binds it into the structlog contextvars (which then appear in every JSON log line), and echoes it back in the response header. There is no length cap and no charset filter. A malicious client can send `X-Request-ID: "abc\",\"injected\":\"payload\nfake-line"` and (depending on the JSON renderer's escaping) attempt to poison downstream log parsers; at minimum, oversized headers (multi-KB) are reflected into every log record for the request's lifetime, amplifying log volume. Echoing it back also enables reflected-content trivial attacks (response splitting is mitigated by Starlette's header encoder, but the log-poisoning vector remains).

**Fix:** Validate the header against a strict charset and cap length before binding/echoing. Treat any non-conforming value as untrusted and replace with a fresh UUID4:
```python
import re
_REQ_ID_RE = re.compile(r"^[A-Za-z0-9._\-]{1,128}$")

raw = request.headers.get("x-request-id", "")
req_id = raw if _REQ_ID_RE.fullmatch(raw) else str(uuid.uuid4())
```
A 128-char cap and `[A-Za-z0-9._-]` charset comfortably covers UUIDs, ULIDs, and W3C traceparent IDs while blocking newline / quote injection.

### WR-04: build_langgraph_dsn silently drops sibling -c options when search_path is already set

**File:** `src/brain/db/checkpointer.py:29-31`

**Issue:** When the input DSN already contains `options=...` AND that options string contains `search_path`, the function replaces the entire options string with `-csearch_path=langgraph`, discarding any other `-c` directives the caller set (e.g., `-cstatement_timeout=5000`, `-cidle_in_transaction_session_timeout=30000`). The docstring on line 23-24 advertises "replaces any existing `search_path` directive within `options`", but the implementation drops everything else too. This is a silent data-loss bug: operators tuning Postgres connection-level GUCs via the DSN will have those GUCs vanish only when search_path also happens to be set.

**Fix:** Splice out only the existing `-csearch_path=...` token, then append the new one:
```python
import re
_SEARCH_PATH_RE = re.compile(r"\s*-csearch_path=\S+")

if "search_path" in options_existing:
    stripped = _SEARCH_PATH_RE.sub("", options_existing).strip()
    options_new = (stripped + " -csearch_path=langgraph").strip()
else:
    options_new = (options_existing + " -csearch_path=langgraph").strip()
```
Add a unit test covering `?options=-cstatement_timeout%3D5000 -csearch_path%3Dfoo` → output must retain `-cstatement_timeout=5000` and force `search_path=langgraph`.

### WR-05: check-compose-parity.sh suppresses yq errors — silent false-positive parity

**File:** `scripts/check-compose-parity.sh:15-16,23-24,31-32`

**Issue:** Every `yq` invocation is followed by `2>/dev/null || true`. If `yq` itself errors (bad path expression, malformed YAML, OOM, missing binary on PATH after the `command -v` check), the variable is set to the empty string. The subsequent `[[ "$full_..." != "$lite_..." ]]` comparison then evaluates `"" != ""` → false, and the script reports parity even though no actual comparison happened. This converts hard failures into silent passes.

**Fix:** Drop the suppression and let yq failures propagate via `set -e`:
```bash
full_image=$(yq ".services.\"$s\".image // .services.\"$s\".build" docker-compose.yml)
lite_image=$(yq ".services.\"$s\".image // .services.\"$s\".build" docker-compose.lite.yml)
```
Additionally, reject the case where both sides resolve to `null`/empty (service missing from one file):
```bash
if [[ -z "$full_image" || "$full_image" == "null" ]]; then
  echo "ERROR: $s missing image/build in docker-compose.yml" >&2
  exit 1
fi
```

### WR-06: dev/prod parity drift — lite stack hard-disables Langfuse but full stack does not

**File:** `docker-compose.yml:108-131` (compared against `docker-compose.lite.yml:90-99`)

**Issue:** `docker-compose.lite.yml` sets `BRAIN_LANGFUSE__ENABLED: "false"` as a belt-and-suspenders override (lite stack lacks Langfuse). `docker-compose.yml` (full stack) does NOT override this — Brain reads whatever the `.env` file says. The intent is correct (full stack CAN talk to Langfuse), but the lack of an explicit value in the full file means an operator running `docker compose -f docker-compose.yml up` after testing with a lite-style `.env` (which still has `BRAIN_LANGFUSE__ENABLED=false`) will get Brain silently bypassing Langfuse even though `langfuse-web` is healthy. This is the opposite of the lite-stack guarantee. Also, `check-compose-parity.sh` does not flag this kind of asymmetric environment override.

**Fix:** Either drop the override from `docker-compose.lite.yml` (and rely on `.env` always being correct for the chosen stack) or add a matching explicit value in `docker-compose.yml`:
```yaml
brain:
  environment:
    BRAIN_LANGFUSE__ENABLED: "${BRAIN_LANGFUSE__ENABLED:-true}"  # full stack: opt-in via .env, default on
```
Either way, document the chosen semantics in `01-CONTEXT.md`. The current asymmetric override is the surprising state.

## Info

### IN-01: Settings.model_post_init bypasses Pydantic immutability via object.__setattr__

**File:** `src/brain/config/settings.py:165-174`

**Issue:** Provider keys are populated via `object.__setattr__(self, "openai_api_key", value)` after model validation. While correct, this pattern bypasses any validators/aliases Pydantic would otherwise apply, and `__context: object` triggers the `# type: ignore[override]` comment because Pydantic's signature uses `Any`.
**Fix:** Use `pydantic.Field(validation_alias=AliasChoices("openai_api_key", "OPENAI_API_KEY"))` so pydantic-settings picks up the unprefixed name natively, and remove `model_post_init` entirely. Cleaner and removes the need for the `# type: ignore`.

### IN-02: scripts/lint/ban-raw-thread-id.sh regex matches benign two-placeholder f-strings

**File:** `scripts/lint/ban-raw-thread-id.sh:15`

**Issue:** The regex `f["'][^"']*\{[^}]+\}:\{[^}]+\}[^"']*["']` flags any f-string containing two placeholders separated by a literal colon. This will false-positive on legitimate strings like `f"{hour}:{minute}"`, `f"key={k}:val={v}"`, or any other colon-separated formatting that is not a thread_id.
**Fix:** Tighten the pattern (e.g., require the surrounding name to be `thread_id`, or scan for `bot_id`/`session_id` variable names specifically inside the braces), or expand the allowlist to include tests and accept the false-positive cost. Document the trade-off in the script header.

### IN-03: noqa: D-15 comment in observability/logging.py is not a real lint directive

**File:** `src/brain/observability/logging.py:1`

**Issue:** `# noqa: D-15` looks like a ruff suppression but no such rule code exists in ruff. D-15 is a project decision identifier from CLAUDE.md / planning docs, not a lint code. The line is informational only; the actual allowlist is enforced by `scripts/lint/ban-stdlib-logging.sh:17-19`.
**Fix:** Rewrite as a plain comment to avoid confusion with ruff suppressions:
```python
# Project decision D-15: this module is the structlog<->stdlib bridge and is
# allowlisted in scripts/lint/ban-stdlib-logging.sh. The `logging` /
# `logging.config` imports below are intentional.
```

### IN-04: migrate.py spins two separate asyncio event loops back-to-back

**File:** `src/brain/db/migrate.py:89-90`

**Issue:** `asyncio.run(setup_langgraph_schema(...))` then `asyncio.run(assert_schemas_present(...))` creates and tears down two event loops. Functional but wasteful and slows init-container boot by ~50–200 ms.
**Fix:** Combine into a single coroutine:
```python
async def _run_async_steps(dsn: str) -> None:
    await setup_langgraph_schema(dsn)
    await assert_schemas_present(dsn)

asyncio.run(_run_async_steps(settings.postgres.dsn))
```

### IN-05: check-env-example.sh regex only handles one nesting level

**File:** `scripts/check-env-example.sh:19`

**Issue:** `^BRAIN_[A-Z_]+(__[A-Z_]+)?=` accepts one `__` segment. If Settings ever introduces a doubly-nested model (e.g., `BRAIN_POSTGRES__POOL__MIN`), the regex will silently miss it and the parity check will produce a confusing "missing from settings" error for an env-var that IS declared.
**Fix:** Use `^BRAIN_[A-Z_]+(__[A-Z_]+)*=` (zero-or-more) so future nesting depth is supported without script edits.

### IN-06: alembic/env.py does not assert sqlalchemy.url is non-None

**File:** `alembic/env.py:47`

**Issue:** `url = config.get_main_option("sqlalchemy.url")` returns `str | None`. The settings call on line 33 sets it, so it's always non-None in practice, but `create_engine(None, ...)` would produce a confusing low-level traceback if the call order is ever rearranged.
**Fix:** Add a defensive assertion immediately after fetching: `assert url, "sqlalchemy.url must be set before run_migrations_online() — settings.postgres.dsn missing?"`.

### IN-07: docker-compose default credentials hardcoded (not env-driven)

**File:** `docker-compose.yml:32-34,51-52`, `docker-compose.lite.yml:24-27,40-42`

**Issue:** Postgres (`brain/brain/brain`) and RabbitMQ (`brain/brain`) credentials are hardcoded in the compose files instead of being interpolated from `.env`. This is acceptable for the dev compose stack (CLAUDE.md §9 explicitly says dev defaults), but it violates the stricter reading of the CLAUDE.md constraint "All providers, queue names, model defaults, and connection strings must be configurable via `.env` — no hardcoded endpoints." The Langfuse subsystem (line 143-227) correctly uses `${LANGFUSE_*}` interpolation.
**Fix (optional, deferred to Phase 9 per T-08-08):** Interpolate from `.env` with sensible dev defaults:
```yaml
brain-postgres:
  environment:
    POSTGRES_USER: ${BRAIN_PG_USER:-brain}
    POSTGRES_PASSWORD: ${BRAIN_PG_PASSWORD:-brain}
    POSTGRES_DB: ${BRAIN_PG_DB:-brain}
```
Acknowledge in the file header that this is currently a dev-only convenience.

### IN-08: _ReadyChecks construction relies on # type: ignore

**File:** `src/brain/api/health.py:156`

**Issue:** `_ReadyChecks(postgres=pg, rabbitmq=mq, qdrant=qd)` requires `# type: ignore[typeddict-item]` because `_run_probe` is typed `-> str` rather than `-> Literal["ok","timeout","error"]`.
**Fix:** Tighten `_run_probe`'s return type and the probe primitives so the literal flows through; the `# type: ignore` then disappears:
```python
ProbeResult = Literal["ok", "timeout", "error"]

async def _run_probe(coro: Awaitable[ProbeResult]) -> ProbeResult: ...
async def _probe_postgres(pool: Any) -> ProbeResult: ...
# etc.
```

### IN-09: .gitleaks.toml Gemini regex matches all Google API keys (not Gemini-specific)

**File:** `.gitleaks.toml:18-20`

**Issue:** `AIza[0-9A-Za-z\-_]{35}` matches every Google API key shape (Maps, YouTube Data, etc.), not Gemini specifically. The rule name is therefore slightly misleading. Not a functional bug — false positives here are still real leaks worth blocking — just a naming nit.
**Fix:** Rename the rule id from `gemini-key` to `google-api-key` and update the `description` field. Functionality unchanged.

---

_Reviewed: 2026-05-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
