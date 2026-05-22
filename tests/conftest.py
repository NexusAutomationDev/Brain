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


# settings_factory + psycopg fixtures are added by plan 01-03 / plan 01-06.
