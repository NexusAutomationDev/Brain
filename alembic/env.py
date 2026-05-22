"""Alembic migration environment for Brain (``brain.*`` schema only).

NOTE (D-15): legitimately uses stdlib ``logging`` because Alembic's machinery
is built on it. ``scripts/lint/ban-stdlib-logging.sh`` allowlists this file.

Schema ownership:
    * ``brain.*``     ← Alembic (this file). ``version_table_schema='brain'``.
    * ``langgraph.*`` ← :func:`AsyncPostgresSaver.setup` (NOT this file).

The ``include_name`` filter restricts Alembic introspection to ``brain.*``
so that even with ``include_schemas=True`` set, ``langgraph.*`` is invisible
to autogenerate. This protects against FOUND-07 / PITFALL 6.1 cross-schema
collisions.
"""
from __future__ import annotations

import logging
from logging.config import fileConfig

from brain.config.settings import get_settings
from sqlalchemy import create_engine, pool, text

from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

logger = logging.getLogger("alembic.env")

settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.postgres.dsn)

# Phase 2+ will set this to ``Base.metadata`` once ORM models land.
target_metadata = None


def include_name(name, type_, parent_names):
    """Restrict Alembic introspection to ``brain.*``. ``langgraph.*`` is OFF-LIMITS."""
    if type_ == "schema":
        return name == "brain"
    return True


def run_migrations_online() -> None:
    url = config.get_main_option("sqlalchemy.url")
    engine = create_engine(url, poolclass=pool.NullPool, future=True)
    with engine.connect() as connection:
        # Idempotent: harmless on re-run, mandatory on a virgin DB so the
        # `version_table_schema='brain'` configure() call below succeeds.
        connection.execute(text("CREATE SCHEMA IF NOT EXISTS brain"))
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema="brain",
            include_schemas=True,
            include_name=include_name,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    raise RuntimeError("Offline Alembic mode is not supported in Phase 1.")

run_migrations_online()
