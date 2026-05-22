"""FastAPI middleware (D-14).

`RequestIDMiddleware` is installed first in the FastAPI middleware stack so
every log line emitted during a request — including those produced before any
route handler runs — carries the canonical structlog contextvars defined in
D-14 (request_id, service, ingress, bot_id, session_id, trace_id,
schema_version). Fields not yet known are emitted as `"-"` placeholders;
later phases overwrite them in-place when the values become available
(bot_id/session_id in Phase 3 after payload parsing; trace_id in Phase 4
once Langfuse generates one; schema_version in Phase 3 after request
validation).
"""
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

if TYPE_CHECKING:  # pragma: no cover - type-only import
    from starlette.middleware.base import RequestResponseEndpoint


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Bind canonical structlog contextvars and echo `X-Request-ID`.

    Behaviour:
      - Calls `structlog.contextvars.clear_contextvars()` at the start of every
        request so values from a prior request never leak (T-04-04).
      - Reads the `x-request-id` header (case-insensitive) or generates a
        UUID4 fallback.
      - Binds the seven D-14 fields:
        `request_id, service, ingress, bot_id, session_id, trace_id, schema_version`
        — the four unknown-yet fields use the `"-"` placeholder so log
        consumers can rely on the shape being uniform across requests.
      - Sets `response.headers["x-request-id"] = req_id` before returning.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        structlog.contextvars.clear_contextvars()
        req_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        structlog.contextvars.bind_contextvars(
            request_id=req_id,
            service="brain",
            ingress="http",
            # Placeholders updated by later phases:
            #   bot_id, session_id  ← Phase 3 (payload parsing)
            #   trace_id            ← Phase 4 (Langfuse)
            #   schema_version     ← Phase 3 (request validation)
            bot_id="-",
            session_id="-",
            trace_id="-",
            schema_version="-",
        )
        response = await call_next(request)
        response.headers["x-request-id"] = req_id
        return response
