#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

green() { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
red() { printf "\033[31m%s\033[0m\n" "$1"; }

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    red "الأمر '$1' غير مثبت."
    exit 1
  fi
}

compose() {
  docker compose "$@"
}

require_command docker

if [ ! -f ".env" ]; then
  cp .env.docker.example .env
  yellow "تم إنشاء ملف .env من .env.docker.example."
  yellow "راجع كلمات المرور و SECRET_KEY داخل .env ثم أعد تشغيل السكربت."
  exit 0
fi

green "بناء وتشغيل النظام عبر Docker..."
compose up -d --build

green "حالة الخدمات:"
compose ps

printf "\n"
green "تم التشغيل."
printf "افتح النظام عبر: http://SERVER_IP\n"
printf "لعرض السجلات: docker compose logs -f\n"
