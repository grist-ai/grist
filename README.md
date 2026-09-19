# Grist

Self-hosted, confidence-gated coding-agent harness for engineering teams.

**Grist is a fork of [OpenCode](https://github.com/anomalyco/opencode)** (anomalyco). The agent loop *is* this codebase — not a wrapper that shells out to OpenCode.

A small local model (Ternary Bonsai 2 27B via llama.cpp) does the bulk of agentic coding on the team’s own hardware. A confidence gate (Jev / TypeSafe System One) will route only low-confidence or high-stakes work to frontier APIs. Institutional knowledge is mined from the team’s history and fed as retrieval.

One-line: **frontier-tier output on a local budget, with institutional memory that survives turnover.**

## Current phase

**Phase 3 — Agent loop** is in place (this OpenCode fork). **Phase 2 — local model** uses PrismML llama.cpp + Ternary Bonsai 2 27B; see below.

Full product plan: [`docs/grist-build-spec.md`](docs/grist-build-spec.md).

## Develop

Requirements: [Bun](https://bun.sh) 1.3+.

```bash
bun install --ignore-scripts   # if tree-sitter-powershell gyp fails
bun run --cwd packages/core fix-node-pty
bun dev
```

```bash
bun dev --help
bun run --cwd packages/opencode src/index.ts --help
```

## Local model (Phase 2)

Stock Homebrew `llama-server` will **not** run ternary Bonsai. Use the PrismML fork:

```bash
./scripts/grist-phase2-setup.sh    # binaries + ~6GB PTQ1_0 GGUF
./scripts/grist-llama-server.sh    # :8080 OpenAI-compatible
cp opencode.jsonc.example opencode.jsonc
bun dev                            # model llama.cpp/bonsai-2-27b
```

Details: [`docs/local-model.md`](docs/local-model.md).

## What’s next (not in this reset)

| Phase | Work |
| --- | --- |
| 4 | Langfuse + token-spend logging |
| 5 | Jev confidence gate (`local_model` / `frontier_escalation` / `ask_human`) |
| 6–8 | Code-map bake-off, Supermemory + ownership mining, shadow burn-in |

TypeSafe skill for gate work: [`.agents/skills/typesafe-ai`](.agents/skills/typesafe-ai).

## Upstream

Based on [anomalyco/opencode](https://github.com/anomalyco/opencode) (`dev`). MIT. Product name **Grist**; package names remain OpenCode until a deliberate rename pass.
