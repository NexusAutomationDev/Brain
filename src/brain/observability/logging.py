# noqa: D-15 — this module is the structlog<->stdlib bridge; the `logging` /
# `logging.config` imports are intentional and allowlisted in
# scripts/lint/ban-stdlib-logging.sh.
"""Structlog wiring (FOUND-10 / D-14 / PITFALL 5).

This module is the *only* file under `src/brain/` that may import the stdlib
`logging` module. It exists so that uvicorn's `uvicorn.access`, `uvicorn.error`,
the root logger, and any third-party libraries that emit via stdlib `logging`
(alembic, httpx, httpcore, ...) route through the *same* structlog processor
chain that native `structlog.get_logger()` calls use — preventing the
"JSON wrapping JSON" double-formatting failure mode described in PITFALL 5.

Public surface:
    configure_logging(settings) -> None
    get_logger(name=None) -> structlog.stdlib.BoundLogger

`settings` is duck-typed (`.log_format: str`, `.log_level: str`). At runtime
this is `brain.config.settings.Settings` (plan 01-03), but the bridge only
reads the two attributes above so the module stays independent of that
import graph.
"""
from __future__ import annotations

import logging
import sys
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:  # pragma: no cover - type-only import
    from brain.config.settings import Settings


def configure_logging(settings: Settings | Any) -> None:
    """Configure structlog + stdlib logging.

    Recipe (canonical 2026 nymous-gist pattern):
      1. Build the shared processor chain (contextvars merge, logger name,
         log level, positional args formatter, stack info, ISO-UTC timestamp).
      2. Pick renderer from `settings.log_format`: JSON in prod, console (with
         colors) in dev.
      3. Configure structlog itself with the chain + `wrap_for_formatter` tail.
      4. Build a `ProcessorFormatter` that runs `foreign_pre_chain` for stdlib
         records and the renderer at the end.
      5. Install a single stdout `StreamHandler` on the root logger with that
         formatter; `logging.basicConfig(force=True)` so we win any earlier
         config.
      6. For each noisy stdlib logger ("uvicorn", "uvicorn.access",
         "uvicorn.error", "httpx", "httpcore") clear its own handlers and set
         `propagate=True` so records bubble up to the root + structlog
         formatter — single-JSON output, no double-format.
    """
    log_format = getattr(settings, "log_format", "json")
    log_level = getattr(settings, "log_level", "INFO")

    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)

    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,  # request_id, bot_id, session_id, ...
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        timestamper,
    ]

    renderer: structlog.types.Processor
    if log_format == "json":
        renderer = structlog.processors.JSONRenderer()
        # Only useful when rendering JSON — ConsoleRenderer formats exceptions
        # natively, so this processor is redundant (and noisy) in console mode.
        shared_processors.append(structlog.processors.format_exc_info)
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    root_handler = logging.StreamHandler(sys.stdout)
    root_handler.setFormatter(formatter)
    logging.basicConfig(level=log_level, handlers=[root_handler], force=True)

    # Strip per-logger handlers and let records propagate to root, where the
    # single structlog-aware handler installed above takes over. This is what
    # prevents PITFALL 5 (JSON wrapping JSON / double-formatted access logs).
    for noisy in ("uvicorn", "uvicorn.access", "uvicorn.error", "httpx", "httpcore"):
        noisy_logger = logging.getLogger(noisy)
        noisy_logger.handlers = []
        noisy_logger.propagate = True


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Thin wrapper around `structlog.get_logger` for consistent imports.

    Prefer this over `structlog.get_logger` directly so that future cross-cutting
    behaviour (e.g. a project-wide log-level guard) can be added in one place.
    """
    return structlog.get_logger(name) if name is not None else structlog.get_logger()
