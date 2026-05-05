#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/version.txt")"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/updates/releases}"
PACKAGE_NAME="${PACKAGE_NAME:-fms-${VERSION}.zip}"
PACKAGE_PATH="$OUTPUT_DIR/$PACKAGE_NAME"

mkdir -p "$OUTPUT_DIR"
cd "$ROOT_DIR"

echo "==> Creating local update package: $PACKAGE_PATH"
rm -f "$PACKAGE_PATH"

zip -qr "$PACKAGE_PATH" \
  backend frontend scripts updates version.txt update-manifest.json README.md INSTALL.md DEPLOYMENT.md docker-compose.yml \
  -x \
  "backend/.env" \
  "backend/.venv/*" \
  "backend/.venv-local/*" \
  "backend/.venv-mac/*" \
  "backend/.venv312/*" \
  "backend/.venv-runtime/*" \
  "backend/uploads/*" \
  "backend/backups/*" \
  "backend/*.db" \
  "backend/*.sqlite" \
  "backend/*.sqlite3" \
  "backend/**/*.pyc" \
  "backend/**/__pycache__/*" \
  "frontend/node_modules/*" \
  "frontend/dist/*" \
  "frontend/.env" \
  "frontend/.env.local" \
  "updates/releases/*.zip" \
  "updates/releases/database-backups/*" \
  ".git/*" \
  ".DS_Store"

echo "==> Done: $PACKAGE_PATH"
