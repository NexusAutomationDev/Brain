"""Integration-test fixtures.

All tests under tests/integration/ must be marked with @pytest.mark.integration.
The marker is registered in pyproject.toml [tool.pytest.ini_options].

Real testcontainer fixtures (postgres, rabbitmq, qdrant) are added by
plan 01-06 (migrate) and plan 01-09 (smoke). This file just declares the
marker requirement.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from collections.abc import Iterator

    from testcontainers.postgres import PostgresContainer


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Auto-mark every test under tests/integration/ with @pytest.mark.integration."""
    for item in items:
        if "tests/integration/" in str(item.fspath):
            item.add_marker(pytest.mark.integration)


# ---------------------------------------------------------------------------
# Postgres testcontainer fixture (plan 01-06).
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def postgres_container() -> Iterator[PostgresContainer]:
    """Yield a fresh ``PostgresContainer`` running ``postgres:17-trixie``.

    Module-scoped because container boot is ~5 s and we have multiple
    migrate tests in this module. Each test gets a clean schema because
    the migrate entrypoint is idempotent and tests do not pollute state
    beyond what migration installs.
    """
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("postgres:17-trixie") as pg:
        yield pg
