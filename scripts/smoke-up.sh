#!/usr/bin/env bash
# scripts/smoke-up.sh — Phase 1 smoke runner.
#   Usage: bash scripts/smoke-up.sh (lite|full)
#
# Exits 0 only if every service reaches healthy AND /healthz + /readyz return 200.
# Always tears down (via trap), even on failure.
#
# Exit codes:
#   0 = ok
#   1 = arg error
#   2 = build/start failure
#   3 = healthcheck poll timeout
#   4 = /healthz failed
#   5 = /readyz failed
#   6 = drain assertion failure (FOUND-09 Warning 5 / option-b)
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  lite) COMPOSE_FILE="docker-compose.lite.yml"; TIMEOUT_S=180 ;;
  full) COMPOSE_FILE="docker-compose.yml"; TIMEOUT_S=360 ;;
  *)
    echo "Usage: $0 (lite|full)" >&2
    exit 1
    ;;
esac

PROJECT="brain-smoke-${MODE}-$$"
BASE_URL="http://127.0.0.1:8000"

cleanup() {
  echo "[smoke-up] cleanup: docker compose -p $PROJECT -f $COMPOSE_FILE down -v"
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v --remove-orphans || true
}
trap cleanup EXIT

# Need a .env for compose interpolation. Use a copy of .env.example if absent.
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

echo "[smoke-up] mode=$MODE file=$COMPOSE_FILE timeout=${TIMEOUT_S}s"
echo "[smoke-up] docker compose -p $PROJECT -f $COMPOSE_FILE up -d --build"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --build \
  || { echo "[smoke-up] up failed" >&2; exit 2; }

# Poll until every service is healthy (or init container completed-successfully).
deadline=$(( SECONDS + TIMEOUT_S ))
not_ready=""
while (( SECONDS < deadline )); do
  not_ready=$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps --format json \
    | python3 -c "
import json, sys
services = []
raw = sys.stdin.read().strip()
if not raw:
    print('')
    sys.exit(0)
# docker compose v2 prints one JSON object per line (NDJSON). Older versions
# print a single JSON array. Handle both.
if raw.lstrip().startswith('['):
    services = json.loads(raw)
else:
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            services.append(json.loads(line))
        except json.JSONDecodeError:
            pass

init_containers = {'brain-migrate', 'brain-topology-init'}
not_ready = []
for s in services:
    name = s.get('Service') or ''
    health = s.get('Health') or ''
    state = s.get('State') or ''
    exit_code = s.get('ExitCode') or 0
    if name in init_containers:
        # Init container is fine once it exited cleanly.
        if state == 'exited' and exit_code == 0:
            continue
        if state == 'running':
            not_ready.append(name)
            continue
        if state == 'exited' and exit_code != 0:
            not_ready.append(f'{name}(exit={exit_code})')
            continue
        not_ready.append(name)
        continue
    # Long-running service: needs Health=='healthy' if it has a healthcheck.
    if health and health != 'healthy':
        not_ready.append(name)
        continue
    if not health and state != 'running':
        not_ready.append(name)
        continue
print(','.join(filter(None, not_ready)))
" || true)
  if [[ -z "$not_ready" ]]; then
    echo "[smoke-up] all services healthy"
    break
  fi
  echo "[smoke-up] waiting for: $not_ready"
  sleep 5
done

if [[ -n "$not_ready" ]]; then
  echo "[smoke-up] TIMEOUT waiting for services — leftover not_ready=$not_ready" >&2
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" logs --tail=200
  exit 3
fi

# /healthz
echo "[smoke-up] curl $BASE_URL/healthz"
if ! curl -sf --max-time 5 "$BASE_URL/healthz" | grep -F '"status":"ok"'; then
  echo "[smoke-up] /healthz failed" >&2
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" logs brain --tail=100
  exit 4
fi

# /readyz
echo "[smoke-up] curl $BASE_URL/readyz"
if ! curl -sf --max-time 10 "$BASE_URL/readyz" | grep -F '"status":"ready"'; then
  echo "[smoke-up] /readyz failed" >&2
  curl -s "$BASE_URL/readyz" || true
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" logs brain --tail=100
  exit 5
fi

# ---------------------------------------------------------------------------
# FOUND-09 drain assertion (Warning 5 / option-b).
# Kick off an in-flight HTTP request, send SIGTERM via `docker compose stop`,
# and assert the request completes with 200 (NOT 502, NOT a hang).
# ---------------------------------------------------------------------------
echo "[smoke-up] drain assertion: in-flight /healthz?sleep=2 across SIGTERM"

DRAIN_GRACE="${BRAIN_SHUTDOWN_GRACE_SECONDS:-30}"
DRAIN_RESP="/tmp/drain-resp.$$.json"
DRAIN_STATUS="/tmp/drain-status.$$"

# Background curl: 2s in-flight sleep, 15s hard ceiling.
( curl -s --max-time 15 \
       -o "$DRAIN_RESP" \
       -w '%{http_code}' \
       "$BASE_URL/healthz?sleep=2" > "$DRAIN_STATUS" ) &
DRAIN_PID=$!

# Make sure the request is in-flight before we send SIGTERM.
sleep 0.5

echo "[smoke-up] docker compose -p $PROJECT -f $COMPOSE_FILE stop -t $DRAIN_GRACE brain"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" stop -t "$DRAIN_GRACE" brain

# Wait for the background curl. If it hangs past the 15s --max-time, curl exits non-zero.
wait "$DRAIN_PID" || true

drain_status=$(cat "$DRAIN_STATUS" 2>/dev/null || echo "")
drain_body=$(cat "$DRAIN_RESP" 2>/dev/null || echo "")
rm -f "$DRAIN_RESP" "$DRAIN_STATUS"

if [[ "$drain_status" != "200" ]]; then
  echo "[smoke-up] DRAIN FAILED: status=$drain_status body=$drain_body" >&2
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" logs brain --tail=100
  exit 6
fi
if ! echo "$drain_body" | grep -qF '"status":"ok"'; then
  echo "[smoke-up] DRAIN FAILED: body did not contain status=ok: $drain_body" >&2
  exit 6
fi
echo "[smoke-up] DRAIN OK — in-flight request returned 200 across SIGTERM"

echo "[smoke-up] OK"
