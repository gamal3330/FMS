#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DOTNET_DIR="${DOTNET_API_DIR:-$ROOT_DIR/Qib.ServicePortal.Api}"
IDENTIFIER="${DOTNET_ADMIN_IDENTIFIER:-admin@qib.internal-bank.qa}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker غير مثبت أو غير متاح في PATH." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 غير مثبت أو غير متاح في PATH." >&2
  exit 1
fi

if [ ! -f "$DOTNET_DIR/docker-compose.yml" ]; then
  echo "لم يتم العثور على docker-compose.yml الخاص بنسخة .NET في: $DOTNET_DIR" >&2
  exit 1
fi

if [ -z "${DOTNET_ADMIN_PASSWORD:-}" ]; then
  read -rsp "كلمة المرور الجديدة لمدير النظام: " DOTNET_ADMIN_PASSWORD
  echo
  read -rsp "تأكيد كلمة المرور الجديدة: " DOTNET_ADMIN_PASSWORD_CONFIRM
  echo
  if [ "$DOTNET_ADMIN_PASSWORD" != "$DOTNET_ADMIN_PASSWORD_CONFIRM" ]; then
    echo "كلمتا المرور غير متطابقتين." >&2
    exit 1
  fi
fi

if [ -z "$DOTNET_ADMIN_PASSWORD" ]; then
  echo "كلمة المرور لا يمكن أن تكون فارغة." >&2
  exit 1
fi

PASSWORD_HASH="$(DOTNET_ADMIN_PASSWORD="$DOTNET_ADMIN_PASSWORD" python3 - <<'PY'
import base64
import hashlib
import os

password = os.environ["DOTNET_ADMIN_PASSWORD"]
iterations = 100_000
salt = os.urandom(16)
key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)
print(f"PBKDF2${iterations}${base64.b64encode(salt).decode()}${base64.b64encode(key).decode()}")
PY
)"

cd "$DOTNET_DIR"

echo "إعادة تعيين كلمة مرور مدير النظام في قاعدة .NET المستقلة..."
docker compose exec -T qib-dotnet-postgres psql \
  -U qib_dotnet \
  -d qib_service_portal_dotnet \
  -v ON_ERROR_STOP=1 \
  -v identifier="$IDENTIFIER" \
  -v password_hash="$PASSWORD_HASH" <<'SQL'
WITH updated AS (
  UPDATE users
  SET
    "PasswordHash" = :'password_hash',
    "IsActive" = TRUE,
    "IsLocked" = FALSE,
    "ForcePasswordChange" = FALSE,
    "PasswordChangedAt" = NOW(),
    "UpdatedAt" = NOW()
  WHERE
    LOWER("Email") = LOWER(:'identifier')
    OR LOWER("Username") = LOWER(:'identifier')
    OR LOWER(COALESCE("EmployeeNumber", '')) = LOWER(:'identifier')
  RETURNING "Id", "Username", "Email", "EmployeeNumber", "NameAr"
)
SELECT * FROM updated;
SQL

echo "تمت إعادة التعيين. يمكنك تسجيل الدخول الآن باستخدام:"
echo "  المعرّف: $IDENTIFIER"
