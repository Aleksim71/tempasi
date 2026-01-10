#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/dev-buy.sh seed-001
# Env:
#   BASE_URL=http://127.0.0.1:3000
#   DEV_USER_ID=1

SLUG="${1:-seed-001}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
DEV_USER_ID="${DEV_USER_ID:-1}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing dependency: $1" >&2
    exit 1
  }
}

need curl
need jq

echo "[dev-buy] slug=${SLUG}"
echo "[dev-buy] base=${BASE_URL}"
echo "[dev-buy] dev_user=${DEV_USER_ID}"

# 1) Create order
ORDER_JSON="$(curl -s -X POST "${BASE_URL}/api/orders/${SLUG}/buy")"
ORDER_ID="$(echo "${ORDER_JSON}" | jq -r '.orderId')"

if [[ -z "${ORDER_ID}" || "${ORDER_ID}" == "null" ]]; then
  echo "[dev-buy] Failed to create order. Response:" >&2
  echo "${ORDER_JSON}" >&2
  exit 1
fi

echo "[dev-buy] order_id=${ORDER_ID}"

# 2) Checkout success (DEV)
curl -s "${BASE_URL}/checkout/success?order_id=${ORDER_ID}" >/dev/null
echo "[dev-buy] checkout success OK"

# 3) Download ZIP
OUT="${SLUG}_${ORDER_ID}.zip"
curl -L -H "x-dev-user-id: ${DEV_USER_ID}" \
  -o "${OUT}" \
  "${BASE_URL}/download/${SLUG}"

ls -la "${OUT}"
echo "[dev-buy] DONE -> ${OUT}"

