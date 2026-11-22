#!/usr/bin/env bash
# Nightly PostgreSQL + uploads backup with retention.
#   0 2 * * *  /opt/coms/scripts/backup.sh >> /var/log/coms-backup.log 2>&1
# Requires: DATABASE_URL and UPLOAD_DIR (read from .env), pg_dump, tar.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
DEST="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$DEST/coms-db-$STAMP.dump"
tar -czf "$DEST/coms-uploads-$STAMP.tar.gz" -C "$(dirname "${UPLOAD_DIR:-./storage/uploads}")" "$(basename "${UPLOAD_DIR:-./storage/uploads}")" 2>/dev/null || echo "uploads dir kosong / tidak ada"
# Verify the dump is readable before pruning old ones.
pg_restore --list "$DEST/coms-db-$STAMP.dump" > /dev/null
find "$DEST" -name 'coms-*' -mtime +"$KEEP_DAYS" -delete
echo "[$(date -Is)] backup OK: $DEST/coms-db-$STAMP.dump"
# Copy off-site (strongly recommended), e.g.: rclone copy "$DEST" remote:coms-backups
