#!/bin/bash
# Pareto benchmark MULTIFILE runner: 14 tasks x 6 configs = 84 headless grist runs.
# Usage: ./run.sh
# Requires: grist CLI on PATH (or set GRIST_BIN), node, python3.
# Expected spend: ~$7 at current gateway prices. Budget guard: $20.
set -uo pipefail

GRIST="${GRIST_BIN:-$(command -v grist || true)}"
if [ -z "$GRIST" ]; then
  echo "error: grist CLI not found on PATH. Install it or set GRIST_BIN." >&2
  exit 1
fi
BASE="$(cd "$(dirname "$0")" && pwd)"
WORK=$BASE/work
LOGS=$BASE/logs
RESULTS_CSV=$BASE/results.csv

mkdir -p "$WORK" "$LOGS"

TASKS="tiny-router config-loader event-bus template-engine rate-limiter god-file-split api-rename callbacks-to-async extract-validators config-centralize import-mismatch interface-drift circular-dep event-name-typo"

# config_name|rung|extra_env|standalone
CONFIGS="gate-ceil-cheapest|grist/cheapest||0 gate-ceil-frontier|grist/frontier||0 pinned-cheapest|grist/cheapest|GRIST_CTRL=off|1 pinned-frontier|grist/frontier|GRIST_CTRL=off|1 gate-specialists|grist/cheapest||0 gate-mech-off|grist/cheapest|GRIST_MECH=off|1"

PROMPT='Read PROBLEM.md in the current directory carefully. This is a multi-file codebase — read all relevant files before changing anything. Make the required changes across files as specified. Run the tests to verify your work (node test.js). Do not modify test.js. When the tests pass, you are done — stop.'

# Fresh work dirs: copy entire task dir (starter code, no solutions)
for t in $TASKS; do
  for c in gate-ceil-cheapest gate-ceil-frontier pinned-cheapest pinned-frontier gate-specialists gate-mech-off; do
    d="$WORK/$t/$c"
    rm -rf "$d"; mkdir -p "$d"
    cp "$BASE/tasks/$t/"*.js "$BASE/tasks/$t/PROBLEM.md" "$d/"
  done
done

echo "task,config,session_id,pass,cost_usd,tok_in,tok_out,tok_reason,tok_cached,model,wall_s,specialist_dispatches,note" > "$RESULTS_CSV"

TOTAL_COST=0
BUDGET=20

run_one() {
  local task=$1 cfg=$2 rung=$3 extra_env=$4 standalone=$5
  local dir="$WORK/$task/$cfg"
  local log="$LOGS/${task}_${cfg}.jsonl"
  echo "=== $task / $cfg (rung=$rung env=$extra_env standalone=$standalone) ==="

  local t0=$(date +%s)
  local ses_id=""
  local pid=""

  (
    cd "$dir"
    local standalone_flag=""
    if [ "$standalone" = "1" ]; then standalone_flag="--standalone"; fi
    if [ -n "$extra_env" ]; then
      for kv in $(echo "$extra_env" | tr ',' ' '); do export "$kv"; done
    fi
    "$GRIST" run $standalone_flag --format json --auto -m "$rung" "$PROMPT" < /dev/null > "$log" 2>&1
  ) &
  pid=$!

  # Monitor: timeout 900s (multi-file tasks take longer), cost kill-switch $2
  local elapsed=0 note=""
  while kill -0 $pid 2>/dev/null; do
    sleep 10
    elapsed=$((elapsed + 10))
    if [ $elapsed -ge 900 ]; then
      kill $pid 2>/dev/null; wait $pid 2>/dev/null
      note="TIMEOUT_900s"
      break
    fi
    if [ -z "$ses_id" ]; then
      ses_id=$(grep -o '"sessionID":"[^"]*"' "$log" 2>/dev/null | head -1 | cut -d'"' -f4)
    fi
    if [ -n "$ses_id" ]; then
      local c=$(python3 "$BASE/cost-for-session.py" "$ses_id" 2>/dev/null | cut -d, -f1)
      if awk "BEGIN{exit !((${c:-0} > 2.0))}"; then
        kill $pid 2>/dev/null; wait $pid 2>/dev/null
        note="COST_KILL_over_\$2"
        break
      fi
    fi
  done
  wait $pid 2>/dev/null
  local t1=$(date +%s)
  local wall=$((t1 - t0))

  if [ -z "$ses_id" ]; then
    ses_id=$(grep -o '"sessionID":"[^"]*"' "$log" 2>/dev/null | head -1 | cut -d'"' -f4)
  fi
  [ -z "$ses_id" ] && ses_id="UNKNOWN"

  # Cost + tokens via session export x gateway prices
  local cost="0" tin="0" tout="0" tre="0" tcached="0" model=""
  if [ "$ses_id" != "UNKNOWN" ]; then
    IFS=, read cost tin tout tre tcached model <<< $(python3 "$BASE/cost-for-session.py" "$ses_id" 2>/dev/null)
  fi

  # Specialist dispatch count via session export scan
  local dispatches="0"
  if [ "$ses_id" != "UNKNOWN" ]; then
    dispatches=$(python3 "$BASE/dispatches-for-session.py" "$ses_id" 2>/dev/null | cut -d, -f1)
    [ -z "$dispatches" ] && dispatches="0"
  fi

  # Pass/fail: run the task's own test suite (60s timeout)
  local pass="FAIL"
  if (cd "$dir" && timeout 60 node test.js > "$LOGS/${task}_${cfg}.test.log" 2>&1); then
    pass="PASS"
  else
    if ! ls "$dir"/*.js > /dev/null 2>&1; then
      note="${note:+$note;}NO_FILES"
    fi
  fi

  echo "$task,$cfg,$ses_id,$pass,$cost,$tin,$tout,$tre,$tcached,$model,$wall,$dispatches,$note" >> "$RESULTS_CSV"
  echo "  -> $pass cost=\$$cost in=$tin out=$tout cached=$tcached wall=${wall}s dispatches=$dispatches note=$note"

  TOTAL_COST=$(awk "BEGIN{print $TOTAL_COST + $cost}")
  echo "  multifile-battery spend so far: \$$TOTAL_COST"
  if awk "BEGIN{exit !($TOTAL_COST > $BUDGET)}"; then
    echo "BUDGET EXCEEDED \$$BUDGET — stopping"
    return 1
  fi
  return 0
}

for t in $TASKS; do
  for spec in $CONFIGS; do
    cfg=$(echo "$spec" | cut -d'|' -f1)
    rung=$(echo "$spec" | cut -d'|' -f2)
    eenv=$(echo "$spec" | cut -d'|' -f3)
    standalone=$(echo "$spec" | cut -d'|' -f4)
    run_one "$t" "$cfg" "$rung" "$eenv" "$standalone" || break 2
  done
done

echo "=== MULTIFILE BATTERY DONE. Results: $RESULTS_CSV ==="
if command -v column >/dev/null 2>&1; then column -t -s, "$RESULTS_CSV"; else cat "$RESULTS_CSV"; fi
