"""`/healthz` (liveness) + `/readyz` (active dep probes with cache + per-probe timeout).

FOUND-03 + D-05 + D-06:
  - `/healthz` returns `{"status":"ok"}` whenever the process is up. It does
    not touch `app.state` and is therefore safe even before the lifespan has
    finished opening external clients.
  - `/healthz?sleep=<float>` introduces a deliberate delay before responding.
    This is a test affordance for plan 01-09's smoke-up.sh drain assertion
    across SIGTERM — `sleep` is bounded to `[0.0, 5.0]` so it can never DoS the
    liveness loop. Validation enforces the bounds; out-of-range values raise
    HTTP 422 via FastAPI's query-parameter coercion.
  - `/readyz` actively probes Postgres + RabbitMQ + Qdrant via
    `request.app.state.{pool,rabbit,qdrant}` (lifespan-managed singletons).
    Each probe is wrapped in `asyncio.wait_for(timeout=_PROBE_TIMEOUT_S)` so a
    hung dep cannot block readiness checks (T-05-02). Results are cached
    in-process for `_CACHE_TTL_S` seconds (T-05-01 — prevents probe storms
    from compose healthchecks / external monitoring).
  - Per-dep status is exactly one of `"ok" | "timeout" | "error"`. No
    exception messages, no DSN fragments, no hostnames leak into the response
    body (T-05-03).

Notes:
  - Cache is module-level (single-process; uvicorn workers=1 per D-A4).
  - `_reset_cache()` is exposed for tests; mutate `_CACHE_TTL_S` / `_PROBE_TIMEOUT_S`
    via `monkeypatch.setattr` if a test needs tighter timing.
  - Langfuse is intentionally NOT probed here (D-11 / T-05-08): the observability
    subsystem is fire-and-forget; readiness must not depend on it.
"""
from __future__ import annotations

import asyncio
import time
from typing import Annotated, Any, Literal, TypedDict

from fastapi import APIRouter, HTTPException, Query, Request, Response, status

# ---------------------------------------------------------------------------
# Knobs (overridable in tests via monkeypatch.setattr)
# ---------------------------------------------------------------------------

_CACHE_TTL_S: float = 5.0
_PROBE_TIMEOUT_S: float = 2.0
_MAX_HEALTHZ_SLEEP_S: float = 5.0


class _ReadyChecks(TypedDict):
    postgres: Literal["ok", "timeout", "error"]
    rabbitmq: Literal["ok", "timeout", "error"]
    qdrant: Literal["ok", "timeout", "error"]


# (timestamp_monotonic, checks_dict) — None means "no cached entry".
_cache: tuple[float, _ReadyChecks] | None = None


def _reset_cache() -> None:
    """Test helper: drop the cached probe result so the next /readyz re-runs."""
    global _cache
    _cache = None


# ---------------------------------------------------------------------------
# Probe primitives
# ---------------------------------------------------------------------------


async def _probe_postgres(pool: Any) -> str:
    """Open a connection, run `SELECT 1`, return `"ok"`. Raises on connect failure."""
    async with pool.connection() as conn:
        await conn.execute("SELECT 1")
    return "ok"


async def _probe_rabbitmq(connection: Any) -> str:
    """Open + immediately close a channel — cheapest aio-pika liveness probe."""
    if getattr(connection, "is_closed", False):
        return "error"
    ch = await connection.channel()
    await ch.close()
    return "ok"


async def _probe_qdrant(client: Any) -> str:
    """`AsyncQdrantClient.healthz()` returns the server's healthz payload."""
    await client.healthz()
    return "ok"


async def _run_probe(coro: Any) -> str:
    """Wrap a probe coroutine in a bounded wait. Returns ok / timeout / error."""
    try:
        return await asyncio.wait_for(coro, timeout=_PROBE_TIMEOUT_S)
    except TimeoutError:
        return "timeout"
    except Exception:
        # No exception details propagate to the response body (T-05-03).
        return "error"


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter()


@router.get("/healthz")
async def healthz(
    sleep: Annotated[
        float | None,
        Query(
            ge=0.0,
            le=_MAX_HEALTHZ_SLEEP_S,
            description=(
                "Test affordance: delay the response by this many seconds before "
                "returning. Bounded to [0, 5]. Used by plan 01-09 smoke-up.sh to "
                "prove SIGTERM drains an in-flight request."
            ),
        ),
    ] = None,
) -> dict[str, str]:
    """Liveness — always 200 if the process is up. No external deps touched."""
    if sleep is not None and sleep > 0:
        # Defensive clamp on top of FastAPI's query validation — keeps the
        # invariant clear even if a caller bypasses `ge`/`le`.
        await asyncio.sleep(min(sleep, _MAX_HEALTHZ_SLEEP_S))
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(request: Request, response: Response) -> dict[str, Any]:
    """Active probes against Postgres + RabbitMQ + Qdrant with TTL cache."""
    global _cache

    state = request.app.state
    pool = getattr(state, "pool", None)
    rabbit = getattr(state, "rabbit", None)
    qdrant = getattr(state, "qdrant", None)

    if pool is None or rabbit is None or qdrant is None:
        # Lifespan has not finished startup yet; surface as not-ready.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="lifespan not initialized",
        )

    now = time.monotonic()
    if _cache is not None and (now - _cache[0]) < _CACHE_TTL_S:
        checks = _cache[1]
    else:
        pg, mq, qd = await asyncio.gather(
            _run_probe(_probe_postgres(pool)),
            _run_probe(_probe_rabbitmq(rabbit)),
            _run_probe(_probe_qdrant(qdrant)),
        )
        checks = _ReadyChecks(postgres=pg, rabbitmq=mq, qdrant=qd)  # type: ignore[typeddict-item]
        _cache = (now, checks)

    if all(v == "ok" for v in checks.values()):
        return {"status": "ready", "checks": dict(checks)}

    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "not_ready", "checks": dict(checks)}
