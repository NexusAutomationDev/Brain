#!/usr/bin/env bash
# FOUND-10 / D-15: no stdlib `logging` in `src/brain/`. All log output goes
# through structlog via `brain.observability.get_logger()`.
#
# Allowlist:
#   - `alembic/env.py` and `alembic/versions/*.py` (Alembic uses stdlib
#     logging internally — D-15 exception).
#   - `src/brain/observability/logging.py` (the structlog<->stdlib bridge
#     module legitimately wires `logging.config`).
set -e
fail=0
for f in "$@"; do
  case "$f" in
    alembic/env.py|alembic/versions/*.py)
      continue
      ;;
    src/brain/observability/logging.py)
      continue
      ;;
    src/brain/*.py)
      if grep -nE '^\s*(import logging|from logging)' "$f"; then
        echo "ERROR: stdlib logging import in $f — use structlog via brain.observability.get_logger() (FOUND-10)" >&2
        fail=1
      fi
      ;;
  esac
done
exit $fail
