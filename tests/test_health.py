"""Unit tests for `/healthz` + `/readyz` (FOUND-03, D-05, D-06).

Covers:
  - `/healthz` happy path (always 200, body `{"status":"ok"}`).
  - `/healthz?sleep=...` test affordance (drain assertion for plan 01-09):
      * non-negative float → 200 with measurable delay.
      * negative → 422.
      * > 5.0 → either clamped or 422 (both acceptable).
  - `/readyz` happy path: 200 + per-dep `"ok"`.
  - `/readyz` failure modes: error / timeout return 503 + per-dep status.
  - `/readyz` cache window (5 s): repeated probes inside the window do NOT
     re-invoke the underlying probes.
  - `/readyz` response shape contract.

The fixtures build a minimal FastAPI app and stub `app.state.pool`,
`app.state.rabbit`, `app.state.qdrant` with `AsyncMock` objects whose
behaviour is configurable per-test. No live Postgres / RabbitMQ / Qdrant
required.
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Stub helpers
# ---------------------------------------------------------------------------


def _make_pool_ok() -> Any:
    """Build a stub psycopg pool whose `.connection()` ctx-manager succeeds."""
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value=None)

    class _CM:
        async def __aenter__(self) -> Any:
            return conn

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

    pool = MagicMock()
    pool.connection = MagicMock(return_value=_CM())
    return pool


def _make_pool_error() -> Any:
    """Pool that raises on connection."""

    class _CM:
        async def __aenter__(self) -> Any:
            raise ConnectionError("postgres down")

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

    pool = MagicMock()
    pool.connection = MagicMock(return_value=_CM())
    return pool


def _make_rabbit_ok() -> Any:
    rabbit = MagicMock()
    rabbit.is_closed = False
    channel = AsyncMock()
    channel.close = AsyncMock(return_value=None)
    rabbit.channel = AsyncMock(return_value=channel)
    return rabbit


def _make_rabbit_error() -> Any:
    rabbit = MagicMock()
    rabbit.is_closed = False
    rabbit.channel = AsyncMock(side_effect=ConnectionError("rabbit down"))
    return rabbit


def _make_qdrant_ok() -> Any:
    qdrant = MagicMock()
    qdrant.healthz = AsyncMock(return_value="healthz check passed")
    return qdrant


def _make_qdrant_slow() -> Any:
    """Qdrant whose `healthz()` sleeps long enough to trigger probe timeout."""
    qdrant = MagicMock()

    async def _slow() -> str:
        await asyncio.sleep(5.0)
        return "ok"

    qdrant.healthz = _slow
    return qdrant


def _build_app(
    *,
    pool: Any | None = None,
    rabbit: Any | None = None,
    qdrant: Any | None = None,
) -> FastAPI:
    """Minimal FastAPI app with the health router mounted and stubs on state."""
    from brain.api.health import _reset_cache, router

    _reset_cache()  # don't let cached probes from a previous test leak
    app = FastAPI()
    app.state.pool = pool if pool is not None else _make_pool_ok()
    app.state.rabbit = rabbit if rabbit is not None else _make_rabbit_ok()
    app.state.qdrant = qdrant if qdrant is not None else _make_qdrant_ok()
    app.include_router(router)
    return app


@pytest.fixture
def reset_health_cache() -> Iterator[None]:
    """Clear the module-level probe cache before and after each test."""
    from brain.api.health import _reset_cache

    _reset_cache()
    yield
    _reset_cache()


# ---------------------------------------------------------------------------
# /healthz
# ---------------------------------------------------------------------------


def test_healthz_returns_200(reset_health_cache: None) -> None:
    app = _build_app()
    with TestClient(app) as client:
        r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_healthz_sleep_param_delays_response(reset_health_cache: None) -> None:
    app = _build_app()
    with TestClient(app) as client:
        t0 = time.monotonic()
        r = client.get("/healthz", params={"sleep": "0.2"})
        elapsed = time.monotonic() - t0
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert elapsed >= 0.2


def test_healthz_sleep_clamped_or_rejected(reset_health_cache: None) -> None:
    """`sleep=10` is either clamped to <=5s OR rejected with 422."""
    app = _build_app()
    with TestClient(app) as client:
        t0 = time.monotonic()
        r = client.get("/healthz", params={"sleep": "10"})
        elapsed = time.monotonic() - t0
    if r.status_code == 200:
        assert elapsed < 5.5  # clamped to 5s upper bound
        assert r.json() == {"status": "ok"}
    else:
        assert r.status_code == 422


def test_healthz_sleep_negative_rejected(reset_health_cache: None) -> None:
    app = _build_app()
    with TestClient(app) as client:
        r = client.get("/healthz", params={"sleep": "-1"})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# /readyz
# ---------------------------------------------------------------------------


def test_readyz_all_ok(reset_health_cache: None) -> None:
    app = _build_app()
    with TestClient(app) as client:
        r = client.get("/readyz")
    assert r.status_code == 200
    assert r.json() == {
        "status": "ready",
        "checks": {"postgres": "ok", "rabbitmq": "ok", "qdrant": "ok"},
    }


def test_readyz_postgres_error(reset_health_cache: None) -> None:
    app = _build_app(pool=_make_pool_error())
    with TestClient(app) as client:
        r = client.get("/readyz")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["postgres"] == "error"
    assert body["checks"]["rabbitmq"] == "ok"
    assert body["checks"]["qdrant"] == "ok"


def test_readyz_rabbitmq_error(reset_health_cache: None) -> None:
    app = _build_app(rabbit=_make_rabbit_error())
    with TestClient(app) as client:
        r = client.get("/readyz")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["rabbitmq"] == "error"


def test_readyz_qdrant_timeout(
    reset_health_cache: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When a probe sleeps past `_PROBE_TIMEOUT_S`, status is `'timeout'`."""
    from brain.api import health as health_module

    # Shrink the probe timeout so the test stays fast.
    monkeypatch.setattr(health_module, "_PROBE_TIMEOUT_S", 0.1)
    app = _build_app(qdrant=_make_qdrant_slow())
    with TestClient(app) as client:
        r = client.get("/readyz")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["qdrant"] == "timeout"


def test_readyz_cache_window_respected(
    reset_health_cache: None,
) -> None:
    """Two consecutive /readyz calls within `_CACHE_TTL_S` invoke the probes once."""
    pool_calls = {"n": 0}

    pool = MagicMock()

    class _CM:
        async def __aenter__(self) -> Any:
            pool_calls["n"] += 1
            conn = AsyncMock()
            conn.execute = AsyncMock(return_value=None)
            return conn

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

    pool.connection = MagicMock(side_effect=lambda: _CM())

    app = _build_app(pool=pool)
    with TestClient(app) as client:
        r1 = client.get("/readyz")
        r2 = client.get("/readyz")
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert pool_calls["n"] == 1  # second hit served from cache


def test_readyz_cache_expires_after_ttl(
    reset_health_cache: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """After the TTL elapses, the next /readyz call re-runs the probes."""
    from brain.api import health as health_module

    monkeypatch.setattr(health_module, "_CACHE_TTL_S", 0.05)

    pool_calls = {"n": 0}
    pool = MagicMock()

    class _CM:
        async def __aenter__(self) -> Any:
            pool_calls["n"] += 1
            conn = AsyncMock()
            conn.execute = AsyncMock(return_value=None)
            return conn

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

    pool.connection = MagicMock(side_effect=lambda: _CM())

    app = _build_app(pool=pool)
    with TestClient(app) as client:
        client.get("/readyz")
        time.sleep(0.1)
        client.get("/readyz")
    assert pool_calls["n"] == 2


def test_readyz_partial_failure_lists_all_three(reset_health_cache: None) -> None:
    """When one dep fails and another times out, all three keys still present."""
    from brain.api import health as health_module

    # Shrink probe timeout so the slow qdrant stub trips it quickly.
    original = health_module._PROBE_TIMEOUT_S
    try:
        health_module._PROBE_TIMEOUT_S = 0.1
        app = _build_app(
            rabbit=_make_rabbit_error(),
            qdrant=_make_qdrant_slow(),
        )
        with TestClient(app) as client:
            r = client.get("/readyz")
    finally:
        health_module._PROBE_TIMEOUT_S = original

    assert r.status_code == 503
    body = r.json()
    assert set(body["checks"].keys()) == {"postgres", "rabbitmq", "qdrant"}
    assert body["checks"]["postgres"] == "ok"
    assert body["checks"]["rabbitmq"] == "error"
    assert body["checks"]["qdrant"] == "timeout"


def test_readyz_response_shape(reset_health_cache: None) -> None:
    """Body keys are exactly `{'status','checks'}` and checks has all three deps."""
    app = _build_app()
    with TestClient(app) as client:
        r = client.get("/readyz")
    body = r.json()
    assert set(body.keys()) == {"status", "checks"}
    assert set(body["checks"].keys()) == {"postgres", "rabbitmq", "qdrant"}
