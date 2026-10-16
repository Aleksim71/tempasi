#!/usr/bin/env bash
set -euo pipefail

# scripts/backup-templates.sh
#
# TEMPASI_TEMPLATES_BACKUP (2026-08-13)
#
# Mirrors TEMPLATE_UPLOAD_DIR (templates uploaded on старичок, reached
# via the existing sshfs mount) into a git repo on an external drive
# (/media/aleksim/Archiv-11 by default). Each run commits only what
# actually changed since the last run — git's own diffing does the
# "only append what's new" part for free, no extra bookkeeping needed.
#
# Deliberately does NOT delete backup copies of templates that were
# removed from the source (no `rsync --delete`) — a backup that mirrors
# deletions defeats the point of having a backup. If a template is
# permanently purged via Admin > Trash, its files stay in this backup
# until someone manually decides to prune the git history.
#
# Safety: refuses to run unless BOTH the source (TEMPLATE_UPLOAD_DIR)
# and the destination drive are confirmed to be real *mounted*
# filesystems, not empty local directories. This mirrors the same
# st_dev-comparison technique already used in
# src/modules/storage/templateStorageCheck.cjs (fs.existsSync() alone
# can't tell a real mount from a plain directory that happens to exist)
# — the source check reuses that exact code via check-template-storage.cjs;
# the destination check re-implements the same idea in bash, since the
# destination isn't part of the Node app.
#
# Usage:
#   bash scripts/backup-templates.sh            # do the backup
#   bash scripts/backup-templates.sh --dry-run   # show what would change, commit nothing
#
# Env overrides (optional):
#   TEMPLATE_UPLOAD_DIR       - source dir (default: /mnt/tempasi/templates)
#   TEMPLATES_BACKUP_DEST     - destination dir inside the drive
#                               (default: /media/aleksim/Archiv-11/tempasi-templates-backup)
#   TEMPLATES_BACKUP_MOUNT    - the drive's own mount point, used only
#                               for the "is this drive actually plugged
#                               in" check (default: /media/aleksim/Archiv-11)

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${TEMPLATE_UPLOAD_DIR:-/mnt/tempasi/templates}"
DEST_MOUNT="${TEMPLATES_BACKUP_MOUNT:-/media/aleksim/Archiv-11}"
DEST_DIR="${TEMPLATES_BACKUP_DEST:-$DEST_MOUNT/tempasi-templates-backup}"

echo "=== Tempasi templates backup $(date -Iseconds) ==="
echo "Source:      $SOURCE_DIR"
echo "Destination: $DEST_DIR"
[ "$DRY_RUN" = "1" ] && echo "Mode:        DRY RUN (nothing will be written or committed)"
echo ""

# --- 1. Source must be a real, reachable mount ---------------------------
echo "Checking source (TEMPLATE_UPLOAD_DIR)..."
if ! node "$SCRIPT_DIR/check-template-storage.cjs" >/tmp/tempasi-backup-storage-check.log 2>&1; then
  echo "ABORT: source storage preflight failed. Not backing up from an unreliable source." >&2
  cat /tmp/tempasi-backup-storage-check.log >&2
  exit 1
fi
echo "Source OK."
echo ""

# --- 2. Destination drive must be a real, plugged-in mount, not just an
#        empty directory that happens to exist on local disk -------------
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

# --- 3. Set up the backup repo on the drive if this is the first run -----
if [ "$DRY_RUN" = "0" ]; then
  mkdir -p "$DEST_DIR"
  if [ ! -d "$DEST_DIR/.git" ]; then
    echo "First run — initializing git repo at $DEST_DIR"
    git -C "$DEST_DIR" init -q
    git -C "$DEST_DIR" config user.email "backup@tempasi.local"
    git -C "$DEST_DIR" config user.name "tempasi-backup"
    echo ""
  fi
fi

# --- 4. Mirror source -> destination (add/update only, never delete) -----
echo "Syncing files..."
if [ "$DRY_RUN" = "1" ]; then
  mkdir -p "$DEST_DIR" 2>/dev/null || true
  rsync -a --dry-run --itemize-changes "$SOURCE_DIR"/ "$DEST_DIR"/
  echo ""
  echo "Dry run only — nothing written, nothing committed."
  exit 0
else
  rsync -a --itemize-changes "$SOURCE_DIR"/ "$DEST_DIR"/
fi
echo ""

# --- 5. Commit only if something actually changed ------------------------
cd "$DEST_DIR"
git add -A

if git diff --cached --quiet; then
  echo "No changes since last backup — nothing to commit."
else
  STAT_SUMMARY="$(git diff --cached --stat | tail -1)"
  git commit -q -m "backup: $(date -Iseconds) — $STAT_SUMMARY"
  echo "Committed: $STAT_SUMMARY"
fi

echo ""
echo "=== Done $(date -Iseconds) ==="
