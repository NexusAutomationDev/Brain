"""Integration test for lifespan startup → shutdown cleanliness (FOUND-09 / D-13).

Scope — realistic for Phase 1 (per plan 01-05 escape-hatch):

  The original plan-of-record was to spawn `python -m brain.api.main` against a
  real testcontainers Postgres, send SIGTERM to the subprocess, and assert
  rc=0 + a captured `shutdown_complete` JSON log line. That approach proved
  flaky in this worktree because `aio_pika.connect_robust(...)` to a non-listen
  address raises `AMQPConnectionError` on the *first* connect (robust reconnect
  only engages after an initial successful handshake), which makes the lifespan
  body fail at startup — uvicorn never binds the socket — and the test cannot
  even reach the SIGTERM step without a real RabbitMQ testcontainer.

  Plan 01-05's `<action>` block explicitly authorizes the simplification:
    "If full subprocess test proves flaky, simplify to: in-process `async with
     lifespan(create_app())` then assert it cleanly exits without exception
     (validates the lifespan body); SIGTERM behavior is owned by uvicorn (cited)
     and validated by `scripts/smoke-up.sh` in plan 01-09."

  This file implements that simpler shape:
    - Monkey-patch `psycopg_pool.AsyncConnectionPool`, `aio_pika.connect_robust`,
      and `qdrant_client.AsyncQdrantClient` inside `brain.api.app` with
      AsyncMock objects so the lifespan can start and finish without live
      services.
    - `async with lifespan(app):` then exits the context manager normally and
      asserts every stub's close/cleanup method ran (proves shutdown order +
      that no exception leaked).
    - Two extra tests assert (a) the startup → shutdown ORDER (open: pool,
      rabbit, qdrant; close: qdrant, rabbit, pool — reverse) via call_order
      tracking, and (b) that an exception in one shutdown step does NOT prevent
      the others from running (because `contextlib.suppress` wraps each close).

  Container-level SIGTERM drain is owned by plan 01-09's `scripts/smoke-up.sh`,
  which runs `docker compose down` against a fully-wired stack and observes
  rc=0 + `shutdown_complete` in container logs.

Marker: `@pytest.mark.integration` because the file lives under
`tests/integration/` (auto-marked by conftest.py).
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, MagicMock

import pytest

if TYPE_CHECKING:
    from collections.abc import Iterator


pytestmark = pytest.mark.integration


@pytest.fixture
def stubbed_lifespan_deps(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[dict[str, Any]]:
    """Replace the three external dep constructors in `brain.api.app` with stubs.

    Yields a dict capturing the stub instances so tests can assert close/order.
    """
    # Build stub instances first.
    pool = MagicMock(name="AsyncConnectionPool")
    pool.open = AsyncMock(return_value=None)
    pool.close = AsyncMock(return_value=None)

    rabbit_conn = MagicMock(name="RobustConnection")
    rabbit_conn.is_closed = False
    rabbit_conn.close = AsyncMock(return_value=None)

    qdrant = MagicMock(name="AsyncQdrantClient")
    qdrant.close = AsyncMock(return_value=None)

    # Track call order across stubs (open: pool→rabbit→qdrant;
    # close: qdrant→rabbit→pool).
    call_order: list[str] = []

    async def _pool_open() -> None:
        call_order.append("open_pool")

    async def _rabbit_connect(_url: str) -> Any:
        call_order.append("open_rabbit")
        return rabbit_conn

    def _qdrant_ctor(*_a: Any, **_kw: Any) -> Any:
        call_order.append("open_qdrant")
        return qdrant

    async def _qdrant_close() -> None:
        call_order.append("close_qdrant")

    async def _rabbit_close() -> None:
        call_order.append("close_rabbit")

    async def _pool_close() -> None:
        call_order.append("close_pool")

    pool.open = _pool_open
    pool.close = _pool_close
    rabbit_conn.close = _rabbit_close
    qdrant.close = _qdrant_close

    def _pool_ctor(*_a: Any, **_kw: Any) -> Any:
        return pool

    # `import brain.api.app as app_mod` would resolve to the FastAPI instance
    # because brain.api/__init__.py re-exports `app` under the same name.
    # Force the module-object lookup via sys.modules / importlib.
    import importlib
    import sys

    importlib.import_module("brain.api.app")
    app_mod = sys.modules["brain.api.app"]

    monkeypatch.setattr(app_mod, "AsyncConnectionPool", _pool_ctor)
    monkeypatch.setattr(app_mod, "aio_pika", MagicMock(connect_robust=_rabbit_connect))
    monkeypatch.setattr(app_mod, "AsyncQdrantClient", _qdrant_ctor)

    yield {
        "pool": pool,
        "rabbit": rabbit_conn,
        "qdrant": qdrant,
        "call_order": call_order,
    }


@pytest.fixture(autouse=True)
def _settings_for_lifespan(monkeypatch: pytest.MonkeyPatch) -> None:
    """Materialize valid env so `get_settings()` inside the lifespan succeeds."""
    monkeypatch.setenv("BRAIN_AUTH__TOKEN", "test-token-test-token-test-token")
    monkeypatch.setenv("BRAIN_POSTGRES__DSN", "postgresql://t:t@localhost:5432/t")
    monkeypatch.setenv("BRAIN_RABBITMQ__URL", "amqp://t:t@localhost:5672/")
    monkeypatch.setenv("BRAIN_QDRANT__URL", "http://localhost:6333")
    monkeypatch.setenv("BRAIN_SHUTDOWN__GRACE_SECONDS", "5")

    from brain.config.settings import reload_settings

    reload_settings()


@pytest.mark.asyncio
async def test_lifespan_startup_and_shutdown_complete_without_exception(
    stubbed_lifespan_deps: dict[str, Any],
) -> None:
    """`async with lifespan(app):` enters, yields, exits — no exception."""
    from fastapi import FastAPI

    from brain.api.app import lifespan

    app = FastAPI()
    async with lifespan(app):
        # Startup ran; deps must be bound to app.state.
        assert app.state.pool is stubbed_lifespan_deps["pool"]
        assert app.state.rabbit is stubbed_lifespan_deps["rabbit"]
        assert app.state.qdrant is stubbed_lifespan_deps["qdrant"]
        assert app.state.settings is not None

    # If we reach here, lifespan's finally-block ran cleanly.


@pytest.mark.asyncio
async def test_lifespan_closes_deps_in_reverse_order(
    stubbed_lifespan_deps: dict[str, Any],
) -> None:
    """Open: pool → rabbit → qdrant. Close: qdrant → rabbit → pool."""
    from fastapi import FastAPI

    from brain.api.app import lifespan

    app = FastAPI()
    async with lifespan(app):
        pass

    call_order = stubbed_lifespan_deps["call_order"]
    assert call_order == [
        "open_pool",
        "open_rabbit",
        "open_qdrant",
        "close_qdrant",
        "close_rabbit",
        "close_pool",
    ]


@pytest.mark.asyncio
async def test_lifespan_shutdown_resilient_to_one_failing_close(
    stubbed_lifespan_deps: dict[str, Any],
) -> None:
    """If one dep's close raises, the others still run (T-05-04 robustness)."""
    from fastapi import FastAPI

    from brain.api.app import lifespan

    # Patch qdrant.close to raise — pool.close + rabbit.close must still fire.
    async def _boom() -> None:
        raise RuntimeError("qdrant close failed")

    stubbed_lifespan_deps["qdrant"].close = _boom

    app = FastAPI()
    # Must NOT propagate — the lifespan suppresses close failures so other
    # deps still get a chance to clean up.
    async with lifespan(app):
        pass

    # The post-qdrant cleanup steps must still have happened.
    call_order = stubbed_lifespan_deps["call_order"]
    assert "close_rabbit" in call_order
    assert "close_pool" in call_order


@pytest.mark.asyncio
async def test_lifespan_does_not_leak_secrets_to_logs(
    stubbed_lifespan_deps: dict[str, Any],
    capsys: pytest.CaptureFixture[str],
) -> None:
    """startup_complete log line must NOT contain auth token or DSN (T-05-07)."""
    from fastapi import FastAPI

    from brain.api.app import lifespan

    app = FastAPI()
    async with lifespan(app):
        pass

    captured = capsys.readouterr()
    # The bearer token + DSN MUST NOT appear in any log line.
    assert "test-token-test-token-test-token" not in captured.out
    assert "test-token-test-token-test-token" not in captured.err
    assert "postgresql://t:t@" not in captured.out
    assert "postgresql://t:t@" not in captured.err
    # But shutdown_complete event SHOULD be observable as the JSON `event` key.
    # (Allow either out or err depending on uvicorn's logging routing.)
    combined = captured.out + captured.err
    # In JSON mode the line contains `"event": "shutdown_complete"`.
    # In console mode the line contains the event name as a token.
    assert "shutdown_complete" in combined


# ---------------------------------------------------------------------------
# Optional: live-subprocess SIGTERM drain (skipped without docker + rabbit MQ)
# ---------------------------------------------------------------------------
#
# A future plan (01-09 smoke + Phase 6 testcontainers-rabbitmq) will spawn a
# real uvicorn subprocess against live Postgres + RabbitMQ + Qdrant containers
# and assert that SIGTERM yields rc=0 within `grace_seconds + 5`. That test is
# deferred because:
#   - aio_pika.connect_robust raises on first connect to an unreachable broker,
#     so a stub URL doesn't work in subprocess mode;
#   - the testcontainers `rabbitmq` extra is in `[dependency-groups].dev` but
#     spinning three live containers per test is expensive and adds flake risk
#     that exceeds Phase 1's smoke-test budget;
#   - plan 01-09's `scripts/smoke-up.sh` already covers container-level SIGTERM
#     drain via `docker compose down`.
@pytest.mark.skip(
    reason=(
        "Container-level SIGTERM drain owned by plan 01-09 smoke-up.sh; "
        "lifespan shape proven in the in-process tests above."
    )
)
def test_subprocess_sigterm_drain_deferred() -> None:  # pragma: no cover
    """Placeholder — see module docstring + plan 01-05 escape-hatch."""
