# Grist

Confidence-gated coding agent — a rebranded fork of [OpenCode](https://github.com/anomalyco/opencode).
The agent loop *is* this codebase (chat / IDE / CLI). There is no separate mill wrapper.

A Jev confidence gate routes each task to the **cheapest capable model rung**
(via OpenRouter: DeepSeek Flash → Kimi K3 → GPT-5.6 Sol), with institutional
memory mined from the user’s history. Local models are watch-only for now.

Invite-gated public test: [`docs/grist-public-launch-spec.md`](docs/grist-public-launch-spec.md).

**Value prop:** frontier-tier output at a flat price, with memory that survives turnover.

Living plan: [`docs/grist-pre-poc-spec-sheet.md`](docs/grist-pre-poc-spec-sheet.md).

## Current phase

**Grist in-tree build complete** for pre-POC phases 1–6 (gate, SoL-Pi, usage,
code map, memory, burn-in, eval). Pilot-repo exits are deferred — see
[`docs/grist-status.md`](docs/grist-status.md).

```bash
bun install --ignore-scripts
bun run --cwd packages/core fix-node-pty
# Founder: start the gateway with YOUR OpenRouter key
export OPENROUTER_API_KEY=sk-or-v1-...
export GRIST_ADMIN_TOKEN=dev
bun run --cwd packages/opencode src/index.ts gateway
# Tester (or you dogfooding): opens the site; enter your invite there
bun run --cwd packages/opencode src/index.ts auth login --gateway http://127.0.0.1:8787
bun run --cwd packages/opencode test src/grist/
bun scripts/grist-eval.ts
bun scripts/burn-in-report.ts
bun dev

# Desktop GUI (Electron, Mac/Win/Linux):
bun run --cwd packages/desktop dev
# package a Mac .app:
# bun run --cwd packages/desktop build && bun run --cwd packages/desktop package:mac
```

### New codebase

```bash
cd /path/to/your-repo
grist auth login --gateway <url>
grist init
grist bootstrap            # pin SHA + ownership mine (+ Graphify if installed)
grist                      # start agent
```

`grist init --bootstrap` runs both. Review `.grist/bootstrap/ownership.jsonl` before
persisting any rows to memory.
### Install from npm (when published)

```bash
npm install -g grist-ai
grist
```

See [`docs/npm.md`](docs/npm.md) for publishing.

Gate logs: `[grist:gate] cheapest|medium|frontier …`. Disable with `GRIST_GATE=off`.
Control plane: `[grist:ctrl:…]` continue/perm/budget/verify/ctx. Disable with `GRIST_CTRL=off`.
Mode: `GRIST_MODE=normal|capped|cheapest` (frontier off under `capped`).
Mechanisms: `GRIST_MECH=auto|efficiency|performance|off` (`[grist:mech]`).
Escalation context: code-map subgraph on medium/frontier (`GRIST_CTX_MIN=off` to disable).
Diff audit: `[grist:diff-audit]` on edit/write (`GRIST_DIFF_AUDIT=off` to disable).
Usage logs: `[grist:usage]` / `[grist:event]`. Disable with `GRIST_USAGE_LOG=off`.
ObservationPack: `[grist:observation-pack] …`. Disable with `GRIST_OBS_PACK=off`.
Code map: `[grist:code-map] …`. Disable with `GRIST_CODE_MAP=off`.
Memory: `[grist:memory] …` → managed Supermemory local sidecar (MIT;
`bunx supermemory local install` once; Grist auto-starts it) or
`.grist/memory.json`. Off: `GRIST_MEMORY=off`.
Burn-in log: `.grist/burn-in.jsonl`. Disable with `GRIST_BURNIN=off`.
Explicit `--model` / agent-pinned models are not rewritten.

## Build order (pre-POC)

| # | Phase | Exit |
| --- | --- | --- |
| 1 | Harness on cheap tier | Real tasks on Prosh |
| 2 | Jev router + Action Fusion / ObservationPack | Routing + mechanism logs |
| 3 | Langfuse / usage log | $/task visible |
| 4 | Map bake-off (Graphify vs CRG) | Layer locked on data |
| 5 | Supermemory + bootstrap | Retrieval answers ownership/convention Qs |
| 6 | Shadow burn-in | Calibrated thresholds + measured tier mix |

TypeSafe / Jev skill: [`.agents/skills/typesafe-ai`](.agents/skills/typesafe-ai).
Providers: [`docs/providers.md`](docs/providers.md).
SoL-Pi ports: [`docs/solpi.md`](docs/solpi.md).
Gate: [`docs/gate.md`](docs/gate.md).
Code map: [`docs/code-map.md`](docs/code-map.md).
Memory: [`docs/memory.md`](docs/memory.md).
Shadow burn-in: [`docs/shadow-burn-in.md`](docs/shadow-burn-in.md).

## Local models (watch only)

Ternary Bonsai 2 / llama.cpp scripts remain under `scripts/` and
[`docs/local-model.md`](docs/local-model.md) for later revisit — **not** the
active Phase 1 path.

## Upstream

Based on [anomalyco/opencode](https://github.com/anomalyco/opencode) (`dev`). MIT.
Product name **Grist**; package names stay OpenCode until a deliberate rename.
Model selection is internal (OpenRouter ladder + gate) — the TUI/CLI do not expose
model pickers or model names to users.
