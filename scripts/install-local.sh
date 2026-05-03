#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
PYTHON_BIN="${PYTHON_BIN:-}"

green() { printf "\033[32m%s\033[0m\n" "$1"; }
blue() { printf "\033[34m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
red() { printf "\033[31m%s\033[0m\n" "$1"; }

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    red "الأمر '$1' غير مثبت. يرجى تثبيته ثم أعد التشغيل."
    exit 1
  fi
}

pick_python() {
  if [ -n "$PYTHON_BIN" ]; then
    echo "$PYTHON_BIN"
    return
  fi

  if command -v python3.12 >/dev/null 2>&1; then
    command -v python3.12
    return
  fi

  if command -v /opt/homebrew/bin/python3.12 >/dev/null 2>&1; then
    echo "/opt/homebrew/bin/python3.12"
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi

  red "لم يتم العثور على Python. يفضل Python 3.12 لتشغيل النظام محلياً."
  exit 1
}

ensure_env_files() {
  if [ ! -f "$BACKEND_DIR/.env" ]; then
    blue "إنشاء backend/.env للتشغيل المحلي..."
    cat > "$BACKEND_DIR/.env" <<EOF
DATABASE_URL=sqlite:///./qib_local.db
SECRET_KEY=local-development-secret
CORS_ORIGINS=http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}
SEED_ADMIN_EMAIL=admin@qib.internal-bank.qa
SEED_ADMIN_PASSWORD=Admin@12345
EOF
  fi

  if [ ! -f "$FRONTEND_DIR/.env" ]; then
    blue "إنشاء frontend/.env للتشغيل المحلي..."
    cat > "$FRONTEND_DIR/.env" <<EOF
VITE_API_BASE_URL=http://localhost:${BACKEND_PORT}/api/v1
EOF
  fi
}

install_backend() {
  local python_bin="$1"
  blue "تجهيز بيئة Python..."
  "$python_bin" -m venv "$BACKEND_DIR/.venv-local"
  "$BACKEND_DIR/.venv-local/bin/python" -m pip install --upgrade pip
  "$BACKEND_DIR/.venv-local/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"
}

install_frontend() {
  blue "تثبيت اعتماديات الواجهة..."
  require_command npm
  (cd "$FRONTEND_DIR" && npm install)
}

start_services() {
  local expat_lib="/opt/homebrew/opt/expat/lib"
  local dyld_prefix=()
  if [ -d "$expat_lib" ]; then
    dyld_prefix=(env "DYLD_LIBRARY_PATH=$expat_lib")
  fi

  blue "تشغيل الخلفية على http://localhost:${BACKEND_PORT}"
  (cd "$BACKEND_DIR" && "${dyld_prefix[@]}" .venv-local/bin/uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT") &
  BACKEND_PID=$!

  blue "تشغيل الواجهة على http://localhost:${FRONTEND_PORT}"
  (cd "$FRONTEND_DIR" && npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT") &
  FRONTEND_PID=$!

  trap 'yellow "إيقاف الخدمات..."; kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true' INT TERM EXIT

  green "تم التشغيل."
  printf "\n"
  printf "الواجهة:  http://localhost:%s\n" "$FRONTEND_PORT"
  printf "الخلفية:  http://localhost:%s\n" "$BACKEND_PORT"
  printf "توثيق API: http://localhost:%s/docs\n" "$BACKEND_PORT"
  printf "\n"
  printf "الحساب الافتراضي:\n"
  printf "Email:    admin@qib.internal-bank.qa\n"
  printf "Password: Admin@12345\n"
  printf "\n"
  yellow "لإيقاف النظام اضغط Ctrl+C"

  wait
}

main() {
  printf "\n"
  green "نظام إدارة طلبات الخدمات التقنية - التثبيت المحلي"
  printf "=================================================\n"

  require_command node
  require_command npm

  local python_bin
  python_bin="$(pick_python)"
  blue "استخدام Python: $python_bin"

  ensure_env_files
  install_backend "$python_bin"
  install_frontend
  start_services
}

main "$@"
