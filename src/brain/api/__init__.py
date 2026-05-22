"""FastAPI HTTP ingress: app factory, health/readyz, /v1/webhook (Phase 3).

Plan 01-04 (Phase 1) publishes `RequestIDMiddleware`.
Plan 01-05 (Phase 1) publishes `app`, `create_app`, `lifespan`.
"""
from brain.api.app import app, create_app, lifespan
from brain.api.middleware import RequestIDMiddleware

__all__ = ["RequestIDMiddleware", "app", "create_app", "lifespan"]
