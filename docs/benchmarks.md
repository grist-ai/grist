# Grist Pareto Benchmark — Methodology & Results

**Status:** internal benchmark, September 2026. Grist @ `0ae47d28`.
**Scope:** 49 coding tasks × 6 routing configurations = 294 headless runs.
**Total measured spend:** $9.04 across both batteries.

This document describes what we ran, what we found, and what the numbers do
and don't license. Per-task cost data is intentionally not published; every
figure below is an aggregate.

## Why this benchmark exists

A live debate in the agent-coding world — most sharply Replit's "free the
models" position — holds that LLM routers are fundamentally limited and that
frontier models should drive agentic loops directly, delegating to cheaper
tiers themselves. Grist's architecture bets the other way: a confidence gate
routes every task to the cheapest rung that can solve it, and the expensive
rungs stay in reserve.

This benchmark tests that bet head-to-head: the gated ladder against a raw
frontier-only loop, on score-vs-cost.

## Method

### Tasks

Two batteries, all tasks validated against reference solutions *before* the
runs (test bugs caught and fixed pre-run in both batteries):

- **Single-file battery (35 tasks):** small self-contained JavaScript tasks
  across three difficulty tiers — trivial (11), medium (14), harder (10).
  Each task ships a spec and a test file; the agent must produce a module
  that passes.
- **Multi-file battery (14 tasks):** small multi-file codebases (3–8 files)
  requiring cross-file reasoning — 5 feature additions, 5 refactors, 4
  cross-file bug fixes. Designed specifically so specialist delegation and
  control-plane mechanisms *could* engage.

### Configurations

| config | setup | what it measures |
|---|---|---|
| `gate-ceil-cheapest` | normal `grist run` (the Grist default) | gate with cheapest ceiling |
| `gate-ceil-frontier` | `grist run -m grist/frontier` | gate routing with a frontier ceiling |
| `pinned-cheapest` | control plane off, `--standalone`, `-m grist/cheapest` | raw cheapest rung, no gate |
| `pinned-frontier` | control plane off, `--standalone`, `-m grist/frontier` | raw frontier rung, no gate (the "free the models" setup) |
| `gate-specialists` | normal `grist run`, specialist roster registered | gate + specialist delegation available |
| `gate-mech-off` | mechanisms disabled, `--standalone` | gate without SoL-Pi control-plane mechanisms |

### Metrics

- **$/solved-task** (primary): total config spend ÷ tasks solved. This is the
  number users feel — it penalizes both expensive runs and failures.
- **Solve rate**, **rung distribution** (which rung the gate actually chose,
  from session exports), and **subagent dispatch counts** per run.
- Costs are client-side estimates: session-export token counts × gateway
  prices. Server-side metering (`recordTaskUsage`) was not yet wired into the
  loop at benchmark time.

### Protocol

- Every run headless, fresh working directory, per-run spend kill-switch.
- Failures recorded **strict**: no prompt clarification, no retries, no
  post-hoc fixes. A failure is a genuine failure mode of that configuration.
- Single run per task-config (no repeats — see Limitations).

## Results

### Single-file battery (35 tasks, 210 runs, $2.63)

| config | solved | solve rate | $/solved-task |
|---|---|---|---|
| gate (cheapest ceiling) | 35/35 | 100% | **$0.0064** |
| gate (frontier ceiling) | 35/35 | 100% | $0.0064 |
| pinned cheapest | 35/35 | 100% | $0.0058 |
| pinned frontier | 10/35 | 28.6% | **$0.1513** |
| gate + specialists | 35/35 | 100% | $0.0077 |
| gate, mechanisms off | 35/35 | 100% | $0.0056 |

The gate routed 35/35 tasks to the cheapest rung — including with a frontier
ceiling available — and solved all of them. **The gate is 23.6× cheaper per
solved task than the raw frontier loop.**

All 25 frontier failures were the same systematic bug: the frontier model
wrote `module.exports = fn` where the test expected `module.exports = { fn }`,
so the destructured import received `undefined`. The task logic was correct in
the spot-checked cases; the model didn't read the test file's import
convention. Notably, frontier passed 5/10 *harder* tasks but only 1/11
*trivial* ones — longer specs made it read more carefully. Kept strict per
protocol: this is a genuine integration-reliability signal, and bigger was
not better here.

### Multi-file battery (14 tasks, 84 runs, $6.41)

| config | solved | solve rate | $/solved-task | avg subagent dispatches |
|---|---|---|---|---|
| gate (cheapest ceiling) | 14/14 | 100% | **$0.0067** | 0.0 |
| gate (frontier ceiling) | 14/14 | 100% | $0.0082 | 0.0 |
| pinned cheapest | 14/14 | 100% | $0.0084 | 0.0 |
| pinned frontier | 14/14 | 100% | **$0.4202** | 11.2 |
| gate + specialists | 14/14 | 100% | $0.0068 | 0.0 |
| gate, mechanisms off | 14/14 | 100% | $0.0075 | 0.0 |

Zero failures across all 84 runs. The gate escalated to the **medium** rung on
12/14 tasks (cheapest on 2/14) — the gate's difficulty judgment working as
designed: simple work stays cheap, harder multi-file work earns a stronger
rung. It never selected frontier.

**The gate is 62.7× cheaper per solved task than the raw frontier loop, at
equal 100% accuracy.** Frontier's winning strategy was heavy subagent
delegation — 11.2 dispatches per task on average, up to 62 on one task. That
is exactly the cost structure the gate exists to avoid: freeing the model
didn't remove the cost, it relocated it into delegation. Per-task frontier
cost multipliers ranged from 12× to 307×.

### Specialists and mechanisms: null results, reported honestly

- **Specialists never dispatched** — 0 dispatches across all 49 tasks, even
  on the multi-file tasks designed to trigger delegation (module extraction,
  circular-dependency breaking). At 3–8 files the model correctly judges
  inline reads cheaper than a subagent round-trip. Their value needs
  repository-scale tasks; it is unmeasured, not disproven.
- **SoL-Pi mechanisms showed no signal** — no accuracy difference with them
  on or off in either battery; cost difference was noise-level on multi-file
  (+14% on single-file). They need exploration-heavy, ambiguous work to pay
  off; these tasks weren't that.

## Limitations

- **Single runs.** No repeats, no confidence intervals. Frontier's solve rate
  has visible variance (it passed a task in the full battery it failed in the
  pilot).
- **Synthetic tasks.** 49 designed tasks, not SWE-bench or Terminal-Bench.
  Generalization to real-world software engineering is untested.
- **Estimated costs.** Client-side token×price math, not server-metered
  billing.
- **Ceiling effect.** Pinned cheapest also solved 100% of both batteries, so
  this benchmark doesn't isolate the gate's value-add over a static
  always-cheapest policy. Tasks at the difficulty boundary — where cheapest
  fails but gate-escalated medium succeeds — are the next battery.
- **Raw data.** Per-task costs are not published.

## Repro

Everything needed to re-run both batteries is scripted in [`benchmarks/`](benchmarks/):
task definitions (spec + test + reference solution), the runner scripts
(fresh work dirs, per-run timeouts, per-run and total spend kill-switches),
and the analysis code. See `benchmarks/README.md` for instructions. No
manual steps; expected spend is ~$10 total at current gateway prices.

## Bottom line

Across 294 runs, the confidence gate solved every task at roughly a cent per
solved task, routing up to medium exactly when the work got harder and never
needing frontier. The frontier-only loop — the architecture the "free the
models" position prescribes — was 24–63× more expensive per solved task and,
on single-file work, dramatically less reliable. The gate survives the
critique empirically.
