# Local model (Phase 2 → 3)

Ternary Bonsai 2 27B runs behind **PrismML’s llama.cpp fork**, not stock Homebrew `llama-server`. Stock builds reject `PTQ1_0` / `PQ2_0` (or load `Q2_0` and emit garbage).

## Setup (this machine)

```bash
./scripts/grist-phase2-setup.sh   # PrismML binaries + PTQ1_0 GGUF (~6 GB)
./scripts/grist-llama-server.sh   # OpenAI-compatible API on :8080
```

Defaults: 32K context (`GRIST_CTX`), Metal offload (`GRIST_NGL=99`), port `8080`. On ≤16GB RAM use `GRIST_CTX=16384`.

Weights: [`prism-ml/Ternary-Bonsai-2-27B-gguf`](https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf) (`Ternary-Bonsai-2-27B-PTQ1_0.gguf`). Binaries: [PrismML-Eng/llama.cpp releases](https://github.com/PrismML-Eng/llama.cpp/releases) (`*-bin-macos-arm64`).

`models/` and `tools/llama-prism/` are gitignored — download locally.

## Point Grist (OpenCode fork) at the server

```bash
cp opencode.jsonc.example opencode.jsonc
bun dev
# or: bun run --cwd packages/opencode src/index.ts --model llama.cpp/bonsai-2-27b
```

`opencode.jsonc.example` registers an OpenAI-compatible provider at `http://127.0.0.1:8080/v1`.

## Verify tok/s (Phase 2 gate)

With the server up:

```bash
curl -s http://127.0.0.1:8080/v1/models | head
# timed chat completion (or native /completion timings)
```

**Measured on this Mac (32GB, Metal, `-c 32768`, PTQ1_0):** ~**22.3 tok/s** decode (prompt ~50 tok/s) — within the build-spec ~20–28 tok/s band.

See [`grist-build-spec.md`](grist-build-spec.md) §6–7 for context/slot guidance.
