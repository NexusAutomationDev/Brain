"""Entrypoint: `python -m brain.api.main` runs uvicorn with graceful shutdown wired.

Used by:
  - the prod Dockerfile CMD (plan 01-07),
  - `tests/integration/test_shutdown.py` (plan 01-05),
  - `scripts/smoke-up.sh` (plan 01-09 — SIGTERM drain assertion at the
    container layer via `docker compose down`).

`workers=1` is non-negotiable per D-A4 (the in-process `asyncio.Lock` registry
and per-bot persona cache assume a single uvicorn worker; horizontal scaling
is via additional containers, not more workers per container).

`timeout_graceful_shutdown` is sourced from
`settings.shutdown.grace_seconds` (FOUND-09 / D-13) — without this flag,
uvicorn waits indefinitely for in-flight requests during shutdown.

`log_config=None` ensures uvicorn does NOT install its own logging.dictConfig;
the lifespan calls `configure_logging(settings)` BEFORE yield so all subsequent
log records (including uvicorn.access) flow through the single structlog
ProcessorFormatter pipeline (PITFALL 5 — JSON wrapping JSON).
"""
from __future__ import annotations

import uvicorn

from brain.config.settings import get_settings


def main() -> None:
    """Launch uvicorn against `brain.api.app:app`."""
    settings = get_settings()
    uvicorn.run(
        "brain.api.app:app",
        host="0.0.0.0",
        port=8000,
        workers=1,  # D-A4 — in-process lock registry forbids >1
        timeout_graceful_shutdown=settings.shutdown.grace_seconds,  # FOUND-09 / D-13
        access_log=True,
        log_config=None,  # configure_logging() in lifespan owns logger config
    )


if __name__ == "__main__":
    main()
