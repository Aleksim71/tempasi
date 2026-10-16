#!/usr/bin/env bash
set -euo pipefail

# scripts/restore-full.sh
#
# TEMPASI_RESTORE_PROTOCOL (2026-08-14)
#
# Restores the DB + templates to a specific backup snapshot, using the
# manifest written by backup-full.sh to pair a DB dump with the exact
# templates-backup git commit taken alongside it.
#
# ALWAYS restores DB + templates together (never one without the
# other) — the manifest exists specifically to prevent restoring a
# mismatched pair.
#
# DB restore is always a full wipe + reload (DROP SCHEMA public
# CASCADE + CREATE SCHEMA public, then load the dump) — there's no
# meaningful "partial" DB restore once foreign keys are involved, and
# a plain SQL dump's CREATE TABLE statements would just fail against
# already-existing tables anyway.
#
# Templates restore has two modes:
#   (default)  additive — only adds/updates files from the snapshot,
#                          never deletes anything currently on
#                          старичок. Use when старичок's own files are
#                          trusted and you just want to make sure
#                          nothing's missing.
#   --exact              — makes старичок's templates directory an
#                          EXACT match of the snapshot, deleting
#                          anything not in it. Use when старичок's
#                          files themselves might be compromised
#                          (e.g. suspected corruption/tampering) and
#                          you need a guaranteed clean slate.
#
# There's no process supervisor (pm2/systemd) on this machine — this
# script is its own one-shot supervisor for this single operation. It
# stops the currently-running site (via its PID file: SIGTERM first,
# SIGKILL if it doesn't exit within 10s), does the restore, then
# starts a fresh instance back up detached. After it finishes, the
# site is running detached from any terminal — its output goes to
# logs/site.log, not your terminal.
#
# A 5-second delay at the very start gives an HTTP response time to
# actually reach the browser before anything gets torn down, for the
# case where this was triggered from the admin "Restore" button (which
# spawns this script detached and returns immediately). Manual CLI
# runs get the same delay too, for consistency.
#
# Usage:
#   bash scripts/restore-full.sh <dump-filename> [--exact]
#
# Example:
#   bash scripts/restore-full.sh tempasi_20260814_160648.sql.gz
#   bash scripts/restore-full.sh tempasi_20260814_160648.sql.gz --exact

DUMP_NAME="${1:-}"
EXACT_MODE=0
if [ "${2:-}" = "--exact" ]; then
  EXACT_MODE=1
fi

if [ -z "$DUMP_NAME" ]; then
  echo "Usage: bash scripts/restore-full.sh <dump-filename> [--exact]" >&2
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$PROJECT_ROOT/.server.pid"

mkdir -p "$PROJECT_ROOT/logs"
RESTORE_LOG="$PROJECT_ROOT/logs/restore_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$RESTORE_LOG") 2>&1

echo "=== Tempasi restore $(date -Iseconds) ==="
echo "Dump: $DUMP_NAME"
echo "Templates mode: $([ "$EXACT_MODE" = "1" ] && echo 'EXACT (delete extra files)' || echo 'additive (only add/update)')"
echo "Log: $RESTORE_LOG"
echo ""

# Self-load .env if not already sourced (same fix as backup-db.sh/backup-full.sh).
if [ -z "${DATABASE_URL:-}" ] && [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
fi

DB_BACKUP_DEST_RESOLVED="${DB_BACKUP_DEST:-/media/aleksim/Archiv-11/tempasi-db-backups}"
TEMPLATES_BACKUP_DEST_RESOLVED="${TEMPLATES_BACKUP_DEST:-/media/aleksim/Archiv-11/tempasi-templates-backup}"
TEMPLATE_UPLOAD_DIR_RESOLVED="${TEMPLATE_UPLOAD_DIR:-/mnt/tempasi/templates}"

DUMP_FILE="$DB_BACKUP_DEST_RESOLVED/$DUMP_NAME"
MANIFEST_FILE="${DUMP_FILE%.sql.gz}.manifest.json"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ABORT: DATABASE_URL is not set." >&2
  exit 1
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "ABORT: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

if [ ! -f "$MANIFEST_FILE" ]; then
  echo "ABORT: manifest not found: $MANIFEST_FILE" >&2
  echo "       (this dump wasn't produced by backup-full.sh, or its manifest" >&2
  echo "       was already rotated out). Refusing to restore the DB without" >&2
  echo "       a matching templates snapshot to pair it with." >&2
  exit 1
fi

TEMPLATES_COMMIT="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).templatesBackupCommit)" "$MANIFEST_FILE")"

if [ -z "$TEMPLATES_COMMIT" ]; then
  echo "ABORT: could not read templatesBackupCommit from manifest: $MANIFEST_FILE" >&2
  exit 1
fi

echo "Manifest OK. Templates snapshot commit: $TEMPLATES_COMMIT"
echo ""

echo "Waiting 5 seconds before touching anything (lets any triggering HTTP response reach the browser)..."
sleep 5
echo ""

# --- Step 1/4: stop the currently running server, if any ------------------
echo "--- Step 1/4: stop the running server ---"
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE")"
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping server (pid $OLD_PID) with SIGTERM..."
    kill -TERM "$OLD_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$OLD_PID" 2>/dev/null; then
      echo "Still running after 10s — sending SIGKILL."
      kill -KILL "$OLD_PID" 2>/dev/null || true
    fi
  else
    echo "PID file present but process $OLD_PID is not running — nothing to stop."
  fi
else
  echo "No PID file found — assuming server is not running (or was started some other way)."
fi
# Also stop a supervising nodemon, if the dev server was running under one —
# otherwise it could auto-restart the child mid-restore.
pkill -f "nodemon.*src/server.js" 2>/dev/null || true
echo ""

# --- Step 2/4: restore the database ----------------------------------------
echo "--- Step 2/4: restore database ---"
echo "Terminating other connections to the database..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();" \
  || true

echo "Dropping and recreating the public schema..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "Loading dump..."
gunzip -c "$DUMP_FILE" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1

echo "Database restored."
echo ""

# --- Step 3/4: restore templates -----------------------------------------
echo "--- Step 3/4: restore templates ---"
SCRATCH_DIR="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_DIR"' EXIT
# TEMPASI_RESTORE_PERMS_FIX (2026-08-14): mktemp -d creates directories
# with mode 700 by default. `rsync -a` — despite the trailing slashes
# on both src/dst below, which only control whether src's basename
# becomes nested under dst — still propagates the SOURCE root's own
# permission mode onto the DESTINATION root (a well-known rsync
# gotcha). Left alone, that would silently drop
# $TEMPLATE_UPLOAD_DIR_RESOLVED down to 700, which nginx's serving
# user (not the owner) can no longer even traverse into — exactly
# what broke previews/demos after the first real restore. Fixed two
# ways: give the scratch dir a sane mode up front, AND explicitly
# restore whatever mode the destination actually had beforehand right
# after rsync, regardless of what that turns out to be.
chmod 755 "$SCRATCH_DIR"
ORIG_TEMPLATE_DIR_MODE="$(stat -c %a "$TEMPLATE_UPLOAD_DIR_RESOLVED" 2>/dev/null || echo 755)"

echo "Extracting templates snapshot at commit $TEMPLATES_COMMIT..."
git -C "$TEMPLATES_BACKUP_DEST_RESOLVED" archive "$TEMPLATES_COMMIT" | tar -x -C "$SCRATCH_DIR"

if [ "$EXACT_MODE" = "1" ]; then
  echo "Syncing to старичок (EXACT — deleting anything not in the snapshot)..."
  rsync -a --delete "$SCRATCH_DIR"/ "$TEMPLATE_UPLOAD_DIR_RESOLVED"/
else
  echo "Syncing to старичок (additive — only adding/updating)..."
  rsync -a "$SCRATCH_DIR"/ "$TEMPLATE_UPLOAD_DIR_RESOLVED"/
fi

echo "Restoring $TEMPLATE_UPLOAD_DIR_RESOLVED's own directory mode ($ORIG_TEMPLATE_DIR_MODE, in case rsync touched it)..."
chmod "$ORIG_TEMPLATE_DIR_MODE" "$TEMPLATE_UPLOAD_DIR_RESOLVED" 2>/dev/null || true

echo "Templates restored."
echo ""

# --- Step 4/4: restart the server ------------------------------------------
echo "--- Step 4/4: restart the server ---"
cd "$PROJECT_ROOT"
nohup npm run dev > "$PROJECT_ROOT/logs/site.log" 2>&1 &
disown
echo "Server restart triggered (detached). Output going to logs/site.log."
echo "It will write its own new .server.pid once it's up (see src/server.js)."

echo ""
echo "=== Restore complete $(date -Iseconds) ==="
echo "Full log: $RESTORE_LOG"
