# Grist Pareto Benchmark — Repro Bundle

Task definitions, runner scripts, and analysis code for the internal
Pareto benchmark described in [`docs/benchmarks.md`](../docs/benchmarks.md)
(September 2026: 49 tasks × 6 routing configs = 294 headless runs).

## Layout

```
benchmarks/
  single-file/          35 single-file tasks (PROBLEM.md + test.js each)
    tasks/
    run.sh              210-run battery (35 tasks × 6 configs)
    analyze.py          summary stats from results.csv
    cost-for-session.py per-session cost from `grist session export` × gateway prices
  multi-file/           14 multi-file tasks (3–8 files each)
    tasks/              starter code + PROBLEM.md + test.js
    ref-solutions/      reference solutions (for test validation, not for agents)
    run.sh              84-run battery (14 tasks × 6 configs)
    analyze.py          summary stats incl. avg subagent dispatches
    cost-for-session.py
    dispatches-for-session.py   subagent dispatch counts from session exports
```

## Running a battery

Requirements: the `grist` CLI on your PATH (or set `GRIST_BIN`), `node`,
`python3`. Runs are headless and bill real inference spend to your gateway
account / provider key.

```bash
cd benchmarks/single-file   # or multi-file
./run.sh
python3 analyze.py          # summary table once results.csv exists
```

Guards built into `run.sh`: 600s (single-file) / 900s (multi-file) per-run
timeout, a $2 per-run cost kill-switch, and a $20 total budget guard. Expected
spend at September 2026 gateway prices: ~$3 for single-file, ~$7 for
multi-file.

Before running, validate the tests the way we did: copy each task's
reference solution (or the `ref-solutions/` tree for multi-file) over the
starter code and confirm `node test.js` passes. All 49 test suites passed
against references before the published runs.

## Interpreting results

The metric that matters is **$/solved-task** (total config spend ÷ tasks
solved) — it penalizes both expensive runs and failures. `analyze.py` prints
it alongside solve rate, per-task cost, the rung the gate actually chose
(`model used per config`), and average subagent dispatches.

Our published aggregates are in `docs/benchmarks.md`. Per-task cost data is
intentionally not published — every public figure is an aggregate. If you
re-run, your `results.csv` is yours.

## Limitations (read before citing)

- Single runs per task-config — no error bars.
- Synthetic tasks, not SWE-bench or Terminal-Bench.
- Costs are client-side estimates (session-export tokens × gateway prices),
  not server-metered billing.
- Pinned cheapest also solved 100% of both batteries, so these tasks don't
  isolate the gate's value-add over a static always-cheapest policy. Tasks
  at the difficulty boundary — where cheapest fails but gate-escalated
  medium succeeds — are the next battery.
