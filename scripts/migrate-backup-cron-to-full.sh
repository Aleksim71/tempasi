#!/usr/bin/env bash
set -euo pipefail

# migrate-backup-cron-to-full.sh
#
# TEMPASI_FULL_BACKUP (2026-08-14)
#
# Replaces the existing daily cron entry (TEMPASI_DB_BACKUP_CRON,
# which ran only backup-db.sh) with a new one (TEMPASI_FULL_BACKUP_CRON)
# that runs backup-full.sh instead — the combined templates+DB+manifest
# backup, no downtime.
#
# Idempotent: safe to re-run. If the new marker is already present,
# does nothing. Otherwise removes any line containing the old marker
# and adds the new one, preserving every other line in your crontab
# untouched.
#
# Run from the project root: /home/aleksim/tempasi

OLD_MARKER="TEMPASI_DB_BACKUP_CRON"
NEW_MARKER="TEMPASI_FULL_BACKUP_CRON"
CRON_SCHEDULE="0 3 * * *"

if [ ! -f package.json ] || ! grep -q '"name": "tempasi"' package.json 2>/dev/null; then
  echo "ABORT: run this from the tempasi project root." >&2
  exit 1
fi

if [ ! -f scripts/backup-full.sh ]; then
  echo "ABORT: scripts/backup-full.sh not found — apply that patch first." >&2
  exit 1
fi

if ! command -v crontab >/dev/null 2>&1; then
  echo "ABORT: 'crontab' command not found on this machine." >&2
  exit 1
fi

PROJECT_ROOT="$(pwd)"
mkdir -p "$PROJECT_ROOT/logs"

NEW_LINE="$CRON_SCHEDULE cd $PROJECT_ROOT && bash scripts/backup-full.sh >> $PROJECT_ROOT/logs/backup-full.log 2>&1  # $NEW_MARKER"

CURRENT="$(crontab -l 2>/dev/null || true)"

if echo "$CURRENT" | grep -qF "$NEW_MARKER"; then
  echo "Already migrated (found $NEW_MARKER) — nothing to do."
  echo ""
  echo "Current line:"
  echo "$CURRENT" | grep -F "$NEW_MARKER"
  exit 0
fi

HAD_OLD=0
if echo "$CURRENT" | grep -qF "$OLD_MARKER"; then
  HAD_OLD=1
fi

UPDATED="$(echo "$CURRENT" | grep -vF "$OLD_MARKER" || true)"
printf '%s\n%s\n' "$UPDATED" "$NEW_LINE" | crontab -

if [ "$HAD_OLD" = "1" ]; then
  echo "Removed old $OLD_MARKER entry, installed new $NEW_MARKER entry:"
else
  echo "No old $OLD_MARKER entry found (nothing to remove) — installed new $NEW_MARKER entry:"
fi
echo "  $NEW_LINE"
echo ""
echo "Verify with: crontab -l"
