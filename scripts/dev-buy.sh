#!/usr/bin/env bash
set -euo pipefail

SLUG="${1:-}"
if [[ -z "${SLUG}" ]]; then
  echo "Usage: bash scripts/dev-buy.sh <template-slug>"
  exit 2
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
USER_ID="${DEV_USER_ID:-1}"

COOKIE_JAR="$(mktemp -t tempasi_cookies.XXXXXX.txt)"
RESP_LOGIN="$(mktemp -t tempasi_login.XXXXXX.txt)"
RESP_BUY_HEADERS="$(mktemp -t tempasi_buy_headers.XXXXXX.txt)"
RESP_BUY_BODY="$(mktemp -t tempasi_buy_body.XXXXXX.txt)"
RESP_SUCCESS="$(mktemp -t tempasi_success.XXXXXX.html)"
ZIP_OUT=""

cleanup() {
  rm -f "$COOKIE_JAR" "$RESP_LOGIN" "$RESP_BUY_HEADERS" "$RESP_BUY_BODY" "$RESP_SUCCESS" || true
}
trap cleanup EXIT

echo "[dev-buy] dev-login userId=${USER_ID}"

# 1) DEV login -> store cookie sid into COOKIE_JAR
curl -sS -i \
  -c "$COOKIE_JAR" \
  -X POST "${BASE_URL}/api/auth/dev-login" \
  -H 'Content-Type: application/json' \
  -d "{\"userId\":\"${USER_ID}\"}" > "$RESP_LOGIN"

if ! grep -qi "^Set-Cookie: sid=" "$RESP_LOGIN"; then
  echo "[dev-buy] ERROR: login did not set sid cookie"
  sed -n '1,60p' "$RESP_LOGIN"
  exit 1
fi

echo "[dev-buy] buy slug=${SLUG}"

# 2) Buy -> capture headers + body
curl -sS \
  -D "$RESP_BUY_HEADERS" \
  -b "$COOKIE_JAR" \
  -X POST "${BASE_URL}/api/orders/${SLUG}/buy" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{}' \
  -o "$RESP_BUY_BODY"

# Detect non-JSON early
CT="$(grep -i '^Content-Type:' "$RESP_BUY_HEADERS" | head -n 1 | tr -d '\r' | sed 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//')"
FIRST="$(head -c 1 "$RESP_BUY_BODY" || true)"

if [[ "$FIRST" == "<" || "$CT" == text/html* || "$CT" == *"text/html"* ]]; then
  echo "[dev-buy] ERROR: /buy returned non-JSON (likely server error page)"
  echo "[dev-buy] status: $(head -n 1 "$RESP_BUY_HEADERS" | tr -d '\r')"
  echo "[dev-buy] content-type: ${CT:-<none>}"
  echo "[dev-buy] body (first 120 lines):"
  sed -n '1,120p' "$RESP_BUY_BODY"
  exit 1
fi

ORDER_JSON="$(cat "$RESP_BUY_BODY")"

ORDER_ID="$(node -e "const j=JSON.parse(process.argv[1]); console.log(j.orderId||'');" "$ORDER_JSON")"
CHECKOUT_URL="$(node -e "const j=JSON.parse(process.argv[1]); console.log(j.checkoutUrl||'');" "$ORDER_JSON")"

if [[ -z "$ORDER_ID" || -z "$CHECKOUT_URL" ]]; then
  echo "[dev-buy] ERROR: buy JSON missing orderId/checkoutUrl"
  echo "$ORDER_JSON" | head -c 800 || true
  echo
  exit 1
fi

echo "[dev-buy] orderId=${ORDER_ID}"
echo "[dev-buy] checkoutUrl=${CHECKOUT_URL}"

echo "[dev-buy] checkout success orderId=${ORDER_ID}"
curl -sS \
  -b "$COOKIE_JAR" \
  "${BASE_URL}${CHECKOUT_URL}" > "$RESP_SUCCESS"

ZIP_OUT="${SLUG}_${ORDER_ID}.zip"
echo "[dev-buy] download -> ${ZIP_OUT}"

curl -sS \
  -b "$COOKIE_JAR" \
  -L "${BASE_URL}/download/${SLUG}" \
  -o "${ZIP_OUT}"

echo "[dev-buy] verify zip"
file "${ZIP_OUT}" | sed 's/^/[dev-buy] /'
unzip -t "${ZIP_OUT}" >/dev/null
echo "[dev-buy] OK: ${ZIP_OUT}"
