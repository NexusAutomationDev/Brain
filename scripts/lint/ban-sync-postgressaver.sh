#!/usr/bin/env bash
# D-17 / PITFALL 1.2: the sync `PostgresSaver` blocks the asyncio event loop
# inside Brain's request path. Use `AsyncPostgresSaver` (from
# `langgraph.checkpoint.postgres.aio`) instead.
#
# Allowlist: `scripts/` (one-off operational tooling may legitimately use the
# sync API outside the request path).
set -e
fail=0
for f in "$@"; do
  case "$f" in
    scripts/*)
      # Allowlisted: one-off scripts may legitimately use the sync API.
      ;;
    *.py)
      if grep -nE 'from langgraph\.checkpoint\.postgres import .*\bPostgresSaver\b' "$f"; then
        echo "ERROR: sync PostgresSaver imported in $f — use AsyncPostgresSaver" >&2
        fail=1
      fi
      ;;
  esac
done
exit $fail
