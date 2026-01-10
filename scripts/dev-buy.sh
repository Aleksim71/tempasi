#!/usr/bin/env bash
set -euo pipefail

SLUG="${1:-}"
if [[ -z "${SLUG}" ]]; then
  echo "Usage: $0 <template-slug> [baseUrl] [devUserId]" >&2
  exit 2
fi

BASE="${2:-http://127.0.0.1:3000}"
DEV_USER="${3:-1}"

echo "[dev-buy] slug=${SLUG}"
echo "[dev-buy] base=${BASE}"
echo "[dev-buy] dev_user=${DEV_USER}"

if ! command -v jq >/dev/null 2>&1; then
  echo "[dev-buy] ERROR: jq is required (sudo apt-get install -y jq)" >&2
  exit 3
fi

TMP_HEADERS="$(mktemp)"
TMP_BODY="$(mktemp)"
TMP_HEADERS2="$(mktemp)"
cleanup() { rm -f "$TMP_HEADERS" "$TMP_BODY" "$TMP_HEADERS2"; }
trap cleanup EXIT

BUY_URL="${BASE}/api/orders/${SLUG}/buy"

# 1) BUY (must be JSON 201)
curl -sS -D "$TMP_HEADERS" -o "$TMP_BODY" \
  -X POST \
  -H "x-dev-user-id: ${DEV_USER}" \
  "$BUY_URL"

STATUS="$(head -n 1 "$TMP_HEADERS" | awk '{print $2}')"
CT="$(grep -i '^content-type:' "$TMP_HEADERS" | head -n 1 | sed -E 's/^content-type:\s*//I' | tr -d '\r')"

if [[ "${STATUS}" != "201" ]]; then
  echo "[dev-buy] ERROR: buy returned HTTP ${STATUS}" >&2
  echo "[dev-buy] Response headers (first 40 lines):" >&2
  sed -n '1,40p' "$TMP_HEADERS" >&2 || true
  echo "[dev-buy] Response body (first 80 lines):" >&2
  sed -n '1,80p' "$TMP_BODY" >&2 || true
  exit 1
fi

if [[ "${CT}" != application/json* ]]; then
  echo "[dev-buy] ERROR: buy returned non-JSON content-type: ${CT:-<empty>}" >&2
  echo "[dev-buy] Body (first 80 lines):" >&2
  sed -n '1,80p' "$TMP_BODY" >&2 || true
  exit 1
fi

ORDER_ID="$(jq -r '.orderId // empty' < "$TMP_BODY")"
CHECKOUT_URL="$(jq -r '.checkoutUrl // empty' < "$TMP_BODY")"
PROVIDER_SESSION_ID="$(jq -r '.providerSessionId // empty' < "$TMP_BODY")"

if [[ -z "${ORDER_ID}" || -z "${CHECKOUT_URL}" ]]; then
  echo "[dev-buy] ERROR: unexpected JSON from buy" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

echo "[dev-buy] order_id=${ORDER_ID}"
if [[ -n "${PROVIDER_SESSION_ID}" ]]; then
  echo "[dev-buy] provider_session_id=${PROVIDER_SESSION_ID}"
fi
echo "[dev-buy] checkout_url=${CHECKOUT_URL}"

# 2) CHECKOUT SUCCESS (expect HTTP 200)
curl -sS -o /dev/null -D "$TMP_HEADERS2" "${BASE}${CHECKOUT_URL}"
STATUS2="$(head -n 1 "$TMP_HEADERS2" | awk '{print $2}')"
if [[ "${STATUS2}" != "200" ]]; then
  echo "[dev-buy] ERROR: checkout success returned HTTP ${STATUS2}" >&2
  echo "[dev-buy] Response headers:" >&2
  sed -n '1,40p' "$TMP_HEADERS2" >&2 || true
  exit 1
fi
echo "[dev-buy] checkout success OK"

# 3) DOWNLOAD (expect HTTP 200 + application/zip)
OUT="${SLUG}_${ORDER_ID}.zip"
curl -sS -L -D "$TMP_HEADERS2" \
  -H "x-dev-user-id: ${DEV_USER}" \
  -o "${OUT}" \
  "${BASE}/download/${SLUG}"

STATUS3="$(head -n 1 "$TMP_HEADERS2" | awk '{print $2}')"
CT3="$(grep -i '^content-type:' "$TMP_HEADERS2" | head -n 1 | sed -E 's/^content-type:\s*//I' | tr -d '\r')"

if [[ "${STATUS3}" != "200" ]]; then
  echo "[dev-buy] ERROR: download returned HTTP ${STATUS3}" >&2
  echo "[dev-buy] Response headers (first 40 lines):" >&2
  sed -n '1,40p' "$TMP_HEADERS2" >&2 || true
  echo "[dev-buy] File saved anyway: ${OUT} (may be HTML error page)" >&2
  exit 1
fi

if [[ "${CT3}" != application/zip* ]]; then
  echo "[dev-buy] WARN: download content-type is not application/zip: ${CT3:-<empty>}" >&2
  echo "[dev-buy] (file may still be ok, but likely an HTML error page)" >&2
fi

ls -la "${OUT}"
echo "[dev-buy] DONE -> ${OUT}"
