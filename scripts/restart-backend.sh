#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_PORT="${BACKEND_PORT:-8000}"
CURRENT_BACKEND_PID="${CURRENT_BACKEND_PID:-}"

pick_uvicorn() {
  if [ -x "$BACKEND_DIR/.venv312/bin/uvicorn" ]; then
    echo "$BACKEND_DIR/.venv312/bin/uvicorn"
    return
  fi
  if [ -x "$BACKEND_DIR/.venv-local/bin/uvicorn" ]; then
    echo "$BACKEND_DIR/.venv-local/bin/uvicorn"
    return
  fi
  if [ -x "$BACKEND_DIR/.venv/bin/uvicorn" ]; then
    echo "$BACKEND_DIR/.venv/bin/uvicorn"
    return
  fi
  command -v uvicorn
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

wait_for_port_release "$BACKEND_PORT" || true

UVICORN_BIN="$(pick_uvicorn)"
EXPAT_LIB="/opt/homebrew/opt/expat/lib"

cd "$BACKEND_DIR"
if [ -d "$EXPAT_LIB" ]; then
  nohup env "DYLD_LIBRARY_PATH=$EXPAT_LIB" "$UVICORN_BIN" app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" >> "$BACKEND_DIR/uvicorn.out.log" 2>> "$BACKEND_DIR/uvicorn.err.log" &
else
  nohup "$UVICORN_BIN" app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" >> "$BACKEND_DIR/uvicorn.out.log" 2>> "$BACKEND_DIR/uvicorn.err.log" &
fi
