"""Init-container entrypoint: alembic upgrade then ``AsyncPostgresSaver.setup()`` + assert.

Run via::

    python -m brain.db.migrate

Exits 0 on success, non-zero on failure.

Two-step bootstrap (D-07):

  1. ``alembic upgrade head`` against the ``brain.*`` schema.
  2. ``AsyncPostgresSaver.setup()`` against the ``langgraph.*`` schema
     (via DSN with ``options=-csearch_path=langgraph`` injected — see
     PITFALL 2 / Assumption A1).
  3. Assert both schemas + their canonical tables exist; non-zero exit on
     failure. This forces a misconfigured ``search_path`` into a visible
     init-container failure rather than a silent boot with missing
     checkpoint tables (Open Question #3).

This file legitimately writes to ``sys.stderr`` (not stdlib ``logging``,
not ``print``) because the init container runs BEFORE the structlog +
FastAPI lifespan would set up the app logger.
"""
from __future__ import annotations

import asyncio
import subprocess
import sys

from brain.config.settings import get_settings
from brain.db.checkpointer import async_postgres_saver
from brain.db.pool import AsyncConnectionPool


def _emit(msg: str) -> None:
    """Init-container-safe log emitter (stderr; no structlog, no print, no logging)."""
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def run_alembic_upgrade() -> None:
    """Run ``alembic upgrade head``. Raises ``CalledProcessError`` on failure."""
    _emit("[brain-migrate] step 1/3: alembic upgrade head")
    subprocess.run(["alembic", "upgrade", "head"], check=True)


async def setup_langgraph_schema(dsn: str) -> None:
    """Run ``AsyncPostgresSaver.setup()`` against the ``langgraph.*`` schema (idempotent)."""
    _emit("[brain-migrate] step 2/3: AsyncPostgresSaver.setup() into langgraph.*")
    async with async_postgres_saver(dsn) as saver:
        await saver.setup()


async def assert_schemas_present(dsn: str) -> None:
    """Verify both ``brain.alembic_version`` and ``langgraph.checkpoints`` tables exist.

    Mitigation for PITFALL 2 / Assumption A1: surfaces a misconfigured
    ``search_path`` as a non-zero init-container exit rather than a silent
    boot with broken checkpoint persistence.
    """
    _emit("[brain-migrate] step 3/3: assert dual-schema present")
    async with AsyncConnectionPool(
        conninfo=dsn, min_size=1, max_size=1, open=False
    ) as pool:
        await pool.open()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT to_regclass('brain.alembic_version')")
                row = await cur.fetchone()
                if row is None or row[0] is None:
                    raise RuntimeError(
                        "brain.alembic_version not found — Alembic upgrade did not complete"
                    )
                await cur.execute("SELECT to_regclass('langgraph.checkpoints')")
                row = await cur.fetchone()
                if row is None or row[0] is None:
                    raise RuntimeError(
                        "langgraph.checkpoints not found — AsyncPostgresSaver.setup() "
                        "did not create tables in the `langgraph` schema "
                        "(PITFALL 2: check that build_langgraph_dsn injected search_path)"
                    )


def main() -> int:
    """Init-container entrypoint. Returns 0 on success, non-zero on failure."""
    settings = get_settings()
    try:
        run_alembic_upgrade()
        asyncio.run(setup_langgraph_schema(settings.postgres.dsn))
        asyncio.run(assert_schemas_present(settings.postgres.dsn))
    except subprocess.CalledProcessError as e:
        _emit(f"[brain-migrate] FAILED: alembic returned {e.returncode}")
        return e.returncode or 1
    except Exception as e:
        _emit(f"[brain-migrate] FAILED: {type(e).__name__}: {e}")
        return 1
    _emit("[brain-migrate] OK: brain.* + langgraph.* schemas ready")
    return 0


if __name__ == "__main__":
    sys.exit(main())
