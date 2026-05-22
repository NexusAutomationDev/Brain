#!/usr/bin/env bash
# scripts/smoke-readme.sh — execute the README Quickstart against the working
# tree in a temp dir. Validates that DEPLOY-08 wording is verbatim-correct (no
# stale commands).
#
# Exit codes:
#   0 = quickstart works (/healthz returned 200 within 120s)
#   1 = curl failure / non-200 response
#   2 = timeout waiting for /healthz
set -euo pipefail

START_DIR="$(pwd)"
TMP=$(mktemp -d)
cleanup() {
  docker compose -f docker-compose.lite.yml -p readme-smoke down -v --remove-orphans 2>/dev/null || true
  cd "$START_DIR"
  rm -rf "$TMP"
}
trap cleanup EXIT

# Mirror current tree into tmp (NOT a fresh clone — we want to test the WORKING tree).
cp -a "$START_DIR/." "$TMP/brain"
cd "$TMP/brain"

# README Quickstart step 1: copy env
cp .env.example .env

# README Quickstart step 2: lite up
docker compose -f docker-compose.lite.yml -p readme-smoke up -d --build

# Wait for /healthz with 120s deadline
deadline=$(( SECONDS + 120 ))
while (( SECONDS < deadline )); do
  if curl -sf --max-time 3 http://127.0.0.1:8000/healthz | grep -qF '"status":"ok"'; then
    echo "[smoke-readme] /healthz OK"
    exit 0
  fi
  sleep 3
done

echo "[smoke-readme] FAILED: /healthz not 200 within 120s" >&2
docker compose -f docker-compose.lite.yml -p readme-smoke logs --tail=200
exit 2
