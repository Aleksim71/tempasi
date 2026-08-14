#!/usr/bin/env bash
set -euo pipefail

# scripts/backup-db.sh
#
# TEMPASI_DB_BACKUP (2026-08-14)
#
# pg_dump of DATABASE_URL, gzipped, written to an external drive
# (/media/aleksim/Archiv-11 by default, same drive as the templates
# backup — see backup-templates.sh). Keeps the last 7 dumps, deletes
# older ones after a successful new dump.
#
# Safety: refuses to run unless the destination drive is confirmed to
# be a real *mounted* filesystem (st_dev comparison), not just an
# empty local directory that happens to exist — same technique used in
# backup-templates.sh and src/modules/storage/templateStorageCheck.cjs.
# Deliberately duplicated here rather than shared via a sourced lib,
# so this script stays a fully independent, single-file patch.
#
# The dump is written to a .tmp file first and only renamed to its
# final name after pg_dump succeeds — `set -o pipefail` (part of
# `set -euo pipefail` above) means a failed pg_dump aborts the script
# before the rename, so a crashed/interrupted dump never counts toward
# rotation or overwrites a good older dump.
#
# Usage:
#   bash scripts/backup-db.sh
#
# Env overrides (optional):
#   DATABASE_URL           - required, same var the app itself uses
#   DB_BACKUP_DEST          - destination dir (default:
#                             /media/aleksim/Archiv-11/tempasi-db-backups)
#   DB_BACKUP_MOUNT         - the drive's own mount point, used only
#                             for the "is this drive actually plugged
#                             in" check (default: /media/aleksim/Archiv-11)
#   DB_BACKUP_KEEP          - how many dumps to keep (default: 7)

DEST_MOUNT="${DB_BACKUP_MOUNT:-/media/aleksim/Archiv-11}"
DEST_DIR="${DB_BACKUP_DEST:-$DEST_MOUNT/tempasi-db-backups}"
KEEP="${DB_BACKUP_KEEP:-7}"

echo "=== Tempasi DB backup $(date -Iseconds) ==="
echo "Destination: $DEST_DIR"
echo "Keep:        last $KEEP dumps"
echo ""

# TEMPASI_DB_BACKUP_ENV_AUTOLOAD (2026-08-14)
# If DATABASE_URL isn't already in the environment (e.g. this script
# was run directly — `npm run backup:db` — rather than via the cron
# wrapper that sources .env first), fall back to loading it from the
# project's own .env ourselves. Keeps direct/manual runs working the
# same as the cron job without requiring the caller to remember to
# source .env by hand first.
if [ -z "${DATABASE_URL:-}" ]; then
  PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  ENV_FILE="$PROJECT_ROOT/.env"
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ABORT: DATABASE_URL is not set." >&2
  exit 1
fi

# --- Destination drive must be a real, plugged-in mount -------------------
echo "Checking destination drive ($DEST_MOUNT)..."
if [ ! -d "$DEST_MOUNT" ]; then
  echo "ABORT: $DEST_MOUNT does not exist. Is the drive plugged in?" >&2
  exit 1
fi

DEV_MOUNT="$(stat -c %d "$DEST_MOUNT")"
DEV_PARENT="$(stat -c %d "$(dirname "$DEST_MOUNT")")"
if [ "$DEV_MOUNT" = "$DEV_PARENT" ]; then
  echo "ABORT: $DEST_MOUNT looks like a plain empty directory, not a mounted drive" >&2
  echo "       (same filesystem device as its parent). Is Archiv-11 actually" >&2
  echo "       plugged in and mounted? Refusing to back up onto local disk by" >&2
  echo "       accident." >&2
  exit 1
fi
echo "Destination OK — confirmed to be a distinct mounted filesystem."
echo ""

mkdir -p "$DEST_DIR"

# --- Dump ------------------------------------------------------------------
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="$DEST_DIR/tempasi_${TIMESTAMP}.sql.gz"
TMP_FILE="$DUMP_FILE.tmp"

echo "Dumping..."
TMP_CLEANUP_ARMED=1
trap 'if [ "$TMP_CLEANUP_ARMED" = "1" ]; then rm -f "$TMP_FILE" 2>/dev/null; fi' EXIT

pg_dump "$DATABASE_URL" | gzip > "$TMP_FILE"
mv "$TMP_FILE" "$DUMP_FILE"
TMP_CLEANUP_ARMED=0

SIZE_LABEL="$(du -h "$DUMP_FILE" | cut -f1)"
echo "Dump written: $DUMP_FILE ($SIZE_LABEL)"
echo ""

# --- Rotation: keep only the last $KEEP dumps ------------------------------
cd "$DEST_DIR"
# shellcheck disable=SC2012
OLD_DUMPS="$(ls -1t tempasi_*.sql.gz 2>/dev/null | tail -n "+$((KEEP + 1))")"
if [ -n "$OLD_DUMPS" ]; then
  echo "Rotating out dumps beyond the last $KEEP:"
  echo "$OLD_DUMPS" | while IFS= read -r old; do
    echo "  removing $old"
    rm -f "$old"
  done
fi

REMAINING="$(ls -1 tempasi_*.sql.gz 2>/dev/null | wc -l)"
echo ""
echo "Dumps on disk: $REMAINING (max $KEEP)"
echo ""
echo "=== Done $(date -Iseconds) ==="
