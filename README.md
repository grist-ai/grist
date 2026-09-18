# Grist

Self-hosted, confidence-gated coding-agent harness for engineering teams.

**Grist is a fork of [OpenCode](https://github.com/anomalyco/opencode)** (anomalyco). The agent loop *is* this codebase — not a wrapper that shells out to OpenCode.

A small local model (Ternary Bonsai 2 27B via llama.cpp) does the bulk of agentic coding on the team’s own hardware. A confidence gate (Jev / TypeSafe System One) will route only low-confidence or high-stakes work to frontier APIs. Institutional knowledge is mined from the team’s history and fed as retrieval.

One-line: **frontier-tier output on a local budget, with institutional memory that survives turnover.**

## Current phase

**Phase 3 — Agent loop.** Baseline is this OpenCode-derived tree, runnable locally. Point it at llama.cpp when Phase 2 is up.

Full product plan, locked components, and later phases (gate, map, memory, shadow burn-in): [`docs/grist-build-spec.md`](docs/grist-build-spec.md).

Upstream OpenCode install / contributing docs still apply for day-to-day development of the agent loop.

## Develop

Requirements: [Bun](https://bun.sh) 1.3+.

```bash
bun install
bun dev
```

CLI help / headless serve:

```bash
bun dev --help
bun dev serve
```

Build a standalone binary:

```bash
./packages/opencode/script/build.ts --single
./packages/opencode/dist/opencode-<platform>/bin/opencode --help
```

## Local model (Phase 2 → 3)

When llama.cpp `llama-server` is running (OpenAI-compatible, typically `http://127.0.0.1:8080/v1`), configure a provider in `opencode.json` / `opencode.jsonc`. See [`docs/local-model.md`](docs/local-model.md).

## What’s next (not in this reset)

| Phase | Work |
| --- | --- |
| 4 | Langfuse + token-spend logging |
| 5 | Jev confidence gate (`local_model` / `frontier_escalation` / `ask_human`) |
| 6–8 | Code-map bake-off, Supermemory + ownership mining, shadow burn-in |

TypeSafe skill for gate work: [`.agents/skills/typesafe-ai`](.agents/skills/typesafe-ai).

## Upstream

Based on [anomalyco/opencode](https://github.com/anomalyco/opencode) (`dev`). MIT. Product name **Grist**; package names remain OpenCode until a deliberate rename pass.
