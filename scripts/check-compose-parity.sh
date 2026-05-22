#!/usr/bin/env bash
# scripts/check-compose-parity.sh — assert lite is a strict subset of full for
# shared services (Pitfall 7 / T-08-12). Uses `yq` (mikefarah/yq) when available,
# otherwise falls back to a grep-based image-tag comparison.
#
# Exit codes:
#   0 = parity
#   1 = drift detected
set -euo pipefail

SHARED_SERVICES=(brain brain-migrate brain-topology-init brain-postgres rabbitmq qdrant)

if command -v yq >/dev/null 2>&1; then
  for s in "${SHARED_SERVICES[@]}"; do
    full_image=$(yq ".services.\"$s\".image // .services.\"$s\".build" docker-compose.yml 2>/dev/null || true)
    lite_image=$(yq ".services.\"$s\".image // .services.\"$s\".build" docker-compose.lite.yml 2>/dev/null || true)
    if [[ "$full_image" != "$lite_image" ]]; then
      echo "ERROR: parity drift on $s.image/build:" >&2
      echo "  full: $full_image" >&2
      echo "  lite: $lite_image" >&2
      exit 1
    fi
    full_hc=$(yq ".services.\"$s\".healthcheck" docker-compose.yml 2>/dev/null || true)
    lite_hc=$(yq ".services.\"$s\".healthcheck" docker-compose.lite.yml 2>/dev/null || true)
    if [[ "$full_hc" != "$lite_hc" ]]; then
      echo "ERROR: parity drift on $s.healthcheck:" >&2
      echo "  full: $full_hc" >&2
      echo "  lite: $lite_hc" >&2
      exit 1
    fi
    full_dep=$(yq ".services.\"$s\".depends_on" docker-compose.yml 2>/dev/null || true)
    lite_dep=$(yq ".services.\"$s\".depends_on" docker-compose.lite.yml 2>/dev/null || true)
    if [[ "$full_dep" != "$lite_dep" ]]; then
      echo "ERROR: parity drift on $s.depends_on:" >&2
      echo "  full: $full_dep" >&2
      echo "  lite: $lite_dep" >&2
      exit 1
    fi
  done
  echo "[check-compose-parity] OK (yq mode)"
  exit 0
fi

# Fallback: grep-only comparison of image tags for shared services.
for s in "${SHARED_SERVICES[@]}"; do
  full_img=$(awk "/^  $s:\$/{flag=1;next} /^  [a-z]/{flag=0} flag && /^    image:/" \
               docker-compose.yml | head -1 || true)
  lite_img=$(awk "/^  $s:\$/{flag=1;next} /^  [a-z]/{flag=0} flag && /^    image:/" \
               docker-compose.lite.yml | head -1 || true)
  if [[ "$full_img" != "$lite_img" ]]; then
    echo "ERROR (grep mode): parity drift on $s image:" >&2
    echo "  full: '$full_img'" >&2
    echo "  lite: '$lite_img'" >&2
    exit 1
  fi
done
echo "[check-compose-parity] OK (grep mode)"
