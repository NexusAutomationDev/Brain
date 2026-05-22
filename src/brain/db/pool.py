"""psycopg v3 async pool re-export.

FOUND-06 / PITFALL 1.2: asyncpg is FORBIDDEN — `langgraph-checkpoint-postgres`
requires psycopg v3 (autocommit + prepare_threshold=0 + dict_row factory).
The lint hook `scripts/lint/ban-asyncpg.sh` enforces this at commit time.
"""
from __future__ import annotations

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

__all__ = ["AsyncConnection", "AsyncConnectionPool"]
