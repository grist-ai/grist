#!/usr/bin/env bash
# Quick generation benchmark against a running llama-server (tok/s).
set -euo pipefail

BASE="${GRIST_LLAMA_URL:-http://127.0.0.1:8080}"
PROMPT="${1:-Write a TypeScript function that returns the sum of two numbers. Keep it short.}"

start=$(python3 -c 'import time; print(time.time())')
resp=$(curl -sS "${BASE}/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d "$(python3 - <<PY
import json
print(json.dumps({
  "model": "bonsai-2-27b",
  "messages": [{"role": "user", "content": """$PROMPT"""}],
  "max_tokens": 128,
  "temperature": 0.5,
}))
PY
)")
end=$(python3 -c 'import time; print(time.time())')

python3 - <<PY
import json, os
resp = json.loads('''$(echo "$resp" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')''')
# simpler path:
PY

python3 -c "
import json, time
raw = '''${resp}'''
" 2>/dev/null || true

echo "$resp" | python3 -c '
import json, sys, os
data = json.load(sys.stdin)
usage = data.get("usage") or {}
completion = usage.get("completion_tokens") or usage.get("completion_tokens")
text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
print("--- completion ---")
print(text[:500])
print("--- usage ---")
print(json.dumps(usage, indent=2))
'
echo "wall_clock_s=$(python3 -c "print(round($end-$start, 3))")"
