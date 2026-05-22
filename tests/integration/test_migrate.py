"""Integration tests for ``brain-migrate`` (D-07 / FOUND-07).

These tests require Docker. They are auto-marked with ``integration`` via
``tests/integration/conftest.py`` and can be selected with
``pytest -m integration``.

Coverage:
  * First run on a virgin Postgres creates both ``brain.*`` and ``langgraph.*``.
  * ``brain.alembic_version`` table is present post-migrate.
  * ``langgraph.checkpoints`` table is present post-migrate (mitigates
    PITFALL 2 / Assumption A1).
  * Second run on an already-migrated DB returns 0 (idempotent).
  * Assertion failure causes ``main()`` to return non-zero.
"""
from __future__ import annotations

import psycopg
import pytest


@pytest.fixture
def migrate_env(postgres_container, monkeypatch):
    """Point Brain Settings at the testcontainer + the minimum required env, reload Settings."""
    url = postgres_container.get_connection_url()
    # testcontainers returns `postgresql+psycopg2://...`; strip the driver suffix
    # so the DSN is the plain `postgresql://...` form psycopg v3 expects.
    dsn = url.replace("postgresql+psycopg2://", "postgresql://")
    monkeypatch.setenv("BRAIN_POSTGRES__DSN", dsn)
    monkeypatch.setenv("BRAIN_AUTH__TOKEN", "test-token-test-token-test-token")
    monkeypatch.setenv("BRAIN_RABBITMQ__URL", "amqp://x:x@localhost:5672/")
    monkeypatch.setenv("BRAIN_QDRANT__URL", "http://localhost:6333")
    from brain.config.settings import reload_settings

    reload_settings()
    return dsn


def _query_one(dsn: str, sql: str):
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            return cur.fetchone()


def test_first_run_creates_both_schemas(migrate_env):
    from brain.db.migrate import main

    rc = main()
    assert rc == 0
    schemas = _query_one(
        migrate_env,
        "SELECT array_agg(schema_name)::text FROM information_schema.schemata",
    )
    assert "brain" in schemas[0]
    assert "langgraph" in schemas[0]


def test_brain_alembic_version_table_present(migrate_env):
    from brain.db.migrate import main

    main()
    row = _query_one(migrate_env, "SELECT to_regclass('brain.alembic_version')::text")
    assert row[0] == "brain.alembic_version"


def test_langgraph_checkpoints_table_present(migrate_env):
    from brain.db.migrate import main

    main()
    row = _query_one(migrate_env, "SELECT to_regclass('langgraph.checkpoints')::text")
    assert row[0] == "langgraph.checkpoints"


def test_idempotent_second_run(migrate_env):
    from brain.db.migrate import main

    rc1 = main()
    rc2 = main()
    assert rc1 == 0 and rc2 == 0
    row = _query_one(migrate_env, "SELECT count(*) FROM brain.alembic_version")
    assert row[0] == 1  # exactly one head revision


def test_assert_failure_returns_nonzero(migrate_env, monkeypatch):
    from brain.db import migrate as mig

    async def _fail(*_a, **_kw):
        raise RuntimeError("synthetic")

    monkeypatch.setattr(mig, "assert_schemas_present", _fail)
    rc = mig.main()
    assert rc != 0
