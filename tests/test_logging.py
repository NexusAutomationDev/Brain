"""Tests for `brain.observability.logging.configure_logging` (FOUND-10 + D-14).

These tests do not depend on `brain.config.settings` directly (plan 01-03 lands
in parallel). Instead, `configure_logging` accepts any object exposing
`.log_format: str` and `.log_level: str`; we pass a lightweight `SimpleNamespace`
stand-in so this test file remains independent of 01-03's exact `Settings` shape.
"""

from __future__ import annotations

import json
import logging as stdlib_logging
import re
from types import SimpleNamespace

import pytest
import structlog


def _settings(log_format: str = "json", log_level: str = "INFO") -> SimpleNamespace:
    """Build a minimal stand-in for `brain.config.settings.Settings`.

    `configure_logging` only reads `.log_format` and `.log_level`.
    """
    return SimpleNamespace(log_format=log_format, log_level=log_level)


@pytest.fixture(autouse=True)
def _reset_structlog_after_test() -> None:
    """Make sure each test starts with structlog default config + a clean
    stdlib root handler. Without this the tests pollute each other because
    `logging.basicConfig(force=True)` mutates global state.
    """
    yield
    structlog.reset_defaults()
    structlog.contextvars.clear_contextvars()
    root = stdlib_logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)


def test_json_mode_emits_parseable_json(capsys: pytest.CaptureFixture[str]) -> None:
    """Every log line in json mode must be valid JSON with the expected keys."""
    from brain.observability.logging import configure_logging, get_logger

    configure_logging(_settings(log_format="json"))
    log = get_logger("test")
    log.info("hello-event", foo=1, bar="baz")

    out = capsys.readouterr().out.strip()
    assert out, "expected at least one log line on stdout"
    lines = [line for line in out.splitlines() if line.strip()]
    for line in lines:
        payload = json.loads(line)
        assert isinstance(payload, dict)
    # The "hello-event" line carries our extras.
    payload = json.loads(lines[-1])
    assert payload["event"] == "hello-event"
    assert payload["level"] == "info"
    assert "timestamp" in payload
    assert payload["foo"] == 1
    assert payload["bar"] == "baz"


def test_uvicorn_access_routed_through_structlog(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """stdlib `uvicorn.access` logger must emit a single JSON line — never JSON
    wrapping JSON (PITFALL 5).
    """
    from brain.observability.logging import configure_logging

    configure_logging(_settings(log_format="json"))
    stdlib_logging.getLogger("uvicorn.access").info("test access")
    out = capsys.readouterr().out.strip()
    lines = [line for line in out.splitlines() if line.strip()]
    assert len(lines) == 1, f"expected exactly one access log line, got {lines!r}"
    payload = json.loads(lines[0])
    assert payload["event"] == "test access"
    # The renderer must not have produced a JSON value whose `event` is
    # itself a JSON-encoded string (the "JSON wrapping JSON" failure mode).
    assert not (
        isinstance(payload["event"], str) and payload["event"].lstrip().startswith("{")
    )


def test_console_mode_human_readable(capsys: pytest.CaptureFixture[str]) -> None:
    """Console mode must NOT emit JSON (ANSI/plain text instead)."""
    from brain.observability.logging import configure_logging, get_logger

    configure_logging(_settings(log_format="console"))
    log = get_logger("test")
    log.info("hello-console")
    out = capsys.readouterr().out
    assert "hello-console" in out
    # A console-rendered line is not valid JSON.
    first_line = out.strip().splitlines()[0]
    with pytest.raises(json.JSONDecodeError):
        json.loads(first_line)


def test_contextvars_merge(capsys: pytest.CaptureFixture[str]) -> None:
    """structlog.contextvars.bind_contextvars values must appear in JSON output."""
    from brain.observability.logging import configure_logging, get_logger

    configure_logging(_settings(log_format="json"))
    structlog.contextvars.bind_contextvars(request_id="abc-123")
    try:
        get_logger("test").info("ev")
        out = capsys.readouterr().out.strip().splitlines()
        payload = json.loads(out[-1])
        assert payload["request_id"] == "abc-123"
    finally:
        structlog.contextvars.clear_contextvars()


def test_iso_utc_timestamp(capsys: pytest.CaptureFixture[str]) -> None:
    """Timestamp must be ISO-8601 UTC (trailing Z or +00:00)."""
    from brain.observability.logging import configure_logging, get_logger

    configure_logging(_settings(log_format="json"))
    get_logger("test").info("ts-check")
    out = capsys.readouterr().out.strip().splitlines()
    payload = json.loads(out[-1])
    ts = payload["timestamp"]
    iso_utc = re.compile(
        r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$"
    )
    assert iso_utc.match(ts), f"timestamp not ISO-UTC: {ts!r}"


def test_alembic_logger_routed(capsys: pytest.CaptureFixture[str]) -> None:
    """alembic uses stdlib logging (D-15) — its records must still come out as JSON."""
    from brain.observability.logging import configure_logging

    configure_logging(_settings(log_format="json"))
    stdlib_logging.getLogger("alembic").info("migration step")
    out = capsys.readouterr().out.strip().splitlines()
    assert out, "expected a log line from alembic"
    payload = json.loads(out[-1])
    assert payload["event"] == "migration step"
