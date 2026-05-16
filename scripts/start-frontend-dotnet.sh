#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FRONTEND_DIR="$ROOT_DIR/frontend"
DOTNET_API_BASE="${DOTNET_API_BASE:-http://localhost:8088/api/dotnet/v1}"
FRONTEND_PORT="${FRONTEND_DOTNET_PORT:-5174}"

if [ ! -d "$FRONTEND_DIR" ]; then
  echo "لم يتم العثور على مجلد الواجهة: $FRONTEND_DIR" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm غير مثبت أو غير متاح في PATH." >&2
  exit 1
fi

echo "التأكد من تشغيل .NET API المستقل..."
"$ROOT_DIR/scripts/start-dotnet-api.sh"

echo "تشغيل الواجهة على .NET API..."
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo "API Base: $DOTNET_API_BASE"
echo
echo "بيانات الدخول الافتراضية:"
echo "  البريد: admin@qib.internal-bank.qa"
echo "  كلمة المرور: ChangeMe@12345"

cd "$FRONTEND_DIR"
VITE_API_BASE_URL="$DOTNET_API_BASE" exec npm run dev -- --mode dotnet --host 0.0.0.0 --port "$FRONTEND_PORT" --strictPort
