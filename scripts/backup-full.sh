#!/usr/bin/env bash
set -euo pipefail

# scripts/backup-full.sh
#
# TEMPASI_FULL_BACKUP (2026-08-14)
#
# Orchestrates a combined, consistent backup snapshot without any
# site downtime:
#   1. Runs backup-templates.sh (syncs старичок -> Archiv-11 git repo,
#      commits whatever changed since last time).
#   2. Captures the resulting git commit hash of that repo — the
#      "point in time" reference for the template state.
#   3. Runs backup-db.sh (pg_dump + rotation, keeps last 7).
#   4. Writes a small manifest JSON next to the fresh dump, pairing
#      the dump filename with the templates-backup commit hash. This
#      IS the "combined snapshot" — restore = this dump + `git
#      checkout <hash>` in the templates repo. No file duplication:
#      the templates repo's own git history already holds every past
#      state, so there's no need to copy files into a new archive
#      every run.
#   5. Prunes any leftover manifest whose matching dump got rotated
#      out by backup-db.sh's own "keep last 7" — keeps the two in sync
#      without duplicating rotation logic in two places.
#
# No downtime needed: pg_dump takes its own consistent snapshot in one
# transaction regardless of site traffic, and rsync only reads/copies
# — nothing in this process can lose or corrupt live data. Worst case,
# something added in the last few seconds before a run just lands in
# the next day's backup instead.
#
# Scheduled (cron) mode checks a simple on/off flag file
# (.backup-automatic-disabled at the project root) before doing
# anything — if present, this exits 0 immediately without touching
# anything. Toggled from Admin > Settings > Backup.
#
# Manual mode (--force) skips that check entirely — used by the "Run
# backup now" button, and available for running this by hand too.
#
# Usage:
#   bash scripts/backup-full.sh            # scheduled mode (respects the toggle)
#   bash scripts/backup-full.sh --force    # manual mode (always runs)

FORCE=0
if [ "${1:-}" = "--force" ]; then
  FORCE=1
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISABLED_FLAG="$PROJECT_ROOT/.backup-automatic-disabled"

# Self-load .env if it hasn't been sourced by the caller (mirrors the
# same TEMPASI_DB_BACKUP_ENV_AUTOLOAD fix already in backup-db.sh) —
# so this works the same whether triggered by cron, the "Run backup
# now" admin button, or a plain manual run, without needing a special
# wrapper each time.
if [ -z "${TEMPLATE_UPLOAD_DIR:-}" ] && [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
fi

echo "=== Tempasi full backup $(date -Iseconds) ==="

if [ "$FORCE" = "0" ] && [ -f "$DISABLED_FLAG" ]; then
  echo "Automatic backup is disabled (found $DISABLED_FLAG)."
  echo "Skipping — use the 'Run backup now' button in Admin > Settings > Backup, or --force, to run anyway."
  exit 0
fi

echo ""
echo "--- Step 1/3: templates sync ---"
bash "$PROJECT_ROOT/scripts/backup-templates.sh"

TEMPLATES_BACKUP_DEST_RESOLVED="${TEMPLATES_BACKUP_DEST:-/media/aleksim/Archiv-11/tempasi-templates-backup}"
TEMPLATES_COMMIT="$(git -C "$TEMPLATES_BACKUP_DEST_RESOLVED" rev-parse HEAD)"
echo "Templates backup at commit: $TEMPLATES_COMMIT"

echo ""
echo "--- Step 2/3: database dump ---"
bash "$PROJECT_ROOT/scripts/backup-db.sh"

DB_BACKUP_DEST_RESOLVED="${DB_BACKUP_DEST:-/media/aleksim/Archiv-11/tempasi-db-backups}"
LATEST_DUMP="$(ls -1t "$DB_BACKUP_DEST_RESOLVED"/tempasi_*.sql.gz 2>/dev/null | head -1)"

if [ -z "$LATEST_DUMP" ]; then
  echo "ABORT: could not find the dump file just created — manifest not written."
  exit 1
fi

echo ""
echo "--- Step 3/3: manifest ---"
MANIFEST_FILE="${LATEST_DUMP%.sql.gz}.manifest.json"
cat > "$MANIFEST_FILE" << EOF
{
  "createdAt": "$(date -Iseconds)",
  "dbDump": "$(basename "$LATEST_DUMP")",
  "templatesBackupCommit": "$TEMPLATES_COMMIT",
  "templatesBackupRepo": "$TEMPLATES_BACKUP_DEST_RESOLVED"
}
EOF
echo "Manifest written: $(basename "$MANIFEST_FILE")"

echo ""
echo "Pruning manifests whose dump got rotated out..."
PRUNED=0
for m in "$DB_BACKUP_DEST_RESOLVED"/tempasi_*.manifest.json; do
  [ -e "$m" ] || continue
  dump_name="$(basename "$m" .manifest.json).sql.gz"
  if [ ! -f "$DB_BACKUP_DEST_RESOLVED/$dump_name" ]; then
    echo "  removing orphaned manifest: $(basename "$m")"
    rm -f "$m"
    PRUNED=$((PRUNED + 1))
  fi
done
[ "$PRUNED" = "0" ] && echo "  nothing to prune."

echo ""
echo "=== Done $(date -Iseconds) ==="
