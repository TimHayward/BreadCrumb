#!/usr/bin/env bash
# BC-048: take a consistent copy of the running stack's database without
# stopping it, using SQLite's online backup API inside the container.
#
#   scripts/backup.sh [destination-file]
#
# Default destination: backups/breadcrumb-<UTC timestamp>.sqlite
# Set COMPOSE_PROJECT_NAME if the stack was started under another name.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

DEST="${1:-backups/breadcrumb-$(date -u +%Y%m%d-%H%M%S).sqlite}"
mkdir -p "$(dirname "$DEST")"

docker compose exec -T breadcrumb node dist/backup-cli.js /tmp/breadcrumb-backup.sqlite
docker compose cp breadcrumb:/tmp/breadcrumb-backup.sqlite "$DEST"
docker compose exec -T breadcrumb rm -f /tmp/breadcrumb-backup.sqlite

echo "backup saved to $DEST ($(wc -c < "$DEST") bytes)"
echo "verify with: scripts/restore.sh --check \"$DEST\""
