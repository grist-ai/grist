# Grist

Confidence-gated coding agent — a rebranded fork of [OpenCode](https://github.com/anomalyco/opencode).
The agent loop *is* this codebase (chat / IDE / CLI). There is no separate mill wrapper.

A Jev confidence gate routes each task to the **cheapest capable model rung**
(DeepSeek Flash → DeepSeek Pro → frontier), with institutional memory mined from
the user’s history. Local models are watch-only for now.

**Value prop:** frontier-tier output at a flat price, with memory that survives turnover.

Living plan: [`docs/grist-pre-poc-spec-sheet.md`](docs/grist-pre-poc-spec-sheet.md).

## Current phase

**Phase 1 — Harness** awaits `DEEPSEEK_API_KEY` (you’ll add later).
**Phase 2 scaffold — Router** is in-tree: Jev/shadow gate stamps the model rung
per task; surgical-engineer doctrine is injected into the system prompt.

```bash
bun install --ignore-scripts
bun run --cwd packages/core fix-node-pty
cp opencode.jsonc.example opencode.jsonc
# optional: export TYPESAFE_API_KEY=...  (else shadow gate)
# later: export DEEPSEEK_API_KEY=...
bun run --cwd packages/opencode test src/grist/jev-gate.test.ts
bun dev
```

Gate logs: `[grist:gate] cheapest|medium|frontier|ask_human …`. Disable with `GRIST_GATE=off`.
Explicit `--model` / agent-pinned models are not rewritten.

## Build order (pre-POC)

| # | Phase | Exit |
| --- | --- | --- |
| 1 | Harness on cheap tier | Real tasks on Prosh |
| 2 | Jev router + Action Fusion / ObservationPack | Routing logged per task |
| 3 | Langfuse | $/task visible |
| 4 | Map bake-off (Graphify vs CRG) | Layer locked on data |
| 5 | Supermemory + bootstrap | Retrieval answers ownership/convention Qs |
| 6 | Shadow burn-in | Calibrated thresholds + measured tier mix |

TypeSafe / Jev skill: [`.agents/skills/typesafe-ai`](.agents/skills/typesafe-ai).

## Local models (watch only)

Ternary Bonsai 2 / llama.cpp scripts remain under `scripts/` and
[`docs/local-model.md`](docs/local-model.md) for later revisit — **not** the
active Phase 1 path.

## Upstream

Based on [anomalyco/opencode](https://github.com/anomalyco/opencode) (`dev`). MIT.
Product name **Grist**; package names stay OpenCode until a deliberate rename.
