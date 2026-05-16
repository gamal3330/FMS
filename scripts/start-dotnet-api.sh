#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DOTNET_DIR="${DOTNET_API_DIR:-$ROOT_DIR/Qib.ServicePortal.Api}"
API_URL="${DOTNET_API_URL:-http://localhost:8088}"
HEALTH_URL="$API_URL/api/dotnet/v1/health/live"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker غير مثبت أو غير متاح في PATH. نسخة .NET المستقلة تعمل عبر Docker حالياً." >&2
  exit 1
fi

if [ ! -f "$DOTNET_DIR/docker-compose.yml" ]; then
  echo "لم يتم العثور على docker-compose.yml الخاص بنسخة .NET في: $DOTNET_DIR" >&2
  exit 1
fi

echo "تشغيل ASP.NET Core API المستقل..."
echo "المجلد: $DOTNET_DIR"
echo "الرابط: $API_URL"
if [ "${ENABLE_DANGEROUS_DATABASE_OPERATIONS:-false}" = "true" ]; then
  echo "تنبيه: تم تفعيل عمليات قاعدة البيانات الخطرة لهذه الجلسة."
fi

cd "$DOTNET_DIR"
docker compose up -d --build

echo "انتظار جاهزية .NET API..."
for _ in $(seq 1 "${DOTNET_WAIT_SECONDS:-90}"); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "تم تشغيل .NET API بنجاح."
    echo "Health: $HEALTH_URL"
    echo "Swagger: $API_URL/swagger/index.html"
    echo "PostgreSQL المستقل: localhost:55432"
    echo
    echo "بيانات المدير الافتراضي:"
    echo "  البريد: admin@qib.internal-bank.qa"
    echo "  كلمة المرور: ChangeMe@12345"
    echo
    echo "لمتابعة السجلات:"
    echo "  cd \"$DOTNET_DIR\" && docker compose logs -f qib-dotnet-api"
    if [ "${DOTNET_FOLLOW_LOGS:-0}" = "1" ]; then
      docker compose logs -f qib-dotnet-api
    fi
    exit 0
  fi
  sleep 1
done

echo "تعذر التأكد من جاهزية .NET API. آخر السجلات:" >&2
docker compose logs --no-color --tail=120 qib-dotnet-api >&2 || true
exit 1
