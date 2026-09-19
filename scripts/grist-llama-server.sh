#!/usr/bin/env bash
# Start OpenAI-compatible llama-server for Grist (Phase 2).
# 32GB unified memory → 32K context; override with GRIST_CTX / GRIST_PORT.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRISM_TAG="${PRISM_TAG:-prism-b10709-9a9394a}"
SERVER="$ROOT/tools/llama-prism/$PRISM_TAG/llama-server"
GGUF="${GRIST_GGUF:-$ROOT/models/Ternary-Bonsai-2-27B-PTQ1_0.gguf}"
CTX="${GRIST_CTX:-32768}"
PORT="${GRIST_PORT:-8080}"
NGL="${GRIST_NGL:-99}"

if [[ ! -x "$SERVER" ]]; then
  echo "Missing $SERVER — run scripts/grist-phase2-setup.sh first."
  exit 1
fi
if [[ ! -f "$GGUF" ]]; then
  # resolve symlink / nested HF layout
  FOUND="$(find "$ROOT/models" -name "$(basename "$GGUF")" -type f 2>/dev/null | head -1 || true)"
  if [[ -n "$FOUND" ]]; then
    GGUF="$FOUND"
  else
    echo "Missing GGUF — run scripts/grist-phase2-setup.sh first."
    exit 1
  fi
fi

echo "Grist llama-server: model=$GGUF ctx=$CTX port=$PORT ngl=$NGL"
exec "$SERVER" \
  -m "$GGUF" \
  -c "$CTX" \
  -ngl "$NGL" \
  --port "$PORT" \
  --host 127.0.0.1 \
  -fa on \
  --jinja
