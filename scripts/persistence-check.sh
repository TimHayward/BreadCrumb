#!/usr/bin/env bash
# BC-004: a conversion recorded before the image is rebuilt and the stack
# restarted is still present afterwards, on a named volume that exists
# independently of any container. Runs in CI with plain Docker Compose and is
# rehearsed by hand in Portainer at each milestone boundary.
#
# Uses its own compose project name so it never touches a real deployment.
set -euo pipefail
cd "$(dirname "$0")/.."
# Git Bash on Windows rewrites container paths like /d into D:/ unless told not to.
export MSYS_NO_PATHCONV=1

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-breadcrumb-persistence}"
export BREADCRUMB_PUBLISH_PORT="${BREADCRUMB_PUBLISH_PORT:-3100}"
BASE="http://127.0.0.1:${BREADCRUMB_PUBLISH_PORT}"
VOLUME="${COMPOSE_PROJECT_NAME}_breadcrumb-data"
LINK='https://848.sharepoint.com/sites/848Technical/Projects/Forms/AllItems.aspx?id=%2Fsites%2F848Technical%2FProjects%2FProjects%20WIP%2FDeloitte%2FDeloitte%20%2D%20Digital%20Development%20Environment%2FSMR%20SIID%20029%20%2D%20Development%20Environment%20for%20Digital%20team%2Epdf&parent=%2Fsites%2F848Technical%2FProjects%2FProjects%20WIP%2FDeloitte%2FDeloitte%20%2D%20Digital%20Development%20Environment'
EXPECTED_PATH='/sites/848Technical/Projects/Projects WIP/Deloitte/Deloitte - Digital Development Environment/SMR SIID 029 - Development Environment for Digital team.pdf'

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nFAIL: %s\n' "$*" >&2; exit 1; }
json_field() { node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=r[process.argv[1]];if(v===undefined)process.exit(1);process.stdout.write(String(v))' "$1"; }

cleanup() {
  step "cleanup: removing the test stack and its volume"
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

step "start from a clean state"
docker compose down -v --remove-orphans >/dev/null 2>&1 || true

step "1. build and start the stack"
BUILD_ID="check-$(date +%s)-a" docker compose up -d --build --wait

step "2. record one conversion"
RESPONSE="$(curl -fsS -X POST "${BASE}/api/convert" -H 'content-type: application/json' \
  --data "$(node -e 'process.stdout.write(JSON.stringify({link: process.argv[1], source: "web"}))' "$LINK")")"
ID="$(printf '%s' "$RESPONSE" | json_field id)"
CREATED="$(printf '%s' "$RESPONSE" | json_field createdAt)"
echo "recorded history entry ${ID} at ${CREATED}"

step "3. stop and remove the container (not the volume), rebuild with a changed build id, start again"
docker compose down
BUILD_ID="check-$(date +%s)-b" docker compose up -d --build --wait

step "4. the conversion is still present with the same timestamp and path"
DETAIL="$(curl -fsS "${BASE}/history/${ID}")"
printf '%s' "$DETAIL" | grep -qF "datetime=\"${CREATED}\"" || fail "history entry ${ID} lost its timestamp ${CREATED}"
printf '%s' "$DETAIL" | grep -qF "<code>${EXPECTED_PATH}</code>" || fail "history entry ${ID} lost its path"
echo "entry ${ID} survived the rebuild"

step "5. the named volume exists independently of the container and holds the database file"
docker volume inspect "$VOLUME" >/dev/null || fail "volume ${VOLUME} not found"
FILES="$(docker run --rm -v "${VOLUME}:/d:ro" alpine ls -1 /d)"
echo "$FILES" | sed 's/^/   /'
echo "$FILES" | grep -qx 'breadcrumb.sqlite' || fail "breadcrumb.sqlite not on the volume"

step "6. remove the stack without volumes, start it again, entry still present"
docker compose down
docker compose up -d --wait
curl -fsS "${BASE}/history/${ID}" | grep -qF "datetime=\"${CREATED}\"" || fail "history entry ${ID} lost after stack removal"

printf '\nPASS: history survives rebuild, restart and stack removal on volume %s\n' "$VOLUME"
