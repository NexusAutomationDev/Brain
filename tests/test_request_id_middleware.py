"""Tests for `brain.api.middleware.RequestIDMiddleware` (D-14).

Validates the canonical structlog contextvars are bound during a request, the
`x-request-id` header is echoed (or generated), and contextvars are cleared
between requests so values do not leak.
"""

from __future__ import annotations

import json
import logging as stdlib_logging
import re
from types import SimpleNamespace
from uuid import UUID

import pytest
import structlog
from fastapi import FastAPI
from fastapi.testclient import TestClient

UUID4_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def _settings(log_format: str = "json") -> SimpleNamespace:
    return SimpleNamespace(log_format=log_format, log_level="INFO")


@pytest.fixture(autouse=True)
def _reset_structlog_after_test() -> None:
    yield
    structlog.reset_defaults()
    structlog.contextvars.clear_contextvars()
    root = stdlib_logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)


def _build_app() -> FastAPI:
    from brain.api.middleware import RequestIDMiddleware
    from brain.observability.logging import configure_logging, get_logger

    configure_logging(_settings(log_format="json"))
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)

    @app.get("/echo")
    def echo() -> dict[str, str]:
        get_logger("test").info("inside")
        return {"ok": "yes"}

    return app


def test_x_request_id_echoed() -> None:
    app = _build_app()
    with TestClient(app) as client:
        r = client.get("/echo", headers={"x-request-id": "test-rid-1"})
    assert r.status_code == 200
    assert r.headers.get("x-request-id") == "test-rid-1"


def test_x_request_id_generated() -> None:
    app = _build_app()
    with TestClient(app) as client:
        r = client.get("/echo")
    assert r.status_code == 200
    rid = r.headers.get("x-request-id")
    assert rid is not None
    assert UUID4_REGEX.match(rid), f"not UUID4 shape: {rid!r}"
    # Confirm it parses as a valid UUID v4.
    UUID(rid, version=4)


def test_log_lines_carry_request_id(capsys: pytest.CaptureFixture[str]) -> None:
    app = _build_app()
    with TestClient(app) as client:
        r = client.get("/echo", headers={"x-request-id": "rid-xyz"})
    assert r.status_code == 200
    out = capsys.readouterr().out
    # Find at least one JSON line whose request_id == "rid-xyz" and event == "inside"
    matches = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("request_id") == "rid-xyz" and payload.get("event") == "inside":
            matches.append(payload)
    assert matches, f"no log line tagged with request_id=rid-xyz found in: {out!r}"


def test_default_field_placeholders(capsys: pytest.CaptureFixture[str]) -> None:
    """D-14 canonical placeholders: bot_id, session_id, trace_id, schema_version."""
    app = _build_app()
    with TestClient(app) as client:
        r = client.get("/echo", headers={"x-request-id": "rid-placeholders"})
    assert r.status_code == 200
    out = capsys.readouterr().out
    found = None
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("event") == "inside":
            found = payload
            break
    assert found is not None, "did not find 'inside' log line"
    for key in ("bot_id", "session_id", "trace_id", "schema_version"):
        assert found.get(key) == "-", f"{key} expected '-' placeholder, got {found.get(key)!r}"


def test_contextvars_cleared_between_requests(capsys: pytest.CaptureFixture[str]) -> None:
    app = _build_app()
    with TestClient(app) as client:
        client.get("/echo", headers={"x-request-id": "RID-A"})
        capsys.readouterr()  # discard first request output
        client.get("/echo", headers={"x-request-id": "RID-B"})
    out = capsys.readouterr().out
    # Log lines emitted under request B must NEVER carry RID-A.
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        assert payload.get("request_id") != "RID-A", (
            f"contextvar leaked from previous request: {payload!r}"
        )


def test_ingress_is_http(capsys: pytest.CaptureFixture[str]) -> None:
    app = _build_app()
    with TestClient(app) as client:
        r = client.get("/echo", headers={"x-request-id": "rid-ingress"})
    assert r.status_code == 200
    out = capsys.readouterr().out
    found = None
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("event") == "inside":
            found = payload
            break
    assert found is not None
    assert found.get("ingress") == "http"
    assert found.get("service") == "brain"
