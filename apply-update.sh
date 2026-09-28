#!/usr/bin/env bash
# XUAN 3.1.0: in-place upgrade for the existing 3.0.7 Docker installation.
set -Eeuo pipefail
PROJECT_DIR="${1:-${XUAN_DIR:-${ATLAS_DIR:-$HOME/docker/atlas}}}"
SERVICE_NAME="${XUAN_SERVICE:-atlas}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v docker >/dev/null
command -v python3 >/dev/null
command -v curl >/dev/null
[[ -f "$PROJECT_DIR/compose.yaml" ]] || { echo "Cannot find compose.yaml in $PROJECT_DIR" >&2; exit 1; }
[[ "$PROJECT_DIR" != "$SCRIPT_DIR" ]] || { echo 'Run this updater against your existing installation, not this extracted package.' >&2; exit 1; }
python3 - "$PROJECT_DIR/backend/src/server.ts" <<'PY'
import sys
from pathlib import Path
if '3.0.7' not in Path(sys.argv[1]).read_text():
    raise SystemExit('This update requires the XUAN 3.0.7 source. No files changed.')
PY
cd "$PROJECT_DIR"
docker compose config -q
docker compose config --services | grep -Fxq "$SERVICE_NAME"
CONTAINER_ID="$(docker compose ps -q "$SERVICE_NAME")"
[[ -n "$CONTAINER_ID" ]] || { echo 'Start the existing XUAN service before updating.' >&2; exit 1; }
OLD_IMAGE="$(docker inspect -f '{{.Image}}' "$CONTAINER_ID")"
OLD_REF="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER_ID")"
BACKUP_DIR="$HOME/xuan-migration-backups/xuan-before-3.1.0-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
FILES=(frontend/src/main.tsx frontend/src/refresh.css frontend/src/lib/visiblePoll.ts frontend/src/hooks/useApps.ts frontend/src/hooks/useMetrics.ts frontend/src/hooks/useConfig.ts backend/src/server.ts)
for item in "${FILES[@]}"; do
  [[ -f "$SCRIPT_DIR/$item" ]] || { echo "Missing update file: $item" >&2; exit 1; }
  mkdir -p "$BACKUP_DIR/$(dirname "$item")"
  if [[ -e "$PROJECT_DIR/$item" ]]; then cp -a "$PROJECT_DIR/$item" "$BACKUP_DIR/$item"; else touch "$BACKUP_DIR/$item.absent"; fi
done
docker image tag "$OLD_IMAGE" "xuan-rollback:before-3.1.0"
rollback() {
  trap - ERR
  echo "Update failed; restoring previous source and image." >&2
  for item in "${FILES[@]}"; do
    if [[ -f "$BACKUP_DIR/$item.absent" ]]; then rm -f -- "$PROJECT_DIR/$item"; else cp -a "$BACKUP_DIR/$item" "$PROJECT_DIR/$item"; fi
  done
  docker image tag "$OLD_IMAGE" "$OLD_REF" || true
  docker compose up -d --no-build --no-deps "$SERVICE_NAME" || true
  echo "Backup: $BACKUP_DIR" >&2
  exit 1
}
trap rollback ERR
for item in "${FILES[@]}"; do
  mkdir -p "$PROJECT_DIR/$(dirname "$item")"
  cp "$SCRIPT_DIR/$item" "$PROJECT_DIR/$item"
done
echo 'Building XUAN 3.1.0 using existing Docker dependency layers...'
docker compose build "$SERVICE_NAME"
docker compose up -d --no-deps "$SERVICE_NAME"
BASE_URL="${XUAN_HEALTH_URL:-http://127.0.0.1:3000}"
ready=false
for ((i=0; i<60; i++)); do
  if curl -fsS --max-time 3 "$BASE_URL/api/config" | python3 -c 'import sys,json; sys.exit(0 if json.load(sys.stdin).get("version")=="3.1.0" else 1)' 2>/dev/null; then ready=true; break; fi
  sleep 2
done
[[ "$ready" == true ]]
curl -fsS --max-time 5 "$BASE_URL/api/health" >/dev/null
trap - ERR
echo "XUAN 3.1.0 is ready. Refresh your browser. Backup: $BACKUP_DIR"
