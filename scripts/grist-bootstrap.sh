#!/usr/bin/env bash
# Cold-start bootstrap over a pilot repo (pre-POC §6). Resumable overnight job.
#
#   ./scripts/grist-bootstrap.sh /path/to/Prosh
#
# Steps: pin SHA → Graphify map (if available) → ownership mine → memory seed
# notes. Map-reduce distillation (frontier tokens) is left as a manual follow-up.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${1:-.}"
REPO="$(cd "$REPO" && pwd)"
OUT="${GRIST_BOOTSTRAP_OUT:-$REPO/.grist/bootstrap}"
SINCE="${GRIST_BOOTSTRAP_SINCE:-18months}"

mkdir -p "$OUT"
SHA="$(git -C "$REPO" rev-parse HEAD)"
echo "$SHA" >"$OUT/pinned-sha.txt"
echo "[grist:bootstrap] pinned=$SHA repo=$REPO out=$OUT"

if command -v graphify >/dev/null 2>&1; then
  echo "[grist:bootstrap] building Graphify code map…"
  (cd "$REPO" && graphify . --out "$OUT/graphify-out") || true
  if [[ -f "$OUT/graphify-out/graph.json" ]]; then
    ln -sfn "$OUT/graphify-out/graph.json" "$OUT/graph.json"
    echo "[grist:bootstrap] graph=$OUT/graph.json"
  fi
else
  echo "[grist:bootstrap] graphify not on PATH — skip map build (install later for bake-off)"
fi

echo "[grist:bootstrap] mining ownership (bounded)…"
python3 "$ROOT/scripts/ownership-mine.py" \
  --repo "$REPO" \
  --since "$SINCE" \
  --limit "${GRIST_BOOTSTRAP_OWNERSHIP_LIMIT:-5000}" \
  --out "$OUT/ownership.jsonl"

cat >"$OUT/NEXT.md" <<EOF
# Bootstrap next steps

Pinned SHA: \`$SHA\`

1. Review \`$OUT/ownership.jsonl\` — only \`remember\` user-approved rows.
2. Run Graphify vs CRG bake-off (\`docs/code-map.md\`) on this SHA.
3. Optional map-reduce distillation (~\$50–200 frontier) for team profile.
4. Start shadow burn-in: \`bun dev\` with \`OPENROUTER_API_KEY\`; report via
   \`bun scripts/burn-in-report.ts\`.
5. Fill the 12-question tech-lead questionnaire for the unresolvable remainder.
EOF

echo "[grist:bootstrap] done — see $OUT/NEXT.md"
