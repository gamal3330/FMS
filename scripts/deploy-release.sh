#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fms}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"
echo "==> Pulling latest code from $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Rebuilding containers"
docker compose build

echo "==> Starting services"
docker compose up -d

echo "==> Applying database migrations through the update manager"
docker compose exec -T backend python - <<'PY'
from app.db.session import SessionLocal
from app.services.update_manager import apply_available_update

db = SessionLocal()
try:
    result = apply_available_update(db)
    print(result.get("message"))
finally:
    db.close()
PY

echo "==> Done"
