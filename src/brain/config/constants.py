"""Module-level constants exposed to other packages.

Phase 1 only ships the constant; Phase 3 wires the size check into the FastAPI
middleware (AUTH-04).
"""
from __future__ import annotations

# AUTH-04: 32 KiB request body cap. Enforced in Phase 3 middleware.
MAX_REQUEST_BODY_BYTES: int = 32 * 1024
