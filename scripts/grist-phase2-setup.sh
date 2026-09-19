#!/usr/bin/env bash
# Phase 2: PrismML llama.cpp + Ternary Bonsai 2 27B (PTQ1_0).
# Stock Homebrew llama.cpp cannot run these ternary GGUFs — use the PrismML fork.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRISM_TAG="${PRISM_TAG:-prism-b10709-9a9394a}"
PRISM_DIR="$ROOT/tools/llama-prism/$PRISM_TAG"
MODEL_DIR="$ROOT/models"
GGUF="Ternary-Bonsai-2-27B-PTQ1_0.gguf"
GGUF_PATH="$MODEL_DIR/$GGUF"
ASSET="llama-${PRISM_TAG}-bin-macos-arm64.tar.gz"

mkdir -p "$ROOT/tools/llama-prism" "$MODEL_DIR"

# Accept either stripped extract or nested release folder from a prior download.
NESTED="$ROOT/tools/llama-prism/llama-${PRISM_TAG}"
if [[ ! -x "$PRISM_DIR/llama-server" && -x "$NESTED/llama-server" ]]; then
  mkdir -p "$PRISM_DIR"
  ln -sfn "../$(basename "$NESTED")/llama-server" "$PRISM_DIR/llama-server"
  ln -sfn "../$(basename "$NESTED")/llama-cli" "$PRISM_DIR/llama-cli"
fi

if [[ ! -x "$PRISM_DIR/llama-server" ]]; then
  echo "Downloading PrismML llama.cpp $PRISM_TAG (macos-arm64)…"
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/$ASSET" \
    "https://github.com/PrismML-Eng/llama.cpp/releases/download/${PRISM_TAG}/${ASSET}"
  mkdir -p "$PRISM_DIR"
  tar -xzf "$TMP/$ASSET" -C "$PRISM_DIR" --strip-components=1
  rm -rf "$TMP"
fi

"$PRISM_DIR/llama-server" --version

if [[ ! -f "$GGUF_PATH" ]]; then
  echo "Downloading $GGUF (~6 GB)…"
  hf download prism-ml/Ternary-Bonsai-2-27B-gguf --include "$GGUF" --local-dir "$MODEL_DIR"
fi

# HF may leave the file nested; normalize to models/$GGUF
if [[ ! -f "$GGUF_PATH" ]]; then
  FOUND="$(find "$MODEL_DIR" -name "$GGUF" -type f | head -1 || true)"
  if [[ -n "$FOUND" && "$FOUND" != "$GGUF_PATH" ]]; then
    ln -sfn "$FOUND" "$GGUF_PATH"
  fi
fi

test -f "$GGUF_PATH" || { echo "GGUF missing at $GGUF_PATH"; exit 1; }
echo "Ready: $GGUF_PATH"
echo "Start server: $ROOT/scripts/grist-llama-server.sh"
