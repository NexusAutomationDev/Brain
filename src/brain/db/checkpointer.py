"""AsyncPostgresSaver factory + DSN helper.

PITFALL 2 / Assumption A1: `AsyncPostgresSaver.setup()` creates checkpoint
tables in whatever `search_path` resolves to (default = `public`).
We inject `?options=-csearch_path%3Dlanggraph` so the tables land in the
`langgraph.*` schema, satisfying FOUND-07.
"""
from __future__ import annotations

import contextlib
import urllib.parse
from collections.abc import AsyncIterator

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver


def build_langgraph_dsn(dsn: str) -> str:
    """Return ``dsn`` with ``options=-csearch_path=langgraph`` merged into the query string.

    Handles three input shapes:
      - DSN with no query string                → adds ``?options=-csearch_path%3Dlanggraph``
      - DSN with query but no ``options=``       → appends ``&options=-csearch_path%3Dlanggraph``
      - DSN with existing ``options=...``        → appends ``-csearch_path=langgraph`` (replaces
        any existing ``search_path`` directive within ``options``)
    """
    parsed = urllib.parse.urlparse(dsn)
    existing = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    options_existing = existing.get("options", [""])[0]
    if "search_path" in options_existing:
        # Replace the existing search_path directive to guarantee `langgraph`.
        options_new = "-csearch_path=langgraph"
    else:
        options_new = (options_existing + " -csearch_path=langgraph").strip()
    existing["options"] = [options_new]
    new_query = urllib.parse.urlencode(existing, doseq=True)
    return urllib.parse.urlunparse(parsed._replace(query=new_query))


@contextlib.asynccontextmanager
async def async_postgres_saver(dsn: str) -> AsyncIterator[AsyncPostgresSaver]:
    """Yield an :class:`AsyncPostgresSaver` bound to the ``langgraph.*`` schema."""
    async with AsyncPostgresSaver.from_conn_string(build_langgraph_dsn(dsn)) as saver:
        yield saver


__all__ = ["async_postgres_saver", "build_langgraph_dsn"]
