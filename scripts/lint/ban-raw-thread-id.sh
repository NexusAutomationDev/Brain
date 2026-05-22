#!/usr/bin/env bash
# FOUND-08 / D-17 / PITFALL 10.1: bare `f"{bot_id}:{session_id}"` leaks
# conversations across bots. Use `brain.graph.thread.thread_id()` helper.
#
# Allowlist: `src/brain/graph/thread.py` (the helper itself owns the pattern).
set -e
fail=0
for f in "$@"; do
  case "$f" in
    src/brain/graph/thread.py)
      continue
      ;;
    src/brain/*.py)
      # Match f-strings of the form f"{anything}:{anything}" / f'{anything}:{anything}'
      if grep -nE 'f["'\''][^"'\'']*\{[^}]+\}:\{[^}]+\}[^"'\'']*["'\'']' "$f"; then
        echo "ERROR: raw f-string thread_id pattern in $f — use brain.graph.thread.thread_id()" >&2
        fail=1
      fi
      ;;
  esac
done
exit $fail
