#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKEND_LOG="$ROOT_DIR/backend/uvicorn.out.log"
FRONTEND_DIR="$ROOT_DIR/frontend"

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting backend on http://127.0.0.1:${BACKEND_PORT:-8000}"
"$ROOT_DIR/scripts/run-backend-local.sh" > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

echo "Waiting for backend..."
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT:-8000}/health" >/dev/null 2>&1; then
    echo "Backend is ready."
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:${BACKEND_PORT:-8000}/health" >/dev/null 2>&1; then
  echo "Backend did not start. Recent log:"
  tail -80 "$BACKEND_LOG" || true
  exit 1
fi

echo "Starting frontend on http://localhost:5173"
cd "$FRONTEND_DIR"
exec npm run dev
