"""Tests for brain.config.constants.MAX_REQUEST_BODY_BYTES (Plan 01-03, AUTH-04).

Phase 1 ships the constant; Phase 3 wires the middleware that enforces it.
"""
from __future__ import annotations


def test_max_body_bytes_is_32_kib() -> None:
    from brain.config.constants import MAX_REQUEST_BODY_BYTES

    assert MAX_REQUEST_BODY_BYTES == 32 * 1024
    assert MAX_REQUEST_BODY_BYTES == 32768


def test_max_body_bytes_is_int() -> None:
    from brain.config.constants import MAX_REQUEST_BODY_BYTES

    assert isinstance(MAX_REQUEST_BODY_BYTES, int)


def test_max_body_bytes_reexport_from_brain_config() -> None:
    """The package re-export keeps Phase 3 imports stable."""
    from brain.config import MAX_REQUEST_BODY_BYTES

    assert MAX_REQUEST_BODY_BYTES == 32768
