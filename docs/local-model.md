# Local models (watch only)

Per the [pre-POC spec](grist-pre-poc-spec-sheet.md) §12, local models are **not**
the active build path. Active Phase 1 is the OpenCode fork on **DeepSeek Flash**
(API). Revisit Qwen3.8-27B / Ternary Bonsai 2 only if a zero-marginal-cost tier
becomes strategically worth it.

Historical Phase-2-from-the-old-local-first-plan scripts still work if you want
to experiment offline:

```bash
./scripts/grist-phase2-setup.sh    # PrismML llama.cpp + PTQ1_0 GGUF (~6 GB)
./scripts/grist-llama-server.sh    # :8080 OpenAI-compatible
```

**Measured (optional):** ~22.3 tok/s decode on Metal with Bonsai PTQ1_0 / 32K
context — interesting, not a Phase 1 exit criterion.

For the active harness path see [`providers.md`](providers.md).
