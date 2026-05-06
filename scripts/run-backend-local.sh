#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"

pick_python() {
  local candidate
  for candidate in \
    "$BACKEND_DIR/.venv-runtime/bin/python" \
    "$BACKEND_DIR/.venv312/bin/python" \
    "$BACKEND_DIR/.venv-local/bin/python" \
    "$BACKEND_DIR/.venv/bin/python" \
    "$(command -v python3.12 2>/dev/null || true)" \
    "$(command -v python3 2>/dev/null || true)"
  do
    if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >/dev/null 2>&1; then
      echo "$candidate"
      return
    fi
  done
  echo "لم يتم العثور على Python صالح لتشغيل الباكند" >&2
  exit 1
}

PYTHON_BIN="$(pick_python)"
EXPAT_LIB="/opt/homebrew/opt/expat/lib"

cd "$BACKEND_DIR"
if [ -d "$EXPAT_LIB" ]; then
  export DYLD_LIBRARY_PATH="$EXPAT_LIB${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
fi

exec "$PYTHON_BIN" -m uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" --log-level info
