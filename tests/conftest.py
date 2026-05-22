"""Shared test fixtures.

Fixture catalogue:
  - `monkeypatched_env(monkeypatch)` — context-manager-style env scrubber.
      Removes every `BRAIN_*` env var so tests start from a clean slate, then
      lets the test add its own with `monkeypatch.setenv("BRAIN_FOO", "bar")`.
  - `settings_factory` — defined in plan 01-03 once `brain.config.settings`
      exists. Placeholder import below is intentionally commented to avoid
      collection failures.
"""
from __future__ import annotations

import os
from collections.abc import Iterator

import pytest


@pytest.fixture(autouse=True)
def _scrub_brain_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Strip every BRAIN_* env var before each test — prevents leakage from the
    developer's local `.env` file or CI runner env.
    """
    for key in list(os.environ):
        if key.startswith("BRAIN_") or key in {"OPENAI_API_KEY", "GEMINI_API_KEY"}:
            monkeypatch.delenv(key, raising=False)
    yield


# psycopg fixtures are added by plan 01-06.


@pytest.fixture
def settings_factory(monkeypatch: pytest.MonkeyPatch):
    """Build a `Settings` instance with sane test defaults + caller overrides.

    Usage:
        def test_x(settings_factory):
            s = settings_factory(BRAIN_POSTGRES__POOL_MIN="5")
            assert s.postgres.pool_min == 5

    All keys not provided default to harmless localhost values so a minimum
    valid `Settings` always materializes.
    """

    def _factory(**overrides: str):
        defaults = {
            "BRAIN_AUTH__TOKEN": "test-token-test-token-test-token",
            "BRAIN_POSTGRES__DSN": "postgresql://test:test@localhost:5432/test",
            "BRAIN_RABBITMQ__URL": "amqp://test:test@localhost:5672/",
            "BRAIN_QDRANT__URL": "http://localhost:6333",
        }
        defaults.update(overrides)
        for k, v in defaults.items():
            monkeypatch.setenv(k, v)

        from brain.config.settings import get_settings, reload_settings

        reload_settings()
        return get_settings()

    return _factory
