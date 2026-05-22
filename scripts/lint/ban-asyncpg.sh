#!/usr/bin/env bash
# FOUND-06 / D-17 / PITFALL 1.2: asyncpg is forbidden — langgraph-checkpoint-postgres
# requires psycopg v3. Mixing asyncpg breaks the checkpointer transparently.
#
# Scope: only files matching `src/brain/**.py` are inspected. Other paths
# (scripts/, tests/, alembic/) are allowed to import asyncpg in case a one-off
# tool genuinely needs it.
set -e
fail=0
for f in "$@"; do
  case "$f" in
    src/brain/*.py)
      if grep -nE '^\s*(import asyncpg|from asyncpg)' "$f"; then
        echo "ERROR: asyncpg import in $f — use psycopg (v3) per FOUND-06" >&2
        fail=1
      fi
      ;;
  esac
done
exit $fail
