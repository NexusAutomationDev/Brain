"""FastAPI HTTP ingress: app factory, health/readyz, /v1/webhook (Phase 3).

Plan 01-04 (Phase 1) publishes `RequestIDMiddleware`; the app factory and
route handlers land in plan 01-05 (Wave 2b) and Phase 3.
"""
from brain.api.middleware import RequestIDMiddleware

__all__ = ["RequestIDMiddleware"]
