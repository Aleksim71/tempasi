#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------
# "Death to routine" — Tempasi context bundler
# Creates a reproducible bundle for ChatGPT review & patch workflow.
#
# Safe-by-default:
# - DOES NOT include .env / secrets
# - Excludes node_modules, .git, uploads, build artifacts
# ------------------------------------------------------------

PROJECT_NAME="${PROJECT_NAME:-tempasi}"
OUT_DIR="${OUT_DIR:-artifacts/bundles}"

RUN_TESTS=0
RUN_LINT=0
INCLUDE_DIFF=1

print_help() {
  cat <<'EOF'
Usage:
  scripts/death-to-routine.bundle.sh [options]

Options:
  --tests           Run "npm test" and capture output
  --lint            Run "npm run lint" and capture output
  --no-diff         Do not include "git diff" output
  --out-dir <dir>   Output directory (default: artifacts/bundles)
  --project <name>  Project name label (default: tempasi)
  -h, --help        Show help

Examples:
  scripts/death-to-routine.bundle.sh
  scripts/death-to-routine.bundle.sh --tests
  scripts/death-to-routine.bundle.sh --tests --lint --out-dir artifacts/bundles
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tests) RUN_TESTS=1; shift ;;
    --lint) RUN_LINT=1; shift ;;
    --no-diff) INCLUDE_DIFF=0; shift ;;
    --out-dir) OUT_DIR="${2:-}"; shift 2 ;;
    --project) PROJECT_NAME="${2:-}"; shift 2 ;;
    -h|--help) print_help; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      print_help
      exit 2
      ;;
  esac
done

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed or not in PATH" >&2
  exit 1
fi

if [[ ! -d .git ]]; then
  echo "ERROR: run from repository root (no .git found)" >&2
  exit 1
fi

TS="$(date +'%Y-%m-%d__%H-%M-%S')"
BUNDLE_ROOT="$(mktemp -d)"
BUNDLE_DIR="${BUNDLE_ROOT}/${PROJECT_NAME}__bundle__${TS}"

mkdir -p "${BUNDLE_DIR}"
mkdir -p "${OUT_DIR}"

# --- Manifest (high level) ---
cat > "${BUNDLE_DIR}/MANIFEST.txt" <<EOF
Project: ${PROJECT_NAME}
Created: ${TS}
Host: $(uname -a 2>/dev/null || true)
User: $(whoami 2>/dev/null || true)
PWD: $(pwd)

This bundle contains:
- git snapshot (branch, HEAD, status, log)
- diff (optional)
- file tree snapshot
- npm scripts outputs (optional: tests/lint)
- key config files (package.json, package-lock.json if present)
EOF

# --- Git snapshot ---
mkdir -p "${BUNDLE_DIR}/git"

git rev-parse --abbrev-ref HEAD > "${BUNDLE_DIR}/git/branch.txt" || true
git rev-parse HEAD > "${BUNDLE_DIR}/git/head.txt" || true
git status --porcelain=v1 > "${BUNDLE_DIR}/git/status.porcelain.txt" || true
git status > "${BUNDLE_DIR}/git/status.txt" || true
git log -n 40 --date=iso --pretty=format:'%h %ad %an %s' > "${BUNDLE_DIR}/git/log_40.txt" || true

if [[ "${INCLUDE_DIFF}" -eq 1 ]]; then
  # include both staged + unstaged
  git diff > "${BUNDLE_DIR}/git/diff.unstaged.patch" || true
  git diff --staged > "${BUNDLE_DIR}/git/diff.staged.patch" || true
fi

# --- Versions ---
mkdir -p "${BUNDLE_DIR}/env"
{
  echo "node: $(node -v 2>/dev/null || echo 'N/A')"
  echo "npm:  $(npm -v 2>/dev/null || echo 'N/A')"
} > "${BUNDLE_DIR}/env/versions.txt"

# --- File tree snapshot (exclude heavy / secret / generated) ---
mkdir -p "${BUNDLE_DIR}/tree"
if command -v find >/dev/null 2>&1; then
  find . \
    -path './.git' -prune -o \
    -path './node_modules' -prune -o \
    -path './artifacts' -prune -o \
    -path './public/uploads' -prune -o \
    -path './coverage' -prune -o \
    -path './dist' -prune -o \
    -path './build' -prune -o \
    -path './.next' -prune -o \
    -path './.env' -prune -o \
    -path './.env.*' -prune -o \
    -type f -print \
    | sed 's|^\./||' \
    | sort \
    > "${BUNDLE_DIR}/tree/files.list.txt"
fi

# --- Key files (lightweight) ---
mkdir -p "${BUNDLE_DIR}/files"
for f in package.json package-lock.json npm-shrinkwrap.json; do
  if [[ -f "$f" ]]; then
    cp -a "$f" "${BUNDLE_DIR}/files/"
  fi
done

# --- Optional: tests / lint ---
mkdir -p "${BUNDLE_DIR}/runs"

if [[ "${RUN_TESTS}" -eq 1 ]]; then
  echo "Running tests..."
  (npm test) > "${BUNDLE_DIR}/runs/npm_test.log" 2>&1 || {
    echo "WARNING: tests failed (see runs/npm_test.log)" | tee -a "${BUNDLE_DIR}/MANIFEST.txt"
  }
fi

if [[ "${RUN_LINT}" -eq 1 ]]; then
  echo "Running lint..."
  (npm run lint) > "${BUNDLE_DIR}/runs/npm_lint.log" 2>&1 || {
    echo "WARNING: lint failed (see runs/npm_lint.log)" | tee -a "${BUNDLE_DIR}/MANIFEST.txt"
  }
fi

# --- Pack ---
ARCHIVE_NAME="${TS}__${PROJECT_NAME}_bundle.tgz"
ARCHIVE_PATH="${OUT_DIR}/${ARCHIVE_NAME}"

tar -C "${BUNDLE_ROOT}" -czf "${ARCHIVE_PATH}" "$(basename "${BUNDLE_DIR}")"

# --- Cleanup temp dir ---
rm -rf "${BUNDLE_ROOT}"

echo "OK: bundle created -> ${ARCHIVE_PATH}"
echo "Tip: attach this .tgz here in chat. For patch workflow, also attach git diff/patch if needed."
