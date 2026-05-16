#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
HEALTH_URL="http://$BACKEND_HOST:$BACKEND_PORT/health"
BACKEND_LOG="${FASTAPI_LOG:-$BACKEND_DIR/uvicorn.out.log}"
BACKEND_ERR_LOG="${FASTAPI_ERR_LOG:-$BACKEND_DIR/uvicorn.err.log}"
PID_FILE="${FASTAPI_PID_FILE:-$BACKEND_DIR/uvicorn.pid}"

if [ ! -f "$ROOT_DIR/scripts/run-backend-local.sh" ]; then
  echo "لم يتم العثور على scripts/run-backend-local.sh" >&2
  exit 1
fi

if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "FastAPI يعمل مسبقاً."
  echo "Health: $HEALTH_URL"
  echo "API Base: http://$BACKEND_HOST:$BACKEND_PORT/api/v1"
  exit 0
fi

echo "تشغيل FastAPI الحالي بشكل منفصل..."
echo "المجلد: $BACKEND_DIR"
echo "الرابط: http://$BACKEND_HOST:$BACKEND_PORT"
echo "قاعدة البيانات المحلية من backend/.env إن وجدت."

if [ "${FASTAPI_FOREGROUND:-0}" = "1" ]; then
  echo "تشغيل في المقدمة. للإيقاف اضغط Ctrl+C."
  exec "$ROOT_DIR/scripts/run-backend-local.sh"
fi

nohup "$ROOT_DIR/scripts/run-backend-local.sh" > "$BACKEND_LOG" 2> "$BACKEND_ERR_LOG" &
BACKEND_PID=$!
disown "$BACKEND_PID" 2>/dev/null || true
echo "$BACKEND_PID" > "$PID_FILE"

echo "انتظار جاهزية FastAPI..."
for _ in $(seq 1 "${FASTAPI_WAIT_SECONDS:-60}"); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "تم تشغيل FastAPI بنجاح."
    echo "Health: $HEALTH_URL"
    echo "API Base: http://$BACKEND_HOST:$BACKEND_PORT/api/v1"
    echo "PID: $BACKEND_PID"
    echo "Log: $BACKEND_LOG"
    echo
    echo "لإيقافه:"
    echo "  kill \$(cat \"$PID_FILE\")"
    if [ "${FASTAPI_FOLLOW_LOGS:-0}" = "1" ]; then
      tail -f "$BACKEND_LOG"
    fi
    exit 0
  fi

  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    echo "توقف FastAPI أثناء التشغيل. آخر السجلات:" >&2
    tail -80 "$BACKEND_LOG" >&2 || true
    tail -80 "$BACKEND_ERR_LOG" >&2 || true
    exit 1
  fi

  sleep 1
done

echo "تعذر التأكد من جاهزية FastAPI. آخر السجلات:" >&2
tail -120 "$BACKEND_LOG" >&2 || true
tail -120 "$BACKEND_ERR_LOG" >&2 || true
exit 1
