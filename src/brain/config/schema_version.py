"""schema_version validator helper (FOUND-11, D-16).

Phase 1 ships the helper + supports-list check.
Phase 3 attaches `SchemaVersion` to `BrainRequest.schema_version` via
`Annotated[int, SchemaVersion]`. Rejection becomes HTTP 422 with the
documented error envelope
``{"error":{"code":"UNSUPPORTED_SCHEMA_VERSION", "message": ..., "traceId": ...}}``.
"""
from __future__ import annotations

from pydantic import AfterValidator

from brain.config.settings import get_settings

UNSUPPORTED_SCHEMA_VERSION_CODE: str = "UNSUPPORTED_SCHEMA_VERSION"


def is_supported_schema_version(v: int) -> bool:
    """Return True iff `v` is in the env-configured supported set."""
    return v in get_settings().supported_schema_versions


def _validate_schema_version(v: int) -> int:
    if not is_supported_schema_version(v):
        supported = get_settings().supported_schema_versions
        raise ValueError(
            f"{UNSUPPORTED_SCHEMA_VERSION_CODE}: schema_version {v!r} "
            f"not in supported versions {supported!r}"
        )
    return v


SchemaVersion = AfterValidator(_validate_schema_version)
