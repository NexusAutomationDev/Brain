"""FastAPI app factory + lifespan (FOUND-03 + FOUND-09 + D-13).

Plan 01-05. The lifespan opens psycopg pool, aio-pika robust connection, and
AsyncQdrantClient at startup, binds them to `app.state` for `/readyz` (and
future Phase 3-8 handlers), and closes them in REVERSE order on shutdown
(uvicorn enforces `--timeout-graceful-shutdown` as the upper bound).

Future phases attach to the same lifecycle without refactor:
  - Phase 4: bind a Langfuse SDK handle to `app.state.langfuse`.
  - Phase 6: install the per-`(bot_id, session_id)` asyncio.Lock registry.
  - Phase 8: register an aio-pika consumer in startup and add `await
    consumer.stop()` in the shutdown chain.

NOTE: `app.state.qdrant.close()` is called even though Qdrant clients are lazy
— it cleanly releases the underlying httpx pool. Same logic for the rabbit
robust connection.
"""
from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING

import aio_pika
from fastapi import FastAPI
from psycopg_pool import AsyncConnectionPool
from qdrant_client import AsyncQdrantClient

from brain.api.health import router as health_router
from brain.api.middleware import RequestIDMiddleware
from brain.config.settings import get_settings
from brain.observability.logging import configure_logging, get_logger

if TYPE_CHECKING:  # pragma: no cover - type-only
    from collections.abc import AsyncIterator


log = get_logger(__name__)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Open deps → yield → close deps in reverse order.

    Startup order:  Settings → logging → psycopg pool → aio-pika → qdrant.
    Shutdown order: qdrant → aio-pika → psycopg pool. (Reverse of startup,
    excluding pure-Python objects like Settings and the log config.)

    On startup failure, the exception propagates out of the lifespan body and
    uvicorn refuses to bind the port — compose healthchecks fail fast (T-05-06).

    Secrets MUST NOT appear in the startup_complete log line (T-05-07): only
    `service` + `grace_seconds` are emitted.
    """
    settings = get_settings()
    configure_logging(settings)

    # ─── Startup ──────────────────────────────────────────────────────────
    pool = AsyncConnectionPool(
        conninfo=settings.postgres.dsn,
        min_size=settings.postgres.pool_min,
        max_size=settings.postgres.pool_max,
        open=False,
    )
    await pool.open()

    rabbit_conn = await aio_pika.connect_robust(settings.rabbitmq.url)

    qdrant = AsyncQdrantClient(
        url=settings.qdrant.url,
        api_key=settings.qdrant.api_key,
    )

    app.state.settings = settings
    app.state.pool = pool
    app.state.rabbit = rabbit_conn
    app.state.qdrant = qdrant

    log.info(
        "startup_complete",
        service="brain",
        grace_seconds=settings.shutdown.grace_seconds,
    )

    try:
        yield
    finally:
        # ─── Shutdown (reverse order) ────────────────────────────────────
        log.info("shutdown_begin", service="brain")
        # Use contextlib.suppress on each close so one broken dep doesn't
        # prevent the others from releasing resources.
        with contextlib.suppress(Exception):
            await qdrant.close()
        with contextlib.suppress(Exception):
            await rabbit_conn.close()
        with contextlib.suppress(Exception):
            await pool.close()
        log.info("shutdown_complete", service="brain")


def create_app() -> FastAPI:
    """Build a FastAPI instance with middleware + routes wired.

    `RequestIDMiddleware` is registered first so every later log line in the
    request lifecycle (including FastAPI's own validation errors) carries the
    canonical D-14 contextvars.
    """
    app = FastAPI(lifespan=lifespan, title="Brain", version="0.1.0")
    app.add_middleware(RequestIDMiddleware)
    app.include_router(health_router)
    return app


# Module-level instance — `uvicorn brain.api.app:app` resolves this.
app = create_app()
