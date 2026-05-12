#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/backend/.venv-runtime/bin/python}"

if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="$(command -v python3)"
fi

PYTHONPATH="$ROOT_DIR/backend" "$PYTHON_BIN" -m unittest discover \
  -s "$ROOT_DIR/backend/tests" \
  -p "test_core_business_scenarios.py"
