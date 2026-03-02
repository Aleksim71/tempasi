#!/usr/bin/env bash
set -euo pipefail

# scripts/build-outbox.sh
# Build OUTBOX.zip with:
#   root/changed_files/  – current working diff (staged + unstaged)
#   root/bundle.tgz      – latest bundle from scripts/death-to-routine.bundle.sh
#   root/changes.patch   – git diff (staged + unstaged)
#   root/README.txt      – summary + how to apply/check

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUTBOX_DIR="artifacts/outbox"
TMP_ARTIFACTS_DIR="artifacts/tmp"

if ! command -v zip >/dev/null 2>&1; then
  echo "ERROR: 'zip' utility is not installed." >&2
  echo "Please install it, for example:" >&2
  echo "  apt install zip" >&2
  exit 1
fi

mkdir -p "$OUTBOX_DIR"
rm -rf "$OUTBOX_DIR"/*
mkdir -p "$TMP_ARTIFACTS_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ROOT_OUT="$TMP_DIR/root"
CHANGED_DIR="$ROOT_OUT/changed_files"
mkdir -p "$CHANGED_DIR"

TMP_LOG="$TMP_DIR/death-to-routine.log"
SMOKE_LOG="$TMP_ARTIFACTS_DIR/url_smoke_check.txt"

echo "[build-outbox] Running tests + lint via scripts/death-to-routine.bundle.sh..."

set +e
scripts/death-to-routine.bundle.sh --tests --lint | tee "$TMP_LOG"
DEATH_RC=${PIPESTATUS[0]}
set -e

# Detect tests/lint status from log
TESTS_STATUS="UNKNOWN"
LINT_STATUS="UNKNOWN"

if grep -q 'WARNING: tests failed' "$TMP_LOG"; then
  TESTS_STATUS="FAIL (see bundle logs or artifacts/runs/* if present)"
else
  TESTS_STATUS="OK or not run (no failure marker in death-to-routine output)"
fi

if grep -q 'Running lint' "$TMP_LOG"; then
  if grep -q 'OK: bundle created' "$TMP_LOG"; then
    LINT_STATUS="OK (see bundle logs for details)"
  else
    LINT_STATUS="UNKNOWN or FAIL (check bundle logs)"
  fi
else
  LINT_STATUS="UNKNOWN (lint not detected in output)"
fi

# Latest bundle
LATEST_BUNDLE="$(ls artifacts/bundles/*.tgz 2>/dev/null | sort | tail -n1 || true)"
if [[ -z "$LATEST_BUNDLE" ]]; then
  echo "ERROR: No bundles found in artifacts/bundles/." >&2
  echo "Run scripts/death-to-routine.bundle.sh --tests --lint manually, then retry." >&2
  exit 1
fi

cp "$LATEST_BUNDLE" "$ROOT_OUT/bundle.tgz"

# URL smoke check
echo "[build-outbox] Running URL smoke check..."
rm -f "$SMOKE_LOG"

SERVER_PID=""
START_OK="false"
URL_READY="http://localhost:3000/cabinet"

set +e
npm run dev >/dev/null 2>&1 &
SERVER_PID=$!
set -e

if [[ -n "$SERVER_PID" ]]; then
  for _ in {1..10}; do
    code="$(curl -s --max-time 4 -o /dev/null -w "%{http_code}" "$URL_READY" || true)"
    if [[ "$code" == "200" || "$code" == "302" ]]; then
      START_OK="true"
      break
    fi
    sleep 2
  done
fi

if [[ "$START_OK" != "true" ]]; then
  echo "SERVER_START_TIMEOUT" > "$SMOKE_LOG"
else
  {
    echo "TIMESTAMP $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    curl -s --max-time 4 -o /dev/null -w "%{http_code} %{url_effective} %{time_total}\n" -L http://localhost:3000/ || true
    curl -s --max-time 4 -o /dev/null -w "%{http_code} %{url_effective} %{time_total}\n" -L http://localhost:3000/cabinet || true
    curl -s --max-time 4 -o /dev/null -w "%{http_code} %{url_effective} %{time_total}\n" -L http://localhost:3000/cabinet/my-templates || true
    curl -s --max-time 4 -o /dev/null -w "%{http_code} %{url_effective} %{time_total}\n" -L http://localhost:3000/cabinet/my-templates/analytics || true
  } > "$SMOKE_LOG"
fi

if [[ -n "$SERVER_PID" ]]; then
  kill -TERM "$SERVER_PID" >/dev/null 2>&1 || true
  sleep 2
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill -KILL "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  if command -v pkill >/dev/null 2>&1; then
    pkill -P "$SERVER_PID" >/dev/null 2>&1 || true
  fi
fi

# changes.patch: unstaged + staged
PATCH_PATH="$ROOT_OUT/changes.patch"
git diff > "$PATCH_PATH" || true
git diff --staged >> "$PATCH_PATH" || true

# Collect changed files (staged + unstaged)
mapfile -t FILES < <(
  {
    git diff --name-only || true
    git diff --name-only --staged || true
  } | sed '/^$/d' | sort -u
)

for p in "${FILES[@]}"; do
  if [[ -f "$p" ]]; then
    dest_dir="$CHANGED_DIR/$(dirname "$p")"
    mkdir -p "$dest_dir"
    cp "$p" "$CHANGED_DIR/$p"
  fi
done

# README.txt
README_PATH="$ROOT_OUT/README.txt"
SMOKE_STATUS="OK"
if [[ ! -f "$SMOKE_LOG" ]]; then
  SMOKE_STATUS="MISSING_LOG"
elif grep -Eiq 'SERVER_START_TIMEOUT|SERVER_START_FAILED' "$SMOKE_LOG"; then
  SMOKE_STATUS="SERVER_START_TIMEOUT"
elif grep -Eq '(^| )5(00|..)|(^| )4(04|..)' "$SMOKE_LOG"; then
  SMOKE_STATUS="HTTP_ERRORS_PRESENT"
fi

{
  echo "Tempasi – OUTBOX snapshot"
  echo
  echo "Repository root: $ROOT_DIR"
  echo
  echo "Included artifacts:"
  echo " - root/changes.patch          – git diff (unstaged + staged)"
  echo " - root/bundle.tgz            – latest bundle from artifacts/bundles/"
  echo " - root/changed_files/        – current changed files (structure preserved)"
  echo " - root/README.txt            – this file"
  echo
  echo "Changed files (staged + unstaged) at build time:"
  if ((${#FILES[@]} == 0)); then
    echo " - (none)"
  else
    for p in "${FILES[@]}"; do
      echo " - $p"
    done
  fi
  echo
  echo "How to apply patch:"
  echo "  1) Place OUTBOX.zip at repo root (or open it)."
  echo "  2) Unzip: unzip OUTBOX.zip"
  echo "  3) From repo root: git apply root/changes.patch"
  echo
  echo "If Analytics cabinet page is part of this snapshot:"
  echo "  - Open after auth: /cabinet/my-templates/analytics"
  echo "  - Example: /cabinet/my-templates/analytics?sort=total_revenue&dir=desc"
  echo "  - Supported sort keys (query param ?sort=):"
  echo "      created_at, deleted_at, rent_count, rent_revenue, buy_revenue, total_revenue, last_order_at"
  echo "  - Sort direction (query param ?dir=): asc | desc (desc by default if invalid/missing)"
  echo
  echo "Tests & lint status (from scripts/death-to-routine.bundle.sh --tests --lint):"
  echo "  - tests: $TESTS_STATUS"
  echo "  - lint : $LINT_STATUS"
  echo "URL smoke check:"
  echo "  - status: $SMOKE_STATUS"
  echo "  - log   : artifacts/tmp/url_smoke_check.txt (included in OUTBOX)"
  echo
  echo "Note:"
  echo "  - If tests fail due to missing env (e.g., DATABASE_URL_TEST),"
  echo "    configure the environment and re-run tests manually:"
  echo "      npm test"
  echo "      npm run lint"
} > "$README_PATH"

# Include notes in OUTBOX
mkdir -p "$ROOT_OUT/notes"
if [[ -f "$SMOKE_LOG" ]]; then
  cp "$SMOKE_LOG" "$ROOT_OUT/notes/url_smoke_check.txt"
else
  echo "URL_SMOKE_CHECK_MISSING" > "$ROOT_OUT/notes/url_smoke_check.txt"
fi

ANALYTICS_SORT_LOG="$TMP_ARTIFACTS_DIR/analytics_sort_check.txt"
if [[ -f "$ANALYTICS_SORT_LOG" ]]; then
  cp "$ANALYTICS_SORT_LOG" "$ROOT_OUT/notes/analytics_sort_check.txt"
fi

ANALYTICS_NULL_DATES_LOG="$TMP_ARTIFACTS_DIR/analytics_null_dates_check.txt"
if [[ -f "$ANALYTICS_NULL_DATES_LOG" ]]; then
  cp "$ANALYTICS_NULL_DATES_LOG" "$ROOT_OUT/notes/analytics_null_dates_check.txt"
fi

COMMIT_PUSH_REPORT="$TMP_ARTIFACTS_DIR/commit_push_report.txt"
if [[ -f "$COMMIT_PUSH_REPORT" ]]; then
  cp "$COMMIT_PUSH_REPORT" "$ROOT_OUT/notes/commit_push_report.txt"
fi

# Build OUTBOX.zip with only root/ inside
OUTBOX_ZIP="$ROOT_DIR/$OUTBOX_DIR/OUTBOX.zip"
rm -f "$OUTBOX_ZIP"

(cd "$TMP_DIR" && zip -r "$OUTBOX_ZIP" root >/dev/null)

echo "[build-outbox] DONE: $OUTBOX_ZIP"

if [[ ! -f "$OUTBOX_ZIP" ]]; then
  echo "ERROR: OUTBOX.zip was not created." >&2
  exit 1
fi

if [[ "$(ls -1 "$OUTBOX_DIR"/*.zip 2>/dev/null | wc -l | tr -d ' ')" != "1" ]]; then
  echo "ERROR: artifacts/outbox must contain exactly one .zip." >&2
  exit 1
fi
