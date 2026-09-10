#!/usr/bin/env bash
# BC-048: restore a backup onto the stack's named volume, or check a backup.
#
#   scripts/restore.sh <backup-file>          stop the app, replace the database, start, check health
#   scripts/restore.sh --check <backup-file>  print the row count in the backup without touching the stack
#
# The write ahead log companions (-wal, -shm) on the volume are removed with
# the old database: a backup made with backup.sh is self contained.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

if [ "${1:-}" = "--check" ]; then
  SRC="${2:?backup file required}"
  DIR="$(cd "$(dirname "$SRC")" && (pwd -W 2>/dev/null || pwd))"
  # Copied first: a write ahead log database cannot be opened from a read-only mount.
  docker run --rm -v "${DIR}:/backup:ro" -e FILE="$(basename "$SRC")" node:24-alpine sh -c \
    'cp "/backup/$FILE" /tmp/check.sqlite && node -e "const {DatabaseSync}=require(\"node:sqlite\");const db=new DatabaseSync(\"/tmp/check.sqlite\");console.log(JSON.stringify({conversions:db.prepare(\"SELECT COUNT(*) AS n FROM conversions\").get().n,schemaVersion:db.prepare(\"SELECT MAX(version) AS v FROM schema_migrations\").get().v}))"'
  exit 0
fi

SRC="${1:?usage: scripts/restore.sh <backup-file>}"
[ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 1; }
DIR="$(cd "$(dirname "$SRC")" && (pwd -W 2>/dev/null || pwd))"
FILE="$(basename "$SRC")"
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]')}"
VOLUME="${PROJECT}_breadcrumb-data"

echo "==> stopping the application (volume ${VOLUME} is kept)"
docker compose stop breadcrumb

echo "==> replacing the database on the volume with ${FILE}"
docker run --rm -v "${VOLUME}:/data" -v "${DIR}:/backup:ro" alpine sh -c \
  "rm -f /data/breadcrumb.sqlite /data/breadcrumb.sqlite-wal /data/breadcrumb.sqlite-shm && cp \"/backup/${FILE}\" /data/breadcrumb.sqlite && chown 1000:1000 /data/breadcrumb.sqlite && ls -l /data"

echo "==> starting the application"
docker compose start breadcrumb
for i in $(seq 1 30); do
  if docker compose exec -T breadcrumb wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    docker compose exec -T breadcrumb wget -qO- http://127.0.0.1:3000/healthz; echo
    echo "==> restored. Open the history page and compare the entry count with the backup."
    exit 0
  fi
  sleep 1
done
echo "the application did not become healthy after the restore" >&2
exit 1
