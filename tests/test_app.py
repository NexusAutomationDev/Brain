"""Unit tests for the FastAPI app factory + uvicorn entrypoint (plan 01-05 Task 2).

Verifies:
  - `create_app()` registers `RequestIDMiddleware` in the middleware stack.
  - `create_app()` mounts the health router (`/healthz` reachable through the
    TestClient WITHOUT requiring live deps — `/healthz` is dep-free; the
    lifespan is *not* triggered because TestClient with `with`-context would
    start it, so this test uses the bare ASGI mount path).
  - `main()` calls `uvicorn.run` with `timeout_graceful_shutdown` ==
    `settings.shutdown.grace_seconds` and `workers=1` (D-A4).
  - Module-level `app` is importable as `brain.api.app:app` (the uvicorn target).
  - `lifespan` context manager exists and is awaitable.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

# ---------------------------------------------------------------------------
# create_app() surface
# ---------------------------------------------------------------------------


def test_create_app_returns_fastapi_instance() -> None:
    from fastapi import FastAPI

    from brain.api.app import create_app

    app = create_app()
    assert isinstance(app, FastAPI)


def test_create_app_includes_request_id_middleware() -> None:
    """RequestIDMiddleware must be in the middleware stack."""
    from brain.api.app import create_app
    from brain.api.middleware import RequestIDMiddleware

    app = create_app()
    middleware_classes = [m.cls for m in app.user_middleware]
    assert RequestIDMiddleware in middleware_classes


def test_create_app_mounts_health_router() -> None:
    """The /healthz route must be registered."""
    from brain.api.app import create_app

    app = create_app()
    paths = {route.path for route in app.routes}  # type: ignore[attr-defined]
    assert "/healthz" in paths
    assert "/readyz" in paths


def test_module_level_app_is_fastapi(settings_factory: Any) -> None:
    """`brain.api.app:app` is the uvicorn target — must be a FastAPI instance."""
    # Materialize Settings first so `app = create_app()` at module-import time
    # has valid env. The settings_factory fixture seeds the four required env
    # vars; reload_settings() clears the cache before re-import.
    settings_factory()  # populates env

    # Re-resolve `brain.api.app` via sys.modules so we get the module, not the
    # package's `app` attribute (the package's __init__ re-exports the FastAPI
    # instance under the same name `app`, which `import x.y as z` resolves to).
    import importlib
    import sys

    importlib.import_module("brain.api.app")
    app_mod = sys.modules["brain.api.app"]
    from fastapi import FastAPI

    assert isinstance(app_mod.app, FastAPI)


def test_lifespan_is_async_context_manager() -> None:
    """`lifespan` must be an async context manager (FastAPI requirement)."""
    from brain.api.app import lifespan

    # `asynccontextmanager` wraps the generator in a `_AsyncGeneratorContextManager`
    # factory. The factory itself is a callable — calling it returns the CM.
    assert callable(lifespan)
    # Build the manager and verify the protocol surface.
    from fastapi import FastAPI

    cm = lifespan(FastAPI())
    assert hasattr(cm, "__aenter__")
    assert hasattr(cm, "__aexit__")


# ---------------------------------------------------------------------------
# main() entrypoint
# ---------------------------------------------------------------------------


def test_main_invokes_uvicorn_with_grace_flag(
    settings_factory: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`main()` must pass `timeout_graceful_shutdown=grace_seconds` to uvicorn.run.

    The grace value comes from `settings.shutdown.grace_seconds` (D-13).
    """
    settings_factory(BRAIN_SHUTDOWN__GRACE_SECONDS="42")

    from brain.api import main as main_module

    with patch.object(main_module, "uvicorn") as mock_uvicorn:
        main_module.main()

    assert mock_uvicorn.run.called
    _, kwargs = mock_uvicorn.run.call_args
    assert kwargs["timeout_graceful_shutdown"] == 42
    assert kwargs["workers"] == 1  # D-A4: in-process lock registry — never >1


def test_main_targets_brain_api_app(
    settings_factory: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`uvicorn.run` first positional arg must be the `brain.api.app:app` target."""
    settings_factory()

    from brain.api import main as main_module

    with patch.object(main_module, "uvicorn") as mock_uvicorn:
        main_module.main()

    args, kwargs = mock_uvicorn.run.call_args
    # uvicorn.run accepts the target as positional OR keyword
    target = args[0] if args else kwargs.get("app")
    assert target == "brain.api.app:app"


def test_main_binds_host_and_port(
    settings_factory: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`main()` must bind 0.0.0.0:8000 — the prod Dockerfile expects this."""
    settings_factory()

    from brain.api import main as main_module

    with patch.object(main_module, "uvicorn") as mock_uvicorn:
        main_module.main()

    _, kwargs = mock_uvicorn.run.call_args
    assert kwargs["host"] == "0.0.0.0"
    assert kwargs["port"] == 8000


# ---------------------------------------------------------------------------
# __init__ re-exports (preserve plan 01-04's RequestIDMiddleware export)
# ---------------------------------------------------------------------------


def test_api_package_exports() -> None:
    """`brain.api` must re-export RequestIDMiddleware (01-04), app, create_app, lifespan."""
    import brain.api as api_pkg

    assert hasattr(api_pkg, "RequestIDMiddleware")
    assert hasattr(api_pkg, "app")
    assert hasattr(api_pkg, "create_app")
    assert hasattr(api_pkg, "lifespan")
    # __all__ contract:
    assert set(api_pkg.__all__) >= {
        "RequestIDMiddleware",
        "app",
        "create_app",
        "lifespan",
    }
