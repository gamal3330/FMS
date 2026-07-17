#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/version.txt" 2>/dev/null || echo "dev")"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/.deploy/windows}"
PACKAGE_NAME="${PACKAGE_NAME:-qib-service-portal-windows-${VERSION}-${STAMP}.zip}"
PACKAGE_PATH="$OUTPUT_DIR/$PACKAGE_NAME"

mkdir -p "$OUTPUT_DIR"
cd "$ROOT_DIR"

echo "==> Creating Windows deployment source package"
echo "==> Output: $PACKAGE_PATH"
rm -f "$PACKAGE_PATH"

zip -qr "$PACKAGE_PATH" \
  FMS.sln \
  README.md \
  INSTALL.md \
  DEPLOYMENT.md \
  version.txt \
  Qib.ServicePortal.Api \
  frontend \
  deploy/windows \
  docs/WINDOWS_SERVER_DEPLOYMENT_DOTNET_AR.md \
  scripts/create-windows-deployment-package.sh \
  -x \
  ".git/*" \
  ".DS_Store" \
  "*.log" \
  "Qib.ServicePortal.Api/bin/*" \
  "Qib.ServicePortal.Api/obj/*" \
  "Qib.ServicePortal.Api/appsettings.Production.json" \
  "frontend/node_modules/*" \
  "frontend/dist/*" \
  "frontend/.env" \
  "frontend/.env.local" \
  "frontend/.env.production" \
  "frontend/.vite/*" \
  "**/__pycache__/*" \
  "**/*.pyc"

echo "==> Done"
echo "$PACKAGE_PATH"
