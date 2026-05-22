"""Integration-test fixtures.

All tests under tests/integration/ must be marked with @pytest.mark.integration.
The marker is registered in pyproject.toml [tool.pytest.ini_options].

Real testcontainer fixtures (postgres, rabbitmq, qdrant) are added by
plan 01-06 (migrate) and plan 01-09 (smoke). This file just declares the
marker requirement.
"""
from __future__ import annotations

import pytest


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Auto-mark every test under tests/integration/ with @pytest.mark.integration."""
    for item in items:
        if "tests/integration/" in str(item.fspath):
            item.add_marker(pytest.mark.integration)
