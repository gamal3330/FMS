#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_PORT="${BACKEND_PORT:-8000}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
CURRENT_BACKEND_PID="${CURRENT_BACKEND_PID:-}"

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

wait_for_port_release() {
  local port="$1"
  for _ in $(seq 1 20); do
    if ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

sleep 1

if [ -n "$CURRENT_BACKEND_PID" ]; then
  kill "$CURRENT_BACKEND_PID" 2>/dev/null || true
fi

EXISTING_BACKEND_PIDS="$(lsof -tiTCP:"$BACKEND_PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_BACKEND_PIDS" ]; then
  for pid in $EXISTING_BACKEND_PIDS; do
    kill "$pid" 2>/dev/null || true
  done
fi

wait_for_port_release "$BACKEND_PORT" || true

PYTHON_BIN="$(pick_python)"
EXPAT_LIB="/opt/homebrew/opt/expat/lib"

cd "$BACKEND_DIR"
if [ -d "$EXPAT_LIB" ]; then
  nohup env "DYLD_LIBRARY_PATH=$EXPAT_LIB" "$PYTHON_BIN" -m uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" >> "$BACKEND_DIR/uvicorn.out.log" 2>> "$BACKEND_DIR/uvicorn.err.log" &
else
  nohup "$PYTHON_BIN" -m uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" >> "$BACKEND_DIR/uvicorn.out.log" 2>> "$BACKEND_DIR/uvicorn.err.log" &
fi
