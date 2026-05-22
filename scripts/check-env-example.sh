#!/usr/bin/env bash
# scripts/check-env-example.sh — assert .env.example documents every Settings
# BRAIN_* env-var name (and vice-versa). Run by CI to prevent drift.
#
# Uses the canonical _known_brain_env_keys() helper from
# brain.config.settings (see plan 01-03 SUMMARY "Notes for plan 01-09").
#
# Exit codes:
#   0 = parity
#   1 = Settings field with no entry in .env.example
#   2 = BRAIN_* key in .env.example with no Settings field
set -euo pipefail

expected=$(uv run python -c "
from brain.config.settings import _known_brain_env_keys
print('\n'.join(sorted(_known_brain_env_keys())))
")

declared=$(grep -oE '^BRAIN_[A-Z_]+(__[A-Z_]+)?=' .env.example \
  | sed 's/=$//' | sort -u)

missing_from_example=$(comm -23 <(echo "$expected") <(echo "$declared") || true)
missing_from_settings=$(comm -13 <(echo "$expected") <(echo "$declared") || true)

if [[ -n "$missing_from_example" ]]; then
  echo "ERROR: Settings fields with no entry in .env.example:" >&2
  echo "$missing_from_example" >&2
  exit 1
fi
if [[ -n "$missing_from_settings" ]]; then
  echo "ERROR: BRAIN_* keys in .env.example that have no Settings field (typo or stale):" >&2
  echo "$missing_from_settings" >&2
  exit 2
fi

echo "[check-env-example] OK — Settings <-> .env.example are in sync"
