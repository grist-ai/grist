#!/bin/bash
# Pareto benchmark SINGLE-FILE runner: 35 tasks x 6 configs = 210 headless grist runs.
# Usage: ./run.sh
# Requires: grist CLI on PATH (or set GRIST_BIN), node, python3.
# Expected spend: ~$3 at current gateway prices. Budget guard: $20.
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

TASKS="fizzbuzz csv-parser retry-backoff lru-cache markdown-toc palindrome anagram flatten word-freq reverse-words dedupe chunk capitalize digital-root intersection event-emitter debounce bst promise-pool deep-clone query-string semver memoize topo-sort json-path tiny-router ini-parser template-engine token-bucket md-lite expr-eval schema-validate ttl-cache line-diff csv-stringify"

# config_name|rung|extra_env|standalone
# gate-ceil-*: Jev gate active; -m sets the ceiling, gate may route down
# pinned-*: GRIST_CTRL=off disables the gate hook entirely; --standalone ensures env reaches server
# gate-specialists: gate active, specialist roster registered by default (track subagent dispatch in analysis)
# gate-mech-off: GRIST_MECH=off disables SoL-Pi mechanisms; --standalone for env propagation; gate still active
CONFIGS="gate-ceil-cheapest|grist/cheapest||0 gate-ceil-frontier|grist/frontier||0 pinned-cheapest|grist/cheapest|GRIST_CTRL=off|1 pinned-frontier|grist/frontier|GRIST_CTRL=off|1 gate-specialists|grist/cheapest||0 gate-mech-off|grist/cheapest|GRIST_MECH=off|1"

PROMPT='Read PROBLEM.md in the current directory carefully. Write solution.js exactly per the spec. Do not modify test.js. Do not create any other files. When solution.js is written, you are done — stop.'

# Fresh work dirs (no solution leakage between configs)
for t in $TASKS; do
  for c in gate-ceil-cheapest gate-ceil-frontier pinned-cheapest pinned-frontier gate-specialists gate-mech-off; do
    d="$WORK/$t/$c"
    rm -rf "$d"; mkdir -p "$d"
    cp "$BASE/tasks/$t/PROBLEM.md" "$BASE/tasks/$t/test.js" "$d/"
  done
done

echo "task,config,session_id,pass,cost_usd,tok_in,tok_out,tok_reason,tok_cached,model,wall_s,note" > "$RESULTS_CSV"

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

  # Launch headless in background so we can monitor cost
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

  # Monitor: timeout 600s, cost kill-switch $2
  local elapsed=0 note=""
  while kill -0 $pid 2>/dev/null; do
    sleep 10
    elapsed=$((elapsed + 10))
    if [ $elapsed -ge 600 ]; then
      kill $pid 2>/dev/null; wait $pid 2>/dev/null
      note="TIMEOUT_600s"
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

  # Pass/fail: run the task's own test suite
  local pass="FAIL"
  if [ -f "$dir/solution.js" ]; then
    if (cd "$dir" && timeout 60 node test.js > "$LOGS/${task}_${cfg}.test.log" 2>&1); then
      pass="PASS"
    fi
  else
    note="${note:+$note;}NO_SOLUTION"
  fi

  echo "$task,$cfg,$ses_id,$pass,$cost,$tin,$tout,$tre,$tcached,$model,$wall,$note" >> "$RESULTS_CSV"
  echo "  -> $pass cost=\$$cost in=$tin out=$tout cached=$tcached wall=${wall}s note=$note"

  TOTAL_COST=$(awk "BEGIN{print $TOTAL_COST + $cost}")
  echo "  single-file battery spend so far: \$$TOTAL_COST"
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

echo "=== SINGLE-FILE BATTERY DONE. Results: $RESULTS_CSV ==="
if command -v column >/dev/null 2>&1; then column -t -s, "$RESULTS_CSV"; else cat "$RESULTS_CSV"; fi
